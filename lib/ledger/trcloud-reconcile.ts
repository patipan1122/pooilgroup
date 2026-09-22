import "server-only";
import { prisma } from "@/lib/prisma";

// Phase 2 · เทียบยอด TRCloud ↔ LedgerLine (อ่านล้วน).
// ตอบคำถาม: "ของที่เราส่งเข้า TRCloud ครบ + ยอดตรงไหม?"
//   - ใบ LedgerLine ที่ส่งแล้ว (trcloudPushedAt≠null) จับคู่กับ snapshot 3 ทาง
//     (trcloudDocId==trcloud_id · trcloudDocNo==doc_number · docCode==trcloud_reference)
//   - เจอ + ยอดตรง (±1฿) = ✅ · เจอ + ยอดต่าง = ⚠️ ยอดไม่ตรง · ไม่เจอ = ⚠️ ส่งแล้วหาไม่เจอ
// ⚠️ ขึ้นกับความสดของ snapshot → เตือนให้กด "รีเฟรช" หน้าเอกสาร TRCloud ก่อน

const SENTINELS = new Set(["sent", "error", "pending", ""]);
const AMOUNT_TOLERANCE = 1; // ±1 บาท (กันเศษสตางค์ปัดของ TRCloud)
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000; // ไทยไม่มี DST → UTC+7 คงที่เสมอ

export type ReconcileRow = {
  expenseId: string;
  docCode: string;
  vendor: string | null;
  ourTotal: number;
  trcloudTotal: number | null;
  diff: number | null;
  trcloudKind: "PO" | "AP" | null;
  trcloudDocNo: string | null;
  pushedAt: string | null;
  pdfUrl: string | null;
};

export type TrcloudReconcileData = {
  // all-time เสมอ — ไม่ขึ้นกับช่วงเดือนที่เลือกดูตาราง (CEO: "ไม่มีทางตกหล่น")
  summary: { matched: number; mismatch: number; missing: number; totalPushed: number };
  // กรองตามช่วงเดือนที่เลือก (periodFrom–periodTo) แล้ว slice แสดงผลไม่เกิน LIST_LIMIT
  mismatches: ReconcileRow[];
  missing: ReconcileRow[];
  // จำนวนจริงในช่วงที่เลือก (ก่อน slice) — ใช้โชว์หัวตาราง + เช็คว่าโดนตัดไหม
  mismatchCountInRange: number;
  missingCountInRange: number;
  lastSyncedAt: string | null;
  snapshotCount: number;
};

const LIST_LIMIT = 200;

/**
 * แปลงช่วงเดือน "YYYY-MM" (from → to) เป็นขอบเขตเวลาแบบ UTC instant นับเป็นเวลาไทย
 * เช่น "2026-09"→"2026-09" = ตั้งแต่ 2026-09-01 00:00 ไทย (=2026-08-31T17:00:00Z)
 * ถึงก่อน 2026-10-01 00:00 ไทย (exclusive) — กันบั๊กตัดเที่ยงคืน-ตี6 ผิดช่วงแบบ UTC ดิบ
 */
function monthRangeToUtcBounds(periodFrom: string, periodTo: string): { start: Date; endExclusive: Date } {
  const [fy, fm] = periodFrom.split("-").map(Number);
  const [ty, tm] = periodTo.split("-").map(Number);
  const start = new Date(Date.UTC(fy, (fm || 1) - 1, 1, 0, 0, 0, 0) - BANGKOK_OFFSET_MS);
  const endExclusive = new Date(Date.UTC(ty, tm || 1, 1, 0, 0, 0, 0) - BANGKOK_OFFSET_MS);
  return { start, endExclusive };
}

function isInRange(iso: string | null, start: Date, endExclusive: Date): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= start.getTime() && t < endExclusive.getTime();
}

