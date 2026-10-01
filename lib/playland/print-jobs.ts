"use server";

// Playland · สั่งพิมพ์สายรัดจากแคชเชียร์ → เข้าคิว → agent หน้าร้านพิมพ์ออกเครื่อง K2
// เบราว์เซอร์วางบิตแมปแล้ว (lib/playland/wristband-bitmap.ts) · ที่นี่ตรวจสิทธิ์ + ตรวจบิตแมป + เข้าคิว
// ถ้าไม่มีเครื่องพิมพ์ / เครื่องออฟไลน์ → คืน error code ให้ UI สลับไปพิมพ์แบบเดิม (popup) ทันที ไม่ปล่อยแคชเชียร์รอเก้อ

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canPlaylandCashier } from "./role-guard";
import { verifyBranchAssignment } from "./guards";
import { WRISTBAND_BITMAP_BYTES } from "./wristband-bitmap-spec";

export type PrintActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string; code?: "NO_PRINTER" | "PRINTER_OFFLINE" | "QUEUE_FULL" | "BAD_BITMAP" };

const ONLINE_WINDOW_MS = 45_000; // agent ถามคิวทุก ~3 วิ · เงียบเกินนี้ = ออฟไลน์
const MAX_PENDING_PER_PRINTER = 20;

function fail(error: string, code?: "NO_PRINTER" | "PRINTER_OFFLINE" | "QUEUE_FULL" | "BAD_BITMAP") {
  return { ok: false as const, error, code };
}

async function activePrinter(orgId: string, branchId: string) {
  return prisma.playlandPrinter.findFirst({
    where: { orgId, branchId, enabled: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, lastSeenAt: true },
  });
}

function isOnline(lastSeenAt: Date | null): boolean {
  return !!lastSeenAt && Date.now() - lastSeenAt.getTime() < ONLINE_WINDOW_MS;
}

export async function getBranchPrinterStatus(branchId: string): Promise<PrintActionResult<{ configured: boolean; online: boolean; name: string | null }>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return fail("ไม่มีสิทธิ์");
  if (!(await verifyBranchAssignment(branchId, session.user.org_id, session.user.id, session.user.role))) return fail("คุณไม่ได้รับมอบหมายให้ทำงานสาขานี้");

  const p = await activePrinter(session.user.org_id, branchId);
  return { ok: true, data: { configured: !!p, online: !!p && isOnline(p.lastSeenAt), name: p?.name ?? null } };
}

export async function enqueueWristbandPrint(input: {
  branchId: string;
  bitmapBase64: string;
  wristbandCode: string;
  memberId?: string | null;
  displayName?: string | null;
}): Promise<PrintActionResult<{ jobId: string }>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return fail("ไม่มีสิทธิ์");
  if (!(await verifyBranchAssignment(input.branchId, session.user.org_id, session.user.id, session.user.role))) return fail("คุณไม่ได้รับมอบหมายให้ทำงานสาขานี้");

  // บิตแมปต้องเป๊ะ 41,200 ไบต์ (1648 แถว x 25) และมีจุดดำจริง — กันภาพว่าง/พังออกเครื่อง เสียสติกเกอร์
  const bytes = Buffer.from(input.bitmapBase64, "base64");
  if (bytes.length !== WRISTBAND_BITMAP_BYTES) return fail(`บิตแมปขนาดไม่ถูกต้อง (${bytes.length} ไบต์)`, "BAD_BITMAP");
  let black = 0;
  for (let i = 0; i < bytes.length; i++) {
    let b = bytes[i];
    while (b) {
      black += b & 1;
      b >>= 1;
    }
  }
  if (black < 500) return fail("บิตแมปว่างเปล่า", "BAD_BITMAP");

  const printer = await activePrinter(session.user.org_id, input.branchId);
  if (!printer) return fail("สาขานี้ยังไม่มีเครื่องพิมพ์สายรัด", "NO_PRINTER");
  if (!isOnline(printer.lastSeenAt)) return fail("เครื่องพิมพ์ออฟไลน์ (โปรแกรมหน้าร้านไม่ตอบ)", "PRINTER_OFFLINE");

  const pending = await prisma.playlandPrintJob.count({ where: { printerId: printer.id, status: { in: ["PENDING", "PRINTING"] } } });
  if (pending >= MAX_PENDING_PER_PRINTER) return fail("คิวพิมพ์ยาวเกินไป ลองใหม่อีกครู่", "QUEUE_FULL");

  const job = await prisma.playlandPrintJob.create({
    data: {
      orgId: session.user.org_id,
      branchId: input.branchId,
      printerId: printer.id,
      kind: "WRISTBAND",
      bitmapBase64: input.bitmapBase64,
      meta: { wristbandCode: input.wristbandCode, memberId: input.memberId ?? null, name: input.displayName ?? null },
      createdByUserId: session.user.id,
    },
    select: { id: true },
  });
  return { ok: true, data: { jobId: job.id } };
}

export async function getPrintJobStatus(jobId: string): Promise<PrintActionResult<{ status: "PENDING" | "PRINTING" | "DONE" | "FAILED"; error: string | null }>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return fail("ไม่มีสิทธิ์");
  const job = await prisma.playlandPrintJob.findFirst({
    where: { id: jobId, orgId: session.user.org_id },
    select: { status: true, errorMessage: true },
  });
  if (!job) return fail("ไม่พบงานพิมพ์");
  return { ok: true, data: { status: job.status, error: job.errorMessage } };
}
