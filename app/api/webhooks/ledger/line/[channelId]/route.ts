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
import { parseExpenseText, stripJodTrigger } from "@/lib/ledger/parse-text";
import { findRecentAmountDuplicate } from "@/lib/ledger/dedup";
import { handleLedgerCommand } from "@/lib/ledger/line-commands";
import { ensureLedgerMember } from "@/lib/ledger/members";
import { can } from "@/lib/ledger/permissions";
import { archiveReceiptToDrive, isDriveConfigured } from "@/lib/ledger/drive";
import {
  buildLineConfirmCard,
  buildLedgerWelcomeCard,
  type LineFlexMessage,
} from "@/components/ledger/LineConfirmCard";
import { openOrAppendBatch, flushBatchAfterQuiet } from "@/lib/ledger/capture-batch";
import { getRequestBaseUrl } from "@/lib/utils/base-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// AI parse (~2-4s) + the debounced multi-image carousel flush (~3.3s sleep in
// after()) can run ~8s — give the function headroom so the flush isn't killed
// mid-sleep on a multi-photo burst (the inline single-photo reply already went
// out before the sleep, so single captures are unaffected even if this were low).
export const maxDuration = 30;

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { type?: string; userId?: string; groupId?: string };
  message?: { id?: string; type?: string; text?: string };
  postback?: { data?: string };
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
      branchId: true,
      defaultPaymentMethod: true,
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
    branchId: channel.branchId, // group = this branch (null = central group)
    defaultPaymentMethod: channel.defaultPaymentMethod,
  };
  // Absolute origin for flex image URLs + web deep-links (LINE needs https).
  const baseUrl = getRequestBaseUrl(req);
  // LedgerLine's own LIFF — buttons open the review pane THROUGH it (login in LINE).
  const ledgerLiffId = process.env.NEXT_PUBLIC_LEDGER_LIFF_ID || undefined;
  // Today (Asia/Bangkok) = the "วันที่บันทึก" shown on the card beside the bill date.
  const todayBkk = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

  // Fast 200 — process after the response.
  after(async () => {
    // Multi-image: photos sent in a burst land as separate events; each schedules
    // a debounced flush that, once the burst is quiet, sends ONE carousel.
    const pendingFlushes: Promise<void>[] = [];
    const flushDeps = {
      baseUrl,
      liffId: ledgerLiffId,
      replyFlex: (token: string, msg: LineFlexMessage) =>
        accessToken
          ? replyFlex(accessToken, token, msg).then(() => true).catch(() => false)
          : Promise.resolve(false),
      pushFlex: (to: string, msg: LineFlexMessage) =>
        accessToken
          ? pushFlex(accessToken, to, msg).then(() => true).catch(() => false)
          : Promise.resolve(false),
    };

    for (const ev of body.events ?? []) {
      // --- bot ADDED to a group (`join`) or FOLLOWED in 1:1 (`follow`) → greet,
      //     Bainy-style. Shows the 3 ways to use it + how to bind the group to a
      //     branch. We intentionally do NOT greet on `memberJoined` (every new
      //     person joining a busy branch group would spam the chat).
      if (ev.type === "join" || ev.type === "follow") {
        if (ev.replyToken && accessToken) {
          await replyFlex(
            accessToken,
            ev.replyToken,
            buildLedgerWelcomeCard({ baseUrl }),
          ).catch((e) =>
            console.error("[ledger:line-webhook] welcome reply failed", e),
          );
        }
        continue;
      }

      // --- POSTBACK fallback (B4) — the confirm/edit buttons default to URI
      //     deep-links (open the web pane THROUGH the LIFF). If a card is ever
      //     rendered in postback mode, or a client can't follow the URI on iOS,
      //     the data `ledger:edit:<id>` / `ledger:confirm:<id>` lands here and we
      //     reply with the SAME working deep-link so the user still reaches the
      //     review pane. GOLDEN RULE: this NEVER confirms — it only hands back a
      //     link; the accountant confirms on the web.
      if (ev.type === "postback") {
        const data = ev.postback?.data ?? "";
        const m = data.match(/^ledger:(?:confirm|edit):(.+)$/);
        if (m && ev.replyToken && accessToken) {
          const expenseId = m[1];
          const liffEditPath = `/liff/ledger/expense/${encodeURIComponent(
            expenseId,
          )}?company=${encodeURIComponent(ch.companyId)}`;
          const link = ledgerLiffId
            // LINE "Concatenate" rule: NO `/ledger` path (it duplicates the /liff/ledger
            // endpoint → 404). Target rides in ?next=; the LIFF bootstrap navigates there.
            ? `https://liff.line.me/${ledgerLiffId}?next=${encodeURIComponent(liffEditPath)}`
            : `${baseUrl}/ledger/expenses?company=${encodeURIComponent(ch.companyId)}&selected=${encodeURIComponent(expenseId)}`;
          await replyText(
            accessToken,
            ev.replyToken,
            ["เปิดใบเสร็จเพื่อตรวจ/ยืนยันที่นี่ 👇", link, "", "ทุกใบเป็นฉบับร่าง — ยืนยันบนเว็บอีกที ไม่โพสต์อัตโนมัติ"].join("\n"),
          ).catch(() => {});
        }
        continue;
      }

      if (ev.type !== "message") continue;

      // Auto-seed the sender as a member on ANY message (commands + Q&A too, not
      // just captures). This puts every person who interacts into the web back-
      // office — so an admin who types /setting, or the CEO who types anything,
      // appears in สมาชิก with their REAL messaging-API LINE id + name, ready to
      // be linked to a Pool admin account (the "เชื่อม LINE เป็นแอดมิน" flow).
      // Best-effort + idempotent (keyed by orgId+lineUserId); never blocks.
      if (ev.source?.userId) {
        await ensureLedgerMember({
          orgId: ch.orgId,
          companyId: ch.companyId,
          lineUserId: ev.source.userId,
          groupId: ev.source.groupId ?? null,
          accessToken,
        });
      }

      // --- Resolve THIS group's branch (B3 multi-group → multi-branch). One OA
      //     can serve many branch groups; a per-group override row wins, else we
      //     fall back to the channel's single branch — so single-group setups are
      //     byte-for-byte unchanged. One cheap indexed lookup per event.
      let effectiveBranchId: string | null = ch.branchId;
      if (ev.source?.groupId) {
        const gm = await prisma.ledgerLineGroup
          .findFirst({
            where: {
              orgId: ch.orgId,
              companyId: ch.companyId,
              groupId: ev.source.groupId,
              active: true,
            },
            select: { branchId: true },
          })
          .catch(() => null);
        if (gm?.branchId) effectiveBranchId = gm.branchId;
      }

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
        const text = ev.message.text.trim();

        // --- commands first: /help · /menu · /guide · วิธีใช้ · /setting (admin) ---
        if (text.startsWith("/") || text === "วิธีใช้") {
          try {
            const cmdReply = await handleLedgerCommand(text, {
              orgId: ch.orgId,
              companyId: ch.companyId,
              channelRowId: ch.id,
              branchId: ch.branchId,
              groupId: ev.source?.groupId ?? null,
              senderLineUserId: ev.source?.userId ?? null,
            });
            if (cmdReply !== null) {
              if (ev.replyToken && accessToken)
                await replyText(accessToken, ev.replyToken, cmdReply).catch(() => {});
              continue;
            }
          } catch (e) {
            console.error("[ledger:line-webhook] command failed", e);
          }
        }

        const note = stripJodTrigger(text);

        // --- "จด ..." → record an expense draft. AI fires ONLY on this trigger
        //     (CEO rule: free text stays free; "จด" = pay-the-AI to parse). ---
        if (note !== null) {
          if (!captureAllowed(ev, ch) || !accessToken) continue;
          try {
            let parsed = null;
            try {
              parsed = await parseExpenseText(note || text, null, ch.orgId);
            } catch (e) {
              if (e instanceof AiBudgetError)
                console.warn("[ledger:line-webhook] AI budget exceeded on จด");
              else console.error("[ledger:line-webhook] จด parse failed", e);
            }
            if (!parsed || parsed.total == null) {
              if (ev.replyToken)
                await replyText(
                  accessToken,
                  ev.replyToken,
                  'พิมพ์จำนวนเงินด้วยนะ เช่น "จด กาแฟ 45" 🧾',
                ).catch(() => {});
              continue;
            }
            // M4 cheap dedup — same amount today/yesterday → flag (lossless).
            const dup = await findRecentAmountDuplicate(ch.orgId, ch.companyId, parsed.total);
            const res = await createDraftExpenseSystem(ch.orgId, {
              companyId: ch.companyId,
              source: "line",
              vendor: parsed.vendor,
              docDate: parsed.docDate,
              subtotal: parsed.total,
              vat: 0,
              wht: 0,
              total: parsed.total,
              paymentMethod: parsed.paymentMethod ?? ch.defaultPaymentMethod ?? null,
              branchId: effectiveBranchId, // per-group branch (B3) → fallback channel branch
              note: dup
                ? `จากข้อความ: "${text}" · ⚠️ ยอดอาจซ้ำกับ ${dup.docCode}`
                : `จากข้อความ: "${text}"`,
              ocrConfidence: parsed.confidence,
              createdById: null,
            });
            if (ev.replyToken && res.ok) {
              await replyFlex(
                accessToken,
                ev.replyToken,
                buildLineConfirmCard({
                  expenseId: res.data.id,
                  companyId: ch.companyId,
                  docCode: res.data.docCode,
                  vendor: parsed.vendor,
                  docDate: parsed.docDate,
                  recordedDate: todayBkk,
                  total: parsed.total,
                  categoryName: parsed.suggestedCategory,
                  paymentMethod: parsed.paymentMethod ?? ch.defaultPaymentMethod ?? null,
                  note: text, // รายละเอียด = ข้อความที่พิมพ์มา (เช่น "จด กาแฟ 45")
                  confidence: parsed.confidence,
                  needsReview: !!dup,
                  baseUrl,
                  liffId: ledgerLiffId,
                }),
              ).catch((e) => console.error("[ledger:line-webhook] จด flex failed", e));
            } else if (ev.replyToken) {
              await replyText(accessToken, ev.replyToken, "บันทึกไม่สำเร็จ · ลองใหม่นะ").catch(() => {});
            }
            // (member auto-seed now happens once per message at the top of the loop)
          } catch (e) {
            console.error("[ledger:line-webhook] จด path failed", e);
          }
          continue;
        }

        // --- not "จด" → conversational Q&A (registered group only; keyword-only,
        //     no LLM spend; P&L numbers never leak outside the trusted group). ---
        const fromRegisteredGroup =
          ev.source?.type === "group" && !!ch.groupId && ev.source.groupId === ch.groupId;
        if (!fromRegisteredGroup) continue;
        try {
          // Permission gate (REAL enforcement of the "สิทธิ์" toggle): a KNOWN member
          // whose role lacks "ดูภาพรวมการเงิน" (report.view_pnl) can't pull P&L/totals
          // here. Unknown senders (not a member yet) keep the prior behaviour, so this
          // only TIGHTENS — never breaks — the live group Q&A.
          if (ev.source?.userId) {
            const m = await prisma.ledgerLineMember
              .findUnique({
                where: { orgId_lineUserId: { orgId: ch.orgId, lineUserId: ev.source.userId } },
                select: { role: true, active: true, companyId: true },
              })
              .catch(() => null);
            // Only gate a member of THIS company: disabled (admin turned them off)
            // OR lacking "ดูภาพรวมการเงิน" → decline. Non-members / other-company
            // members keep the prior default-open behaviour (trusted group only).
            if (
              m &&
              m.companyId === ch.companyId &&
              (!m.active || !(await can(ch.orgId, m.role, "report.view_pnl")))
            ) {
              if (ev.replyToken && accessToken)
                await replyText(
                  accessToken,
                  ev.replyToken,
                  "ดูยอด/ภาพรวมการเงินได้เฉพาะผู้มีสิทธิ์ · แจ้งผู้ดูแลถ้าต้องการสิทธิ์นี้",
                ).catch(() => {});
              continue;
            }
          }
          const qa = await answerQuestion(ev.message.text, {
            orgId: ch.orgId,
            companyId: ch.companyId,
            userId: null,
            allowAi: false,
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
      // Security gate: a bound channel only captures from ITS group; an unbound
      // channel is transitional (accepts) and 1:1 is the personal assistant.
      if (!captureAllowed(ev, ch)) continue;

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
        let imgBytes: Buffer | null = null;
        let imgMime = "image/jpeg";
        try {
          const imgResp = await fetch(att.url, { signal: AbortSignal.timeout(8000) });
          if (imgResp.ok) {
            imgBytes = Buffer.from(await imgResp.arrayBuffer());
            imgMime = imgResp.headers.get("content-type") || "image/jpeg";
            sha256 = sha256Hex(imgBytes);
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

        // 3. Group this photo into a capture batch (so a burst of 4-5 receipts
        //    becomes ONE carousel). groupKey = where to send the summary.
        const groupKey = ev.source?.groupId ?? ev.source?.userId ?? null;
        const sourceType: "group" | "user" =
          ev.source?.type === "group" ? "group" : "user";
        let batch: { batchId: string; isFirst: boolean } | null = null;
        if (groupKey) {
          batch = await openOrAppendBatch({
            orgId: ch.orgId,
            companyId: ch.companyId,
            channelRowId: ch.id,
            groupKey,
            sourceType,
            replyToken: ev.replyToken ?? null,
          }).catch(() => null);
        }

        // 4. Create a DRAFT (never auto-post) via the SESSION-LESS system path.
        //    org scope = the trusted ledger_line_channel row (ch.orgId), NOT a
        //    user session. createdById null → shows as machine-ingested.
        const res = await createDraftExpenseSystem(ch.orgId, {
          companyId: ch.companyId,
          source: "line",
          branchId: effectiveBranchId, // per-group branch (B3) → fallback channel branch
          vendor: parsed?.vendor ?? null,
          docType: parsed?.docType ?? undefined, // AI-classified (falls back tax_invoice)
          vendorTaxId: parsed?.vendorTaxId ?? null,
          buyerTaxIdOnDoc: parsed?.buyerTaxIdOnDoc ?? null, // ภาษีซื้อ: เลขผู้ซื้อบนใบ (verify)
          rawText: parsed?.raw ?? null, // ใช้ heuristic ใบกำกับอย่างย่อ ม.86/6
          vendorDocNumber: parsed?.vendorDocNumber ?? null,
          vendorAddress: parsed?.vendorAddress ?? null,
          docDate: parsed?.docDate ?? null,
          subtotal: parsed?.subtotal ?? 0,
          discount: parsed?.discount ?? 0,
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
          captureBatchId: batch?.batchId ?? null,
          createdById: null,
        });

        // 5. Fast feedback: the FIRST photo of a batch (or any photo when we
        //    couldn't open a batch) gets an immediate single card via reply. If
        //    more photos join, the debounced flush sends a consolidated carousel.
        //    GOLDEN RULE intact: the card's buttons only OPEN the web pane.
        const replyInline = !batch || batch.isFirst;
        if (ev.replyToken && replyInline) {
          if (res.ok) {
            const card = buildLineConfirmCard({
              expenseId: res.data.id,
              companyId: ch.companyId,
              docCode: res.data.docCode,
              vendor: parsed?.vendor ?? null,
              docType: parsed?.docType ?? null,
              vendorDocNumber: parsed?.vendorDocNumber ?? null,
              vendorAddress: parsed?.vendorAddress ?? null,
              docDate: parsed?.docDate ?? null,
              recordedDate: todayBkk,
              total: parsed?.total ?? 0,
              discount: parsed?.discount ?? null,
              vat: parsed?.vat ?? null,
              items: parsed?.items ?? null,
              categoryName: null, // accountant picks the category on the web pane
              paymentMethod: parsed?.paymentMethod ?? null,
              confidence: parsed?.confidence ?? null,
              needsReview: !parsed || res.data.duplicate,
              baseUrl,
              liffId: ledgerLiffId,
            });
            await replyFlex(accessToken, ev.replyToken, card).catch((e) =>
              console.error("[ledger:line-webhook] flex reply failed", e),
            );
          } else {
            await replyText(
              accessToken,
              ev.replyToken,
              "บันทึกใบเสร็จไม่สำเร็จ · ลองส่งรูปใหม่อีกครั้งนะ 📷",
            ).catch((e) => console.error("[ledger:line-webhook] reply failed", e));
          }
        }

        // 6. Schedule the debounced carousel flush (sends only if ≥2 photos).
        if (batch && res.ok) {
          pendingFlushes.push(flushBatchAfterQuiet(batch.batchId, flushDeps));
        }
        // 7. Archive the ORIGINAL to Google Drive (เดือน/ธุรกิจ/สาขา/ประเภท), best-
        //    effort, AFTER the reply (card stays fast). The image stays on R2 as the
        //    fast thumb; the Drive link is the shareable original for the accountant.
        if (res.ok && imgBytes && isDriveConfigured()) {
          try {
            const bkk = new Date(Date.now() + 7 * 3600 * 1000);
            const period = `${bkk.getUTCFullYear()}-${String(bkk.getUTCMonth() + 1).padStart(2, "0")}`;
            const [branchRow, companyRow] = await Promise.all([
              effectiveBranchId
                ? prisma.branch.findUnique({ where: { id: effectiveBranchId }, select: { name: true } })
                : Promise.resolve(null),
              prisma.company.findUnique({ where: { id: ch.companyId }, select: { name: true } }),
            ]);
            const drive = await archiveReceiptToDrive({
              orgId: ch.orgId,
              bytes: imgBytes,
              mimeType: imgMime,
              period,
              companyName: companyRow?.name ?? null,
              branchName: branchRow?.name ?? null,
              categoryName: parsed?.suggestedCategory ?? null,
              docCode: res.data.docCode,
              vendor: parsed?.vendor ?? null,
              docDate: parsed?.docDate ?? null,
            });
            if (drive) {
              await prisma.ledgerExpense.update({
                where: { id: res.data.id },
                data: {
                  driveFileId: drive.fileId,
                  driveWebUrl: drive.webViewLink,
                  originalUrl: drive.webViewLink,
                },
              });
            }
          } catch (e) {
            console.error("[ledger:line-webhook] drive archive failed", e);
          }
        }

        // (member auto-seed now happens once per message at the top of the loop)
      } catch (e) {
        console.error("[ledger:line-webhook] process failed", e);
      }
    }

    // Wait for all debounced carousel flushes (each ~3.3s) before the function
    // exits, so a multi-photo burst always sends its summary card.
    if (pendingFlushes.length) await Promise.allSettled(pendingFlushes);
  });

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "ledger-line-webhook" });
}

/**
 * Capture gate (M6 first pass). A channel BOUND to a group only accepts capture
 * from THAT group (blocks outsiders dropping receipts in a different group). An
 * unbound channel is transitional (accepts, preserves the live setup). 1:1 chat
 * is the personal-assistant path (member-scope gating lands with ledger_line_member).
 */
function captureAllowed(
  ev: LineEvent,
  ch: { groupId: string | null },
): boolean {
  if (ev.source?.type === "group") {
    if (!ch.groupId) return true; // not yet bound → transitional
    return ev.source.groupId === ch.groupId; // only the bound group
  }
  return true; // 1:1 / other → allowed for now
}

/** Best-effort LINE reply with a flex message (the confirm card). */
async function replyFlex(
  accessToken: string,
  replyToken: string,
  flex: LineFlexMessage,
): Promise<void> {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ replyToken, messages: [flex] }),
    signal: AbortSignal.timeout(3000),
  });
}

/** Best-effort LINE push (to a group/user) with a flex message — carousel flush. */
async function pushFlex(
  accessToken: string,
  to: string,
  flex: LineFlexMessage,
): Promise<void> {
  await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, messages: [flex] }),
    signal: AbortSignal.timeout(3000),
  });
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
