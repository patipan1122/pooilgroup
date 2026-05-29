// POST /api/chairops/line/webhook — ChairOps LINE OA webhook receiver.
//
// Deliberately LEAN (AUDIT D-CO-M5 · DEVIL): maids do NOT converse with the
// bot (they tap the Rich Menu → LIFF forms), so there is NO inbound
// conversation processor here. The webhook exists for two things:
//   1. Verify X-Line-Signature (HMAC-SHA256, constant-time) — reject forgeries.
//   2. Log `join` / `follow` events so the CEO can read each group's groupId
//      from the Vercel function logs and paste it into LINE_GROUP_* env.
//
// LINE expects a 2xx quickly → we verify + log + return 200 immediately.
import { NextRequest, NextResponse } from "next/server";
import { verifyLineSignature } from "@/lib/recruit/channel-crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface LineEventSource {
  type?: string;
  userId?: string;
  groupId?: string;
  roomId?: string;
}
interface LineEvent {
  type?: string;
  source?: LineEventSource;
  webhookEventId?: string;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = process.env.CHAIROPS_LINE_CHANNEL_SECRET;
  const signature = req.headers.get("x-line-signature") ?? "";

  if (secret) {
    if (!verifyLineSignature(raw, signature, secret)) {
      return NextResponse.json({ error: "bad-signature" }, { status: 401 });
    }
  } else {
    // No secret configured yet — cannot verify. Don't process; ack so LINE's
    // "Verify" button still goes green during setup.
    console.warn(
      "[chairops-line webhook] CHAIROPS_LINE_CHANNEL_SECRET not set — event ignored (cannot verify)",
    );
    return NextResponse.json({ ok: true, note: "no-secret" });
  }

  let payload: { events?: LineEvent[] } = {};
  try {
    payload = JSON.parse(raw) as { events?: LineEvent[] };
  } catch {
    return NextResponse.json({ ok: true, note: "no-json" });
  }

  for (const ev of payload.events ?? []) {
    const src = ev.source ?? {};
    if (ev.type === "join") {
      const id = src.groupId ?? src.roomId ?? "?";
      // ↓ This line is the whole point: CEO reads it from Vercel logs to wire
      //   LINE_GROUP_FINANCE / REPAIR / OPS / BRANCH / CEO.
      console.log(
        `[chairops-line webhook] JOIN · sourceType=${src.type} id=${id} — add to LINE_GROUP_* env`,
      );
    } else if (ev.type === "follow") {
      console.log(
        `[chairops-line webhook] FOLLOW · userId=${src.userId ?? "?"}`,
      );
    }
  }

  return NextResponse.json({ ok: true });
}
