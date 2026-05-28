"use server";

// Playland · Manual gate override (anti-fraud) · /bigfeature Phase A
//
// Per CEO 2026-05-27 ([[playland-manual-override-antifraud]]):
//   staff CAN press override BUT every press REQUIRES:
//     1. webcam snapshot of who entered (proof it's a real customer)
//     2. log which staff pressed it (actorUserId)
//     3. a reason
//   → audit log (category=device) + snapshot in R2 + optional remote gate open.
//
// In-app override = ONLY works when online (the paradox CEO spotted: if you can
// press it in the app, the net is up). Offline → hardware button on the device.

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canPlaylandCashier } from "./role-guard";
import { verifyBranchOrg } from "./guards";
import { decodePhotoDataUrl } from "./guards";
import { requireOpenShift } from "./wristband";
import { putObject } from "@/lib/r2/upload";
import { getAdapter } from "./acs/mock-adapter";
import { revalidatePath } from "next/cache";
import crypto from "node:crypto";

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };
function err(msg: string) { return { ok: false as const, error: msg }; }

export const OVERRIDE_REASONS = [
  "QR_DAMAGED",       // QR เปียก/ขาด/อ่านไม่ออก
  "NET_SLOW",         // ระบบช้า ลูกค้ารอนาน
  "CHILD_EMERGENCY",  // เด็กฉุกเฉิน ต้องเข้า/ออกด่วน
  "VIP_STAFF",        // VIP / พนักงาน
  "OTHER",            // อื่นๆ (ต้องพิมพ์)
] as const;
export type OverrideReason = (typeof OVERRIDE_REASONS)[number];

export async function manualGateOverride(input: {
  branchId: string;
  deviceId?: string;          // which gate device (entry/exit). default: first active at branch
  reason: OverrideReason;
  reasonNote?: string;        // required when reason === OTHER
  snapshotDataUrl: string;    // webcam JPEG dataURL · MANDATORY
  wristbandCode?: string;     // optional · link to a wristband if known
}): Promise<ActionResult<{ overrideId: string; gateOpened: boolean }>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์");
  if (!(await verifyBranchOrg(input.branchId, session.user.org_id))) return err("สาขาไม่อยู่ใน org");

  // Shift required (per W3 · same as every cashier action)
  try { await requireOpenShift(session.user.org_id, input.branchId, session.user.id); }
  catch (e) { return err(e instanceof Error ? e.message : "shift required"); }

  if (input.reason === "OTHER" && !input.reasonNote?.trim()) {
    return err("เลือก 'อื่นๆ' ต้องพิมพ์เหตุผล");
  }

  // Snapshot is MANDATORY · this is the anti-fraud proof
  if (!input.snapshotDataUrl) return err("ต้องถ่ายรูปก่อนเปิดประตู (anti-fraud)");
  let snapshotBuf: Buffer;
  try { snapshotBuf = decodePhotoDataUrl(input.snapshotDataUrl, 2_000_000); }
  catch (e) { return err(e instanceof Error ? e.message : "snapshot invalid"); }

  // Upload snapshot to R2 · key namespaced per org/month
  const ym = new Date().toISOString().slice(0, 7);
  const key = `playland/overrides/${session.user.org_id}/${ym}/${crypto.randomUUID()}.jpg`;
  let snapshotUrl: string;
  try { snapshotUrl = await putObject(key, snapshotBuf, "image/jpeg"); }
  catch (e) { console.error("[gate-override] R2 upload failed", e); return err("อัปโหลดรูปไม่สำเร็จ · ลองใหม่"); }

  // Optional wristband link
  let wristbandId: string | null = null;
  if (input.wristbandCode?.trim()) {
    const w = await prisma.playlandWristband.findFirst({
      where: { code: input.wristbandCode.trim().toUpperCase(), orgId: session.user.org_id },
      select: { id: true },
    });
    wristbandId = w?.id ?? null;
  }

  // Resolve gate device (entry/exit). Default: first active device at branch.
  const device = await prisma.playlandDevice.findFirst({
    where: input.deviceId
      ? { id: input.deviceId, orgId: session.user.org_id, branchId: input.branchId }
      : { orgId: session.user.org_id, branchId: input.branchId, status: { not: "DISABLED" } },
    orderBy: { createdAt: "asc" },
  });

  // Audit FIRST (so the override is recorded even if the gate command fails)
  const audit = await prisma.playlandAuditLog.create({
    data: {
      orgId: session.user.org_id,
      branchId: input.branchId,
      actorUserId: session.user.id,
      actorRole: session.user.role,
      action: "gate.manual_override",
      entityType: "PlaylandDevice",
      entityId: device?.id ?? null,
      category: "device",
      metadata: {
        reason: input.reason,
        reasonNote: input.reasonNote ?? null,
        snapshotUrl,
        wristbandCode: input.wristbandCode?.trim()?.toUpperCase() ?? null,
        deviceId: device?.deviceId ?? null,
      },
      after: { gateOpenAttempted: Boolean(device) },
    },
  });

  // Try to open the gate (best-effort · LAN may be unreachable from cloud)
  let gateOpened = false;
  if (device?.baseUrl) {
    try {
      const adapter = getAdapter(device.vendor);
      if (adapter.emergencyOpen) {
        await adapter.emergencyOpen({
          id: device.id,
          deviceId: device.deviceId,
          baseUrl: device.baseUrl,
          protocol: device.protocol as "http" | "tcp",
          modelVersion: device.modelVersion as "B" | "C",
          webhookSecret: device.webhookSecret ?? "",
        });
        gateOpened = true;
      }
    } catch (e) {
      console.warn("[gate-override] remote open failed (staff must open manually at gate)", e);
    }
  }

  // Link the scan record if a wristband was identified
  if (wristbandId) {
    await prisma.playlandWristbandScan.create({
      data: {
        orgId: session.user.org_id,
        wristbandId,
        scannedByUserId: session.user.id,
        scanType: "GATE_IN",
        outcome: "manual_override",
        metadata: { reason: input.reason, snapshotUrl, auditId: audit.id, gateOpened },
      },
    });
  }

  revalidatePath("/playland/scan");
  revalidatePath("/playland/audit");
  return { ok: true, data: { overrideId: audit.id, gateOpened } };
}
