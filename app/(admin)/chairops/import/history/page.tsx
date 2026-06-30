// =============================================================
// CSV Import History + delete (CEO 2026-06-30)
// =============================================================
// "อัปไฟล์ CSV แล้ว super admin ไม่เห็น + อยากลบได้" → this one page lists EVERY
// maid-collection import across all branches and the full date range (so it
// can't hide behind the ledger's per-branch / 30-day default), and lets the
// super_admin soft-delete a whole import or a single row (reversible).
//
// View: ADMIN+ (so office admins can audit). Delete/restore: super_admin only
// (enforced again in ./actions.ts — the buttons are also hidden when !canDelete).

import Link from "next/link";
import { ChevronLeft, History, Upload } from "lucide-react";
import { requireRole } from "@/lib/chairops/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { getCsvImportHistory } from "@/lib/chairops/queries/import-history";
import { ImportHistoryClient } from "./_components/import-history-client";

export const dynamic = "force-dynamic";

export default async function CsvImportHistoryPage() {
  const session = await requireRole("ADMIN");
  const canDelete = isSuperAdmin(session.poolUser.role);
  const batches = await getCsvImportHistory({ orgId: session.user.orgId });

  const activeBatches = batches.filter((b) => b.status !== "deleted").length;
  const totalActive = batches.reduce((s, b) => s + b.totalAmount, 0);

  return (
    <div className="chairops-scope mx-auto max-w-4xl space-y-4 p-4">
      <Link
        href="/chairops/import/maid-collections"
        className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-zinc-600 hover:text-zinc-900"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden="true" /> กลับหน้านำเข้า
      </Link>

      <header className="space-y-1">
        <p className="text-xs font-semibold text-zinc-500">นำเข้า · ChairOps</p>
        <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-900">
          <History className="size-5 text-zinc-400" /> ประวัติการนำเข้า CSV
        </h1>
        <p className="text-sm text-zinc-500">
          ทุกครั้งที่พนักงานอัปไฟล์เก็บเงินแม่บ้าน (CSV) จะมาอยู่ที่นี่ — เห็นครบทุกสาขา
          ทุกวัน · กดดูรายการในแต่ละชุดได้ ·{" "}
          {canDelete
            ? "ลบทั้งชุดหรือทีละแถวได้ (ลบแบบซ่อน เรียกคืนได้)"
            : "การลบทำได้เฉพาะผู้ดูแลสูงสุด"}
        </p>
      </header>

      <div className="flex flex-wrap gap-3">
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5">
          <div className="text-xs text-zinc-500">ชุดที่ใช้งานอยู่</div>
          <div className="text-lg font-bold text-zinc-900">{activeBatches}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5">
          <div className="text-xs text-zinc-500">ยอดรวมที่นำเข้า (ใช้งานอยู่)</div>
          <div className="font-mono text-lg font-bold text-zinc-900">
            {totalActive.toLocaleString("en-US")} ฿
          </div>
        </div>
        <Link
          href="/chairops/import/maid-collections"
          className="ml-auto inline-flex items-center gap-1.5 self-center rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          <Upload className="size-4" /> นำเข้าไฟล์ใหม่
        </Link>
      </div>

      <ImportHistoryClient batches={batches} canDelete={canDelete} />

      <p className="pt-2 text-xs text-zinc-400">
        💡 ลบที่นี่ = ซ่อนออกจากทุกหน้า (ตรวจยอด · รายงาน · รอบเก็บ) และคิดยอดขาด-เกินใหม่ทันที
        · ข้อมูลไม่หายจริง กดเรียกคืนได้ และมีบันทึกว่าใครลบเมื่อไร
      </p>
    </div>
  );
}
