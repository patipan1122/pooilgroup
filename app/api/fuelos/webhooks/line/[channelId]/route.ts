// LINE Messaging API webhook receiver (per channel)
// ตั้ง URL นี้ใน LINE Developers Console → Messaging API → Webhook URL:
//   https://pooil-fuel.vercel.app/api/webhooks/line/<channelId>
// แล้ววาง Channel Secret + Access Token ที่หน้า /settings (แท็บ LINE)
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLineSignature } from "@/lib/fuelos/line";
import { ingestLineEvent } from "@/lib/fuelos/inbox-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await params;
  const raw = await req.text();
  const signature = req.headers.get("x-line-signature");

  let payload: { events?: unknown[] };
  try {
    payload = JSON.parse(raw) as { events?: unknown[] };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const events = Array.isArray(payload.events) ? payload.events : [];

  // LINE Verify = ping (events ว่าง) → ตอบ 200 ทันที โดยไม่แตะ DB (กัน timeout)
  if (events.length === 0) {
    return NextResponse.json({ ok: true, note: "verify ok" });
  }

  const channel = await prisma.fuelInboxChannel.findUnique({
    where: { id: channelId },
    select: { id: true, orgId: true, accessTokenEnc: true, webhookSecret: true },
  });
  if (!channel) {
    return NextResponse.json({ ok: false, error: "channel not found" }, { status: 404 });
  }

  // ยังไม่ได้ตั้ง Channel Secret → ยังไม่รับข้อความจริงจนกว่าจะวาง secret ที่ /settings
  if (!channel.webhookSecret) {
    return NextResponse.json({ ok: false, error: "วาง Channel Secret ที่ /settings ก่อนถึงจะรับข้อความได้" }, { status: 400 });
  }

  // ตั้ง secret แล้ว → ตรวจลายเซ็นทุก request
  if (!verifyLineSignature(channel.webhookSecret, raw, signature)) {
    return NextResponse.json({ ok: false, error: "bad signature" }, { status: 401 });
  }

  // LINE ส่ง verify request (events ว่าง) ตอนตั้งค่า → ตอบ 200
  let received = 0;
  for (const ev of events) {
    try {
      if (await ingestLineEvent(channel, ev as Parameters<typeof ingestLineEvent>[1])) received += 1;
    } catch {
      // ห้าม 1 event พังแล้วทั้ง batch ล้ม
    }
  }
  return NextResponse.json({ ok: true, received });
}
