// POST /api/clawhub/line/webhook — ClawHub (JOLLY PLAY) LINE OA webhook receiver.
//
// LINE expects a fast 2xx → we verify the signature, then handle each event in
// its own try/catch (one bad event can't 500 the whole batch) and always return
// 200 quickly. Inbound text runs through the FAQ/AI bot; images are stored to R2
// and the customer is pointed at the LIFF "ขอคืนเงิน" button (refunds are NOT
// processed via chat photos).
//
// Uses CLAWHUB-namespaced env (RULE J · CEO 2026-06-08) — its OWN LINE channel.
import { NextRequest, NextResponse } from "next/server";
import {
  verifyClawhubWebhook,
  getLineProfile,
  getMessageContent,
  replyMessage,
  pushText,
  type LineProfile,
} from "@/lib/clawhub/line";
import { getOrCreateMember } from "@/lib/clawhub/member";
import { BRAND } from "@/lib/clawhub/constants";
import { clawhubOrgId } from "@/lib/clawhub/org";
import { ingestInboundMessage, logOutbound } from "@/lib/clawhub/ingest";
import { clawhubBotReply } from "@/lib/clawhub/bot";
import { putObject } from "@/lib/clawhub/r2";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── Minimal LINE event shapes (loosely typed — LINE sends a superset) ──────────
interface LineSource {
  type?: string;
  userId?: string;
  groupId?: string;
  roomId?: string;
}
interface LineMessageBody {
  id?: string;
  type?: string; // text | image | sticker | …
  text?: string;
}
interface LineEvent {
  type?: string; // message | follow | unfollow | postback | …
  replyToken?: string;
  source?: LineSource;
  message?: LineMessageBody;
  postback?: { data?: string };
}

// LIFF deep-link base for the customer app. Buttons in chat replies point here.
function liffLink(screen: string): string {
  const id = process.env.NEXT_PUBLIC_CLAWHUB_LIFF_ID;
  if (!id) return "";
  return `https://liff.line.me/${id}?screen=${encodeURIComponent(screen)}`;
}

function welcomeText(): string {
  const refundUrl = liffLink("refund");
  const registerUrl = liffLink("register");
  const lines = [
    `สวัสดีครับ ยินดีต้อนรับสู่ ${BRAND} 🎁`,
    `เราเป็นตู้คีบตุ๊กตา/ของเล่นอัตโนมัติ (ไม่ใช่การพนัน)`,
    ``,
    `ถ้าตู้มีปัญหา ไม่ออกของ — กดปุ่ม "ขอคืนเงิน" ในเมนูด้านล่าง ระบบจะคืนให้เป็นแต้ม (1 แต้ม = 10 บาท) เอาไว้แลกตุ๊กตาได้`,
    `อยากเป็นสมาชิก/ดูแต้ม — กดปุ่ม "แต้มของฉัน" หรือ "สมัครสมาชิก" ในเมนูได้เลยครับ`,
  ];
  if (refundUrl) lines.push(``, `ขอคืนเงิน: ${refundUrl}`);
  if (registerUrl) lines.push(`สมัครสมาชิก: ${registerUrl}`);
  return lines.join("\n");
}

// ── Per-event handlers ─────────────────────────────────────────────────────────

async function handleFollow(orgId: string, ev: LineEvent): Promise<void> {
  const userId = ev.source?.userId;
  if (!userId) return;
  const profile = await getLineProfile(userId);
  // Auto-create the member on follow (idempotent) so the chat box has identity.
  await getOrCreateMember(orgId, {
    lineUserId: userId,
    displayName: profile?.displayName,
    pictureUrl: profile?.pictureUrl,
  });
  await pushText(userId, welcomeText());
}

async function handleTextMessage(
  orgId: string,
  ev: LineEvent,
  profile: LineProfile | null,
): Promise<void> {
  const userId = ev.source?.userId;
  const text = ev.message?.text;
  if (!userId || !text) return;

  const member = await getOrCreateMember(orgId, {
    lineUserId: userId,
    displayName: profile?.displayName,
    pictureUrl: profile?.pictureUrl,
  });

  const ingested = await ingestInboundMessage({
    orgId,
    lineUserId: userId,
    profile,
    memberId: member.id,
    externalId: ev.message?.id ?? null,
    kind: "TEXT",
    text,
  });

  // Bot disabled for this thread (a human took it over) → leave for staff.
  if (!ingested.botEnabled || ingested.duplicate) return;

  const reply = await clawhubBotReply({
    member,
    conversationId: ingested.conversationId,
    text,
  });

  // Escalation (over budget / wants a human) → leave silently for staff inbox.
  if (reply.escalate || !reply.text) return;

  // Prefer the cheap replyToken; fall back to push if it's already consumed.
  const sent = ev.replyToken
    ? await replyMessage(ev.replyToken, [{ type: "text", text: reply.text }])
    : await pushText(userId, reply.text);
  if (!sent.ok && ev.replyToken) {
    await pushText(userId, reply.text);
  }

  await logOutbound({
    orgId,
    conversationId: ingested.conversationId,
    text: reply.text,
    byBot: true,
  });
}

