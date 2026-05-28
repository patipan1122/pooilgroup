// Playland · ACS-F606 / USD 239 webhook receiver
//
// Device dials OUT to this URL (per [[acs-architecture-confirmed]]).
// Auth: shared secret in URL query (?secret=...) — device firmware doesn't support HMAC.
// Response must be ≤1.5s · returns ACS-expected JSON envelope.
//
// Idempotency: every event has unique webhookId · DB UNIQUE constraint blocks dupes.
//
// Reply format per doc-2 §2.6.1 (face events · ACK only — face decision is LOCAL):
//   { "result": 0, "message": "OK" }   // device drops record from retry queue
//   { "result": 1, "message": "..."}   // device WILL re-push same record
//
// QR-scan reply (server-decide per Lily 2026-05-27 · USD 239 dual-mode device):
//   { "result": 0, "openGate": 1, "message": "OK" }  // tell gate to open
//   { "result": 0, "openGate": 0, "message": "..."}  // ack but DENY open
//   ↑ exact field name TBC by Lily engineer · stubbed `openGate` for now ·
//     to switch field, grep "openGate" in this file + handle-qr-scan.ts.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdapter } from "@/lib/playland/acs/mock-adapter";
import { handleFaceEvent } from "@/lib/playland/session-engine";
import { handleQRScan } from "@/lib/playland/acs/handle-qr-scan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * ACS reply envelope per doc-2 §2.6.1.
 * `result: 0` = ack (device drops the record from its retry queue).
 * `result: 1` = transient failure (device WILL re-push same `id` later).
 * Use `result:1` only for genuine retry-worthy errors (DB outage etc).
 * For permanent rejects (unknown device, bad secret) use `result:0` so
 * device doesn't spam us forever.
 */
function ack(message = "OK") {
  return { result: 0, message };
}
function nack(message: string) {
  return { result: 1, message };
}
/** QR-scan reply · device follows `openGate` flag. */
function gateReply(open: boolean, message: string) {
  return { result: 0, openGate: open ? 1 : 0, message };
}

async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const deviceCode = url.searchParams.get("device");
  const providedSecret = url.searchParams.get("secret") ?? url.searchParams.get("token") ?? "";

  // Permanent rejects below use ack() (result:0) so device doesn't retry forever.
  // Transient errors use nack() (result:1) so device re-pushes the record.

  if (!deviceCode) {
    return NextResponse.json(ack("missing device"), { status: 400 });
  }

  const device = await prisma.playlandDevice.findFirst({
    where: { deviceId: deviceCode },
    include: { branch: true },
  });
  if (!device) {
    return NextResponse.json(ack("device not registered"), { status: 404 });
  }
  if (device.status === "DISABLED") {
    return NextResponse.json(ack("device disabled"), { status: 403 });
  }

  if (device.webhookSecret && providedSecret !== device.webhookSecret) {
    return NextResponse.json(ack("bad secret"), { status: 401 });
  }

  let rawPayload: unknown = null;
  try {
    rawPayload = await req.json();
  } catch {
    return NextResponse.json(ack("invalid json"), { status: 400 });
  }

  const adapter = getAdapter(device.vendor);

  const verified = adapter.verifyWebhook(
    JSON.stringify(rawPayload),
    device.webhookSecret ?? "",
    Object.fromEntries(req.headers.entries()),
    url.searchParams,
  );
  if (!verified) {
    return NextResponse.json(ack("verify failed"), { status: 401 });
  }

  const event = adapter.normalizeEvent(rawPayload);
  if (!event) {
    // Heartbeat (no event id) or unparseable → bump last-seen + ack so device drops it
    await prisma.playlandDevice.update({
      where: { id: device.id },
      data: { lastEventAt: new Date(), lastSeenAt: new Date() },
    });
    return NextResponse.json(ack("ack (no event payload)"));
  }

  // QR-scan branch · server decides gate open · reply with openGate flag
  if (event.type === "qr_scan" && event.qrCode) {
    let qrOutcome;
    try {
      qrOutcome = await handleQRScan({
        orgId: device.orgId,
        branchId: device.branchId,
        deviceId: device.id,
        qrCode: event.qrCode,
        webhookId: event.webhookId,
        eventAt: event.eventAt,
      });
    } catch (err) {
      console.error("[playland/acs/event] handleQRScan error", err);
      return NextResponse.json(nack("qr handler error"), { status: 500 });
    }
    await prisma.playlandDevice.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date(), lastEventAt: new Date(), status: device.status === "OFFLINE" ? "ONLINE" : device.status },
    });
    return NextResponse.json(gateReply(qrOutcome.openGate, qrOutcome.reason));
  }

  // Face / heartbeat / stranger · existing path (device decides locally)
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
    // Retry-worthy: DB outage or transient error · device will re-push
    return NextResponse.json(nack("internal error"), { status: 500 });
  }

  await prisma.playlandDevice.update({
    where: { id: device.id },
    data: { lastSeenAt: new Date(), lastEventAt: new Date(), status: device.status === "OFFLINE" ? "ONLINE" : device.status },
  });

  return NextResponse.json(ack(outcome.outcome));
}

export const GET = handle;
export const POST = handle;
