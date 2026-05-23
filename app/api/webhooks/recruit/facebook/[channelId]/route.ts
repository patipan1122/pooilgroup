// Facebook Page webhook receiver (SCAFFOLDING)
//
// CEO 2026-05-23: "ทักมาใน facebook แล้วโผล่ในนี้" + multi-page support
//
// CURRENT STATE: stub responds 200 + logs payload + supports FB's GET
// verification challenge (hub.mode=subscribe).
//
// TODO (next session):
// 1. Verify X-Hub-Signature-256 (HMAC-SHA256 of body + channel.webhookSecret)
// 2. Parse `entry[].messaging[]` events
// 3. Match Facebook PSID → existing recruit_applicant or create new
// 4. Persist text/image events to recruit_messages
// 5. Reply via FB Send API using channel.accessTokenEnc

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await ctx.params;
  const signature = req.headers.get("x-hub-signature-256");

  const channel = await prisma.recruitInboxChannel.findUnique({
    where: { id: channelId },
    select: { id: true, type: true, status: true, orgId: true, webhookSecret: true },
  });

  if (!channel || channel.type !== "FACEBOOK") {
    return NextResponse.json({ error: "channel not found" }, { status: 404 });
  }

  await prisma.recruitInboxChannel.update({
    where: { id: channelId },
    data: { lastEventAt: new Date() },
  });

  const body = await req.json().catch(() => ({}));
  console.log("[webhook:FB]", {
    channelId,
    signaturePresent: !!signature,
    object: (body as { object?: string }).object,
    entryCount: Array.isArray((body as { entry?: unknown[] }).entry)
      ? (body as { entry: unknown[] }).entry.length
      : 0,
  });

  return NextResponse.json({ ok: true });
}

// FB sends GET with hub.mode=subscribe + hub.verify_token + hub.challenge
// during webhook registration. We must echo hub.challenge back.
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await ctx.params;
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const channel = await prisma.recruitInboxChannel.findUnique({
    where: { id: channelId },
    select: { webhookSecret: true },
  });

  if (mode === "subscribe" && token && challenge && token === channel?.webhookSecret) {
    return new Response(challenge, { status: 200 });
  }

  return NextResponse.json({ ok: true, service: "recruit-facebook-webhook" });
}