async function handleImageMessage(
  orgId: string,
  ev: LineEvent,
  profile: LineProfile | null,
): Promise<void> {
  const userId = ev.source?.userId;
  const messageId = ev.message?.id;
  if (!userId || !messageId) return;

  const member = await getOrCreateMember(orgId, {
    lineUserId: userId,
    displayName: profile?.displayName,
    pictureUrl: profile?.pictureUrl,
  });

  // Download the binary + store to R2 (best-effort; ingest still proceeds).
  let r2Key: string | null = null;
  try {
    const buf = await getMessageContent(messageId);
    if (buf) {
      r2Key = `clawhub/chat/${member.id}/${messageId}.jpg`;
      await putObject(r2Key, buf, "image/jpeg");
    }
  } catch (e) {
    console.error("[clawhub-line webhook] image store failed", e);
    r2Key = null;
  }

  const ingested = await ingestInboundMessage({
    orgId,
    lineUserId: userId,
    profile,
    memberId: member.id,
    externalId: messageId,
    kind: "IMAGE",
    r2Key,
  });
  if (ingested.duplicate) return;

  // The bot does NOT read chat photos for refunds — guide them to the LIFF form.
  if (ingested.botEnabled) {
    const refundUrl = liffLink("refund");
    const guide =
      `ขอบคุณสำหรับรูปครับ 🙏 ถ้าตู้มีปัญหาและต้องการขอคืนเงิน ` +
      `กรุณากดปุ่ม "ขอคืนเงิน" ในเมนูด้านล่าง แล้วอัปโหลดรูปหน้าจอตู้ในแบบฟอร์ม ` +
      `ระบบจะตรวจสอบและคืนเป็นแต้มให้อัตโนมัติครับ` +
      (refundUrl ? `\n\nขอคืนเงิน: ${refundUrl}` : "");
    const sent = ev.replyToken
      ? await replyMessage(ev.replyToken, [{ type: "text", text: guide }])
      : await pushText(userId, guide);
    if (sent.ok || !ev.replyToken) {
      await logOutbound({
        orgId,
        conversationId: ingested.conversationId,
        text: guide,
        byBot: true,
      });
    }
  }
}

async function handleStickerMessage(
  orgId: string,
  ev: LineEvent,
  profile: LineProfile | null,
): Promise<void> {
  const userId = ev.source?.userId;
  const messageId = ev.message?.id;
  if (!userId || !messageId) return;
  const member = await getOrCreateMember(orgId, {
    lineUserId: userId,
    displayName: profile?.displayName,
    pictureUrl: profile?.pictureUrl,
  });
  // Ingest for the staff inbox, then ignore (no auto-reply to stickers).
  await ingestInboundMessage({
    orgId,
    lineUserId: userId,
    profile,
    memberId: member.id,
    externalId: messageId,
    kind: "STICKER",
  });
}

async function handlePostback(orgId: string, ev: LineEvent): Promise<void> {
  // Rich-menu buttons are URI actions (open LIFF) so they don't generate
  // postbacks. Handle gracefully in case a future button uses postback data.
  const userId = ev.source?.userId;
  const data = ev.postback?.data;
  if (!userId) return;
  console.log(`[clawhub-line webhook] POSTBACK userId=${userId} data=${data ?? ""}`);
  // No-op reply — keeps the webhook green. (Could route on `data` later.)
}

async function handleEvent(orgId: string, ev: LineEvent): Promise<void> {
  switch (ev.type) {
    case "follow":
      await handleFollow(orgId, ev);
      return;
    case "postback":
      await handlePostback(orgId, ev);
      return;
    case "message": {
      const userId = ev.source?.userId;
      const profile = userId ? await getLineProfile(userId) : null;
      const mtype = ev.message?.type;
      if (mtype === "text") await handleTextMessage(orgId, ev, profile);
      else if (mtype === "image") await handleImageMessage(orgId, ev, profile);
      else if (mtype === "sticker") await handleStickerMessage(orgId, ev, profile);
      // other message types (video/audio/location/file) → ignore for now.
      return;
    }
    default:
      // unfollow / join / leave / memberJoined … → ignore.
      return;
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("x-line-signature");

  // Signature verification. verifyClawhubWebhook returns false when the secret
  // is UNSET → we ack 200 so LINE's "Verify" button stays green during setup.
  if (!verifyClawhubWebhook(raw, signature)) {
    if (!process.env.CLAWHUB_LINE_CHANNEL_SECRET) {
      console.warn(
        "[clawhub-line webhook] CLAWHUB_LINE_CHANNEL_SECRET not set — acking (cannot verify)",
      );
      return NextResponse.json({ ok: true, note: "no-secret" });
    }
    return NextResponse.json({ error: "bad-signature" }, { status: 401 });
  }

  let payload: { events?: LineEvent[] } = {};
  try {
    payload = JSON.parse(raw) as { events?: LineEvent[] };
  } catch {
    return NextResponse.json({ ok: true, note: "no-json" });
  }

  let orgId: string;
  try {
    orgId = await clawhubOrgId();
  } catch (e) {
    console.error("[clawhub-line webhook] cannot resolve org", e);
    return NextResponse.json({ ok: true, note: "no-org" });
  }

  // Each event isolated — one failure can't 500 the batch / make LINE retry all.
  for (const ev of payload.events ?? []) {
    try {
      await handleEvent(orgId, ev);
    } catch (e) {
      console.error("[clawhub-line webhook] event error", ev.type, e);
    }
  }

  return NextResponse.json({ ok: true });
}
