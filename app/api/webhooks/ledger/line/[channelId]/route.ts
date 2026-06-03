// LedgerLine — LINE Messaging API webhook (receipt capture from a LINE group).
//
// MIRRORS app/api/webhooks/inbox/line/[channelId]/route.ts:
//   - verify HMAC against the channel's encrypted Channel Secret
//   - return 200 IMMEDIATELY, then process in after() (LINE wants a fast 200)
//   - on an image event → rehost to R2 (rehostLineImage) → AI parse → create a
//     DRAFT expense (status=draft — NEVER auto-post) → push a confirm reply.
//
// Channel secret comes from ledger_line_channel. Phase 1 ships with secrets as
// stubs (TODO[ledger-secret]); until a real Channel Secret is pasted the route
// no-ops gracefully with a warning instead of 401-looping.

import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptToken, verifyLineSignature } from "@/lib/recruit/channel-crypto";
import { rehostLineImage } from "@/lib/inbox/inbound-media";
import { parseReceipt, AiBudgetError } from "@/lib/ledger/ai-parse";
import { createDraftExpenseSystem } from "@/lib/ledger/actions";
import { sha256Hex } from "@/lib/ledger/storage";
import { answerQuestion } from "@/lib/ledger/qa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { type?: string; userId?: string; groupId?: string };
  message?: { id?: string; type?: string; text?: string };
}
interface LineWebhookBody {
  events?: LineEvent[];
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await ctx.params;
  const signature = req.headers.get("x-line-signature") ?? "";
  const rawBody = await req.text();

  // `channelId` in the URL is the LINE Channel ID (e.g. 2007211439) — stable,
  // human-meaningful, and known to the admin, so the webhook URL is predictable
  // and hand-over-able (no random row-UUID to copy). Older URLs used the row's
  // UUID id; match either so previously-pasted URLs keep working.
  const looksUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(channelId);
  const channel = await prisma.ledgerLineChannel.findFirst({
    where: looksUuid
      ? { OR: [{ lineChannelId: channelId }, { id: channelId }] }
      : { lineChannelId: channelId },
    orderBy: { active: "desc" }, // prefer an active binding if a duplicate exists
    select: {
      id: true,
      orgId: true,
      companyId: true,
      active: true,
      webhookSecretEnc: true,
      accessTokenEnc: true,
      groupId: true,
    },
  });

  if (!channel || !channel.active) {
    return NextResponse.json({ error: "channel not found" }, { status: 404 });
  }

  // TODO[ledger-secret]: paste the LINE Channel Secret into ledger_line_channel
  // (encrypted via lib/recruit/channel-crypto). Until then we accept the call
  // but skip ingest so LINE doesn't auto-disable the webhook.
  const channelSecret = decryptToken(channel.webhookSecretEnc);
  if (!channelSecret) {
    return NextResponse.json({ ok: true, warning: "channel secret not set" });
  }

