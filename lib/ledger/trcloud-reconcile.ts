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
  summary: { matched: number; mismatch: number; missing: number; totalPushed: number };
  mismatches: ReconcileRow[];
  missing: ReconcileRow[];
  lastSyncedAt: string | null;
  snapshotCount: number;
};

const LIST_LIMIT = 200;

export async function getTrcloudReconcile(orgId: string): Promise<TrcloudReconcileData> {
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

  return {
    summary: { matched, mismatch: mismatches.length, missing: missing.length, totalPushed: pushed.length },
    mismatches: mismatches.slice(0, LIST_LIMIT),
    missing: missing.slice(0, LIST_LIMIT),
    lastSyncedAt: lastSync._max.syncedAt ? lastSync._max.syncedAt.toISOString() : null,
    snapshotCount: snapshot.length,
  };
}