export async function getTrcloudReconcile(
  orgId: string,
  periodFrom: string,
  periodTo: string,
): Promise<TrcloudReconcileData> {
  const [pushed, snapshot, lastSync] = await Promise.all([
    prisma.ledgerExpense.findMany({
      where: { orgId, trcloudPushedAt: { not: null }, status: { not: "void" } },
      select: {
        id: true, docCode: true, vendor: true, total: true,
        trcloudDocId: true, trcloudDocNo: true, trcloudPushedAt: true,
      },
      orderBy: { trcloudPushedAt: "desc" },
    }),
    prisma.ledgerTrcloudDoc.findMany({
      where: { orgId },
      select: { trcloudId: true, docNumber: true, trcloudReference: true, grandTotal: true, total: true, kind: true, pdfUrl: true },
    }),
    prisma.ledgerTrcloudDoc.aggregate({ where: { orgId }, _max: { syncedAt: true } }),
  ]);

  // maps สำหรับจับคู่
  const byId = new Map<string, (typeof snapshot)[number]>();
  const byNo = new Map<string, (typeof snapshot)[number]>();
  const byRef = new Map<string, (typeof snapshot)[number]>();
  for (const s of snapshot) {
    if (s.trcloudId) byId.set(s.trcloudId, s);
    if (s.docNumber) byNo.set(s.docNumber, s);
    if (s.trcloudReference) byRef.set(s.trcloudReference, s);
  }

  let matched = 0;
  const mismatches: ReconcileRow[] = [];
  const missing: ReconcileRow[] = [];

  for (const e of pushed) {
    const idKey = e.trcloudDocId && !SENTINELS.has(e.trcloudDocId) ? e.trcloudDocId : null;
    const snap =
      (idKey ? byId.get(idKey) : undefined) ??
      (e.trcloudDocNo ? byNo.get(e.trcloudDocNo) : undefined) ??
      byRef.get(e.docCode);

    const ourTotal = Number(e.total);
    if (!snap) {
      missing.push({
        expenseId: e.id, docCode: e.docCode, vendor: e.vendor,
        ourTotal, trcloudTotal: null, diff: null, trcloudKind: null,
        trcloudDocNo: e.trcloudDocNo, pushedAt: e.trcloudPushedAt ? e.trcloudPushedAt.toISOString() : null,
        pdfUrl: null,
      });
      continue;
    }
    const trcloudTotal = snap.grandTotal != null ? Number(snap.grandTotal) : (snap.total != null ? Number(snap.total) : null);
    const diff = trcloudTotal != null ? Math.round((ourTotal - trcloudTotal) * 100) / 100 : null;
    if (diff == null || Math.abs(diff) > AMOUNT_TOLERANCE) {
      mismatches.push({
        expenseId: e.id, docCode: e.docCode, vendor: e.vendor,
        ourTotal, trcloudTotal, diff, trcloudKind: snap.kind as "PO" | "AP",
        trcloudDocNo: snap.docNumber, pushedAt: e.trcloudPushedAt ? e.trcloudPushedAt.toISOString() : null,
        pdfUrl: snap.pdfUrl,
      });
    } else {
      matched += 1;
    }
  }

  // ⚠️ summary ด้านบนต้องมาจาก mismatches/missing/pushed แบบเต็ม (all-time) เท่านั้น — ห้ามคำนวณจากที่กรองช่วงเดือนแล้ว
  // ตารางรายละเอียดถึงค่อยกรองตามช่วงเดือนที่เลือก (ใช้ trcloudPushedAt ทุกแถว — เป็น field เดียวที่มีครบทั้ง mismatch/missing
  // เพราะ missing ไม่มี snapshot ที่จับคู่ได้เลยจึงไม่มี issueDate ของ TRCloud ให้ใช้)
  const { start, endExclusive } = monthRangeToUtcBounds(periodFrom, periodTo);
  const mismatchesInRange = mismatches.filter((r) => isInRange(r.pushedAt, start, endExclusive));
  const missingInRange = missing.filter((r) => isInRange(r.pushedAt, start, endExclusive));

  return {
    summary: { matched, mismatch: mismatches.length, missing: missing.length, totalPushed: pushed.length },
    mismatches: mismatchesInRange.slice(0, LIST_LIMIT),
    missing: missingInRange.slice(0, LIST_LIMIT),
    mismatchCountInRange: mismatchesInRange.length,
    missingCountInRange: missingInRange.length,
    lastSyncedAt: lastSync._max.syncedAt ? lastSync._max.syncedAt.toISOString() : null,
    snapshotCount: snapshot.length,
  };
}
