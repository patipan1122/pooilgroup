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

  const channel = await prisma.ledgerLineChannel.findUnique({
    where: { id: channelId },
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
  };

  // Fast 200 — process after the response.
  after(async () => {
    for (const ev of body.events ?? []) {
      if (ev.type !== "message") continue;
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

  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
    signal: AbortSignal.timeout(3000),
  });
}
