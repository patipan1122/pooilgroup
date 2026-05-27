// Playland · QR scan event handler (server-decide architecture)
//
// Per Lily 2026-05-27:
//   • Device reads ANY QR text · pushes webhook to our server
//   • Our software decides whether gate opens · device follows our reply
//   • Reply field name TBC (Lily engineer pending) · stubbed as `openGate: 0|1`
//
// Decision rules:
//   • Wristband must exist in same orgId as device
//   • status === ACTIVE → ✅ open  (already inside · re-scan = re-open exit)
//   • status === ISSUED → ✅ open  (first entry · activate via gate flow later)
//   • status === RETURNED / LOST → ❌ deny

import { prisma } from "@/lib/prisma";

export interface QRScanOutcome {
  /** true = tell device to open gate · false = deny */
  openGate: boolean;
  /** Short reason · audit logged · shown in Lily debug if she asks */
  reason: string;
  /** Linked wristband id if matched (for downstream session update) */
  wristbandId: string | null;
  /** Linked session id if active */
  sessionId: string | null;
}

export async function handleQRScan(input: {
  orgId: string;
  branchId: string;
  deviceId: string;
  qrCode: string;
  webhookId: string;
  eventAt: Date;
}): Promise<QRScanOutcome> {
  const code = input.qrCode.trim().toUpperCase();

  const w = await prisma.playlandWristband.findFirst({
    where: { code, orgId: input.orgId },
    select: { id: true, branchId: true, status: true, sessionId: true },
  });

  // Always log the scan attempt — even when wristband not found (for fraud detection)
  let outcome: QRScanOutcome;
  if (!w) {
    outcome = { openGate: false, reason: "wristband_not_found", wristbandId: null, sessionId: null };
  } else if (w.branchId !== input.branchId) {
    outcome = { openGate: false, reason: "wrong_branch", wristbandId: w.id, sessionId: null };
  } else if (w.status === "ACTIVE" || w.status === "ISSUED") {
    outcome = { openGate: true, reason: w.status === "ACTIVE" ? "active_re_entry" : "issued_first_entry", wristbandId: w.id, sessionId: w.sessionId };
  } else if (w.status === "LOST") {
    outcome = { openGate: false, reason: "wristband_lost", wristbandId: w.id, sessionId: null };
  } else if (w.status === "RETURNED") {
    outcome = { openGate: false, reason: "wristband_returned", wristbandId: w.id, sessionId: null };
  } else {
    outcome = { openGate: false, reason: `unknown_status_${w.status}`, wristbandId: w.id, sessionId: null };
  }

  // Idempotency · UNIQUE(orgId, wristbandId, scanType, webhookEventId) would be nicer
  // but we already have webhookId on face_events for dupe-blocking · scans are recorded
  // even if device retries (same webhookId attached for forensics)
  if (w) {
    await prisma.playlandWristbandScan.create({
      data: {
        orgId: input.orgId,
        wristbandId: w.id,
        scannedByUserId: null,            // device, not user
        scanType: outcome.openGate ? "GATE_IN" : "LOOKUP",
        outcome: outcome.reason,
        metadata: { source: "acs_device", deviceId: input.deviceId, webhookId: input.webhookId, eventAt: input.eventAt.toISOString() },
      },
    });
    await prisma.playlandWristband.update({
      where: { id: w.id },
      data: { lastScanAt: input.eventAt },
    });
  }

  // Audit (high-value: every gate decision logged)
  // entityId must be uuid — null when wristband not found, qrCode goes in metadata
  await prisma.playlandAuditLog.create({
    data: {
      orgId: input.orgId,
      branchId: input.branchId,
      actorRole: "system",
      action: outcome.openGate ? "wristband.gate_open" : "wristband.gate_deny",
      entityType: "PlaylandWristband",
      entityId: w?.id ?? null,
      category: "device",
      metadata: { qrCode: code, deviceId: input.deviceId, webhookId: input.webhookId },
      after: { reason: outcome.reason, openGate: outcome.openGate },
    },
  });

  return outcome;
}
