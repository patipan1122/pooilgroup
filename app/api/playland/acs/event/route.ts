// Playland · ACS-F606 webhook receiver
//
// Device dials OUT to this URL (per [[acs-architecture-confirmed]]).
// Auth: shared secret in URL query (?secret=...) — device firmware doesn't support HMAC.
// Response must be ≤1.5s · returns ACS-expected JSON envelope.
//
// Idempotency: every event has unique webhookId · DB UNIQUE constraint blocks dupes.
//
// Vendor PDF says HTTP response for access control MUST contain:
//   { "ActIndex":"0", "AcsRes":"1", "Time":"1" }
// We return that on success; "Time":"0" or skip to NOT open gate.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdapter } from "@/lib/playland/acs/mock-adapter";
import { handleFaceEvent } from "@/lib/playland/session-engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Vendor-style response envelope (per ACS PDF section 11.11) */
function deviceReply(openGate: boolean, message?: string) {
  return {
    AcsRes: openGate ? "1" : "0",
    ActIndex: "0",
    Time: openGate ? "1" : "0",
    ...(message ? { Msg: message } : {}),
  };
}

async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const deviceCode = url.searchParams.get("device");
  const providedSecret = url.searchParams.get("secret") ?? url.searchParams.get("token") ?? "";

  if (!deviceCode) {
    return NextResponse.json(deviceReply(false, "missing device"), { status: 400 });
  }

  // Look up device by deviceId (vendor's serial / paired ID)
  const device = await prisma.playlandDevice.findFirst({
    where: { deviceId: deviceCode },
    include: { branch: true },
  });
  if (!device) {
    return NextResponse.json(deviceReply(false, "device not registered"), { status: 404 });
  }
  if (device.status === "DISABLED") {
    return NextResponse.json(deviceReply(false, "device disabled"), { status: 403 });
  }

  // Verify webhook secret
  if (device.webhookSecret && providedSecret !== device.webhookSecret) {
    return NextResponse.json(deviceReply(false, "bad secret"), { status: 401 });
  }

  // Parse body
  let rawPayload: unknown = null;
  try {
    rawPayload = await req.json();
  } catch {
    return NextResponse.json(deviceReply(false, "invalid json"), { status: 400 });
  }

  // Heartbeat detection (vendor: heartbeat has no Reader field)
  // We delegate parse to adapter
  const adapter = getAdapter(device.vendor);

  // Verify (in mock mode this is just URL secret check we already did)
  const verified = adapter.verifyWebhook(
    JSON.stringify(rawPayload),
    device.webhookSecret ?? "",
    Object.fromEntries(req.headers.entries()),
    url.searchParams,
  );
  if (!verified) {
    return NextResponse.json(deviceReply(false, "verify failed"), { status: 401 });
  }

  const event = adapter.normalizeEvent(rawPayload);
  if (!event) {
    // Update last seen, log raw, return ack
    await prisma.playlandDevice.update({ where: { id: device.id }, data: { lastEventAt: new Date(), lastSeenAt: new Date() } });
    return NextResponse.json(deviceReply(false, "unparseable"));
  }

  // Process
  let outcome;
  try {
    outcome = await handleFaceEvent({
      orgId: device.orgId,
      branchId: device.branchId,
      deviceId: device.id,
      event,
    });
  } catch (err) {
    console.error("[playland/acs/event] handleFaceEvent error", err);
    return NextResponse.json(deviceReply(false, "internal error"), { status: 500 });
  }

  await prisma.playlandDevice.update({
    where: { id: device.id },
    data: { lastSeenAt: new Date(), lastEventAt: new Date(), status: device.status === "OFFLINE" ? "ONLINE" : device.status },
  });

  // Decide whether to open gate. Per CEO decision: exit MUST go through cashier.
  // Open ONLY when direction=in AND member has a valid session that's progressing
  // (resumed re-entry OR already active = duplicate in-scan). Bug from Test 3:
  // outcome "logged_only" also covers "recognized face but no active session" —
  // that case must NOT open. Gate it on session presence via sessionId.
  const shouldOpen =
    event.direction === "in" &&
    outcome.sessionId !== null &&
    (outcome.outcome === "session_resumed" || outcome.outcome === "logged_only");

  return NextResponse.json(deviceReply(shouldOpen, outcome.outcome));
}

export const GET = handle;
export const POST = handle;