  if (!verifyLineSignature(rawBody, signature, channelSecret)) {
    console.error(
      `[ledger:line-webhook] REJECTED channel ${channel.id}: signature mismatch (wrong Channel Secret?)`,
    );
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: LineWebhookBody;
  try {
    body = JSON.parse(rawBody) as LineWebhookBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const accessToken = decryptToken(channel.accessTokenEnc);
  const ch = {
    id: channel.id,
    orgId: channel.orgId,
    companyId: channel.companyId,
    groupId: channel.groupId,
  };

  // Fast 200 — process after the response.
  after(async () => {
    for (const ev of body.events ?? []) {
      if (ev.type !== "message") continue;

      // --- TEXT → conversational Q&A (สรุปเดือนนี้ / หมวดไหนเยอะสุด / งบ ...) ---
      // Numbers come from the DB (lib/ledger/qa); the LINE bot is read-only here
      // (it never confirms/posts — GOLDEN RULE).
      //
      // ROLE GATE: the financial QA answers leak company-level P&L (spend totals,
      // VAT, budget, per-branch) that the web side restricts to admin/area_manager/
      // viewer. So we ONLY answer when the message comes from the channel's REGISTERED
      // group (the trusted staff group). 1:1 chats, other groups, or a channel with
      // no bound group are skipped — anyone else in/around the chat (vendors, drivers,
      // ex-staff) must not be able to ask "สรุปเดือนนี้" and get the P&L.
      //
      // BUDGET GATE: allowAi:false → keyword-only, the free LINE bot never fires the
      // LLM (which, with userId:null, would skip the per-user circuit breakers and
      // could drain the org's monthly AI budget). Keyword answers still come from
      // the DB; the receipt-image path below is unaffected.
      if (ev.message?.type === "text" && ev.message.text?.trim()) {
        const fromRegisteredGroup =
          ev.source?.type === "group" &&
          !!ch.groupId &&
          ev.source.groupId === ch.groupId;
        if (!fromRegisteredGroup) {
          // Not the trusted staff group → do NOT answer (no P&L leak).
          continue;
        }
        try {
          const qa = await answerQuestion(ev.message.text, {
            orgId: ch.orgId,
            companyId: ch.companyId,
            userId: null, // no Pool session on a webhook → org-only AI budget cap
            allowAi: false, // keyword-only on the free LINE bot (no LLM spend)
          });
          if (ev.replyToken && accessToken) {
            await replyText(accessToken, ev.replyToken, qa.answer).catch((e) =>
              console.error("[ledger:line-webhook] qa reply failed", e),
            );
          }
        } catch (e) {
          console.error("[ledger:line-webhook] qa failed", e);
        }
        continue;
      }

      if (ev.message?.type !== "image" || !ev.message.id) continue;
      if (!accessToken) {
        console.warn("[ledger:line-webhook] no access token — cannot fetch image");
        continue;
      }

      try {
        // 1. Rehost the LINE image onto R2 (reuse inbox helper).
        const att = await rehostLineImage({
          orgId: ch.orgId,
          conversationId: `ledger-${ch.id}`,
          messageId: ev.message.id,
          channelAccessToken: accessToken,
        });
        if (!att?.url) {
          console.warn("[ledger:line-webhook] rehost failed for", ev.message.id);
          continue;
        }

        // 1b. Compute sha256 of the rehosted bytes so the LINE path dedups the
        //     same way the LIFF/web path does (a resent photo returns the
        //     existing draft instead of creating a duplicate). Best-effort: if
        //     the fetch fails we proceed without a hash (no dedup, never blocks).
        let sha256: string | null = null;
        try {
          const imgResp = await fetch(att.url, { signal: AbortSignal.timeout(8000) });
          if (imgResp.ok) {
            sha256 = sha256Hex(Buffer.from(await imgResp.arrayBuffer()));
          }
        } catch (e) {
          console.warn("[ledger:line-webhook] sha256 fetch failed", e);
        }

        // 2. AI parse the receipt (budget-guarded inside parseReceipt). userId is
        //    null → org-only budget cap (no Pool session on a webhook).
        let parsed;
        try {
          parsed = await parseReceipt(att.url, /*userId*/ null, ch.orgId);
        } catch (e) {
          if (e instanceof AiBudgetError) {
            console.warn("[ledger:line-webhook] AI budget exceeded — saving image only");
          } else {
            console.error("[ledger:line-webhook] parse failed", e);
          }
          parsed = null;
        }

        // 3. Create a DRAFT (never auto-post) via the SESSION-LESS system path.
        //    org scope = the trusted ledger_line_channel row (ch.orgId), NOT a
        //    user session. createdById null → shows as machine-ingested.
        const res = await createDraftExpenseSystem(ch.orgId, {
          companyId: ch.companyId,
          source: "line",
          vendor: parsed?.vendor ?? null,
          vendorTaxId: parsed?.vendorTaxId ?? null,
          docDate: parsed?.docDate ?? null,
          subtotal: parsed?.subtotal ?? 0,
          vat: parsed?.vat ?? 0,
          wht: parsed?.wht ?? 0,
          total: parsed?.total ?? 0,
          paymentMethod: parsed?.paymentMethod ?? null,
          originalUrl: att.url,
          thumbUrl: att.url,
          sha256,
          ocrModel: parsed?.ocrModel ?? null,
          ocrConfidence: parsed?.confidence ?? null,
          items: parsed?.items ?? [],
          createdById: null,
        });

        // 4. Push a confirm reply (best-effort; stub-safe if reply fails).
        if (ev.replyToken) {
          await replyConfirm(accessToken, ev.replyToken, {
            ok: res.ok,
            docCode: res.ok ? res.data.docCode : null,
            vendor: parsed?.vendor ?? null,
            total: parsed?.total ?? null,
            duplicate: res.ok ? res.data.duplicate : false,
          }).catch((e) => console.error("[ledger:line-webhook] reply failed", e));
        }
      } catch (e) {
        console.error("[ledger:line-webhook] process failed", e);
      }
    }
  });

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "ledger-line-webhook" });
}

/**
 * Best-effort LINE reply confirming the captured receipt. Partition D ships a
 * richer flex card (components/ledger/LineConfirmCard); this is a plain-text
 * fallback so the webhook is self-contained and never blocks on that file.
 */
async function replyConfirm(
  accessToken: string,
  replyToken: string,
  info: {
    ok: boolean;
    docCode: string | null;
    vendor: string | null;
    total: number | null;
    duplicate: boolean;
  },
): Promise<void> {
  let text: string;
  if (!info.ok) {
    text = "บันทึกใบเสร็จไม่สำเร็จ · ลองส่งใหม่อีกครั้ง";
  } else if (info.duplicate) {
    text = `รูปนี้บันทึกไว้แล้ว (${info.docCode}) · ไม่บันทึกซ้ำ`;
  } else {
    const parts = [`บันทึกใบเสร็จแล้ว · ${info.docCode}`];
    if (info.vendor) parts.push(`ร้าน: ${info.vendor}`);
    if (info.total != null) parts.push(`ยอด: ${info.total.toLocaleString("th-TH")} บาท`);
    parts.push("รอบัญชียืนยันในระบบ (ห้าม auto-post)");
    text = parts.join("\n");
  }

  await replyText(accessToken, replyToken, text);
}

/** Best-effort plain-text LINE reply (used by the Q&A path). */
async function replyText(
  accessToken: string,
  replyToken: string,
  text: string,
): Promise<void> {
  // LINE caps a text message at 5000 chars; our answers are short, but guard it.
  const safe = text.length > 4900 ? text.slice(0, 4900) + "…" : text;
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text: safe }] }),
    signal: AbortSignal.timeout(3000),
  });
}
