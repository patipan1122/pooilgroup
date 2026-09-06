// รายงานภาษีซื้อ (Input VAT / ภ.พ.30 · CEO 2026-07-24)
// เห็นทั้งเดือนว่าใบไหนมี VAT · ใบไหนขอคืนได้ · ใบไหน "ติด" เพราะไม่มีใบกำกับเต็มรูป
// (ในนามเจพีซิ้งค์). ข้อมูลมาจากตอน AI สแกน + gradeCompleteness — read-only ล้วน.
import Link from "next/link";
import { ChevronLeft, ChevronRight, ReceiptText } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../_scope";
import { LedgerHeader, NoCompanyState } from "../_components/LedgerHeader";
import { currentPeriodBangkok } from "@/lib/ledger/dashboard";
import { getInputVatReport, type InputVatRow } from "@/lib/ledger/input-vat-report";

export const dynamic = "force-dynamic";

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${TH_MONTHS[m - 1] ?? month} ${(y + 543) % 100}`;
}
function dayLabel(d: string | null): string {
  if (!d) return "—";
  const [, m, day] = d.split("-").map(Number);
  return `${day} ${TH_MONTHS[m - 1] ?? ""}`;
}
function shiftMonth(month: string, delta: number): string {
  let [y, m] = month.split("-").map(Number);
  m += delta;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}
function baht(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const VALID_MONTH = /^\d{4}-\d{2}$/;

// ป้ายสถานะใบกำกับ (completenessStatus)
function invoiceBadge(status: string): { dot: string; label: string; cls: string } {
  switch (status) {
    case "green_full": return { dot: "🟢", label: "ใบกำกับเต็มรูป", cls: "text-emerald-700 bg-emerald-50 border-emerald-200" };
    case "yellow_partial": return { dot: "🟡", label: "ไม่ครบ", cls: "text-amber-700 bg-amber-50 border-amber-200" };
    case "red_invalid": return { dot: "🔴", label: "ใช้ไม่ได้", cls: "text-red-700 bg-red-50 border-red-200" };
    default: return { dot: "⚪", label: "ยังไม่ตรวจ", cls: "text-zinc-500 bg-zinc-50 border-zinc-200" };
  }
}
const BLOCK_REASON_TH: Record<string, string> = {
  abbreviated_86_6: "บิลเงินสด/ใบกำกับอย่างย่อ (ม.86/6)",
  buyer_mismatch: "ไม่ใช่ชื่อเจพีซิ้งค์",
  wrong_entity: "ออกให้บริษัทในเครืออื่น",
  incomplete_invoice: "ใบกำกับไม่ครบ/ไม่มี VAT แยก",
  entertainment: "ค่ารับรอง (กฎหมายห้ามขอคืน)",
  passenger_car: "รถยนต์นั่ง (กฎหมายห้ามขอคืน)",
  other: "อื่นๆ",
};

export default async function InputVatReportPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; branch?: string; m?: string }>;
}) {
  const session = await requireRole("super_admin", "org_admin", "admin", "area_manager", "viewer", "program_admin");
  const sp = await searchParams;
  const scope = await resolveScope(session.user.org_id, sp);

  if (!scope.companyId) {
    return (
      <div className="p-4 sm:px-6 sm:pt-4 sm:pb-6">
        <LedgerHeader title="รายงานภาษีซื้อ" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  const month = sp.m && VALID_MONTH.test(sp.m) ? sp.m : currentPeriodBangkok();
  const report = await getInputVatReport(scope.orgId, scope.companyId, {
    branchId: scope.branchId,
    month,
  });

  const base = new URLSearchParams();
  if (sp.company) base.set("company", sp.company);
  if (sp.branch) base.set("branch", sp.branch);
  const monthHref = (mm: string) => {
    const p = new URLSearchParams(base);
    p.set("m", mm);
    return `/ledger/tax?${p.toString()}`;
  };

  const { totals, rows, buyer } = report;

  return (
    <div className="p-4 sm:px-6 sm:pt-4 sm:pb-6">
      <LedgerHeader
        title="รายงานภาษีซื้อ"
        subtitle="ใบไหนมี VAT · ขอคืนได้ · หรือติดเพราะไม่มีใบกำกับเต็มรูป"
        scope={scope}
      />

      {/* ผู้ซื้อ + เดือน */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-zinc-500">
          ใบกำกับภาษีต้องออกในนาม{" "}
          <span className="font-medium text-zinc-700">{buyer.name}</span>{" "}
          <span className="text-zinc-400">({buyer.taxId})</span> ถึงขอคืน VAT ได้
        </p>
        <div className="flex items-center gap-1">
          <Link href={monthHref(shiftMonth(month, -1))} className="inline-flex size-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50">
            <ChevronLeft className="size-4" />
          </Link>
          <span className="min-w-24 text-center text-sm font-semibold">{monthLabel(month)}</span>
          <Link href={monthHref(shiftMonth(month, 1))} className="inline-flex size-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50">
            <ChevronRight className="size-4" />
          </Link>
        </div>
      </div>

      {/* การ์ดสรุป 3 ตัว */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5">
          <div className="text-[11px] text-zinc-500">VAT รวมทั้งเดือน</div>
          <div className="mt-0.5 text-lg font-bold tabular-nums">{baht(totals.totalVat)}</div>
          <div className="text-[11px] text-zinc-400">{totals.count} ใบ</div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
          <div className="text-[11px] text-emerald-700">🟢 ขอคืนได้</div>
          <div className="mt-0.5 text-lg font-bold text-emerald-700 tabular-nums">{baht(totals.claimableVat)}</div>
          <div className="text-[11px] text-emerald-600/70">{totals.claimableCount} ใบ</div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5">
          <div className="text-[11px] text-amber-700">⚠️ ติด (ขอคืนไม่ได้)</div>
          <div className="mt-0.5 text-lg font-bold text-amber-700 tabular-nums">{baht(totals.blockedVat)}</div>
          <div className="text-[11px] text-amber-600/70">{totals.blockedCount} ใบ</div>
        </div>
      </div>

      {/* ตาราง */}
      {rows.length === 0 ? (
        <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 py-12 text-zinc-400">
          <ReceiptText className="size-8" />
          <p className="mt-2 text-sm">เดือนนี้ยังไม่มีบิลที่มี VAT</p>
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-zinc-200">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-zinc-50 text-[11px] uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">วันที่</th>
                <th className="px-3 py-2 text-left font-medium">ผู้ขาย</th>
                <th className="px-3 py-2 text-left font-medium">หมวด</th>
                <th className="px-3 py-2 text-right font-medium">VAT</th>
                <th className="px-3 py-2 text-left font-medium">ใบกำกับ</th>
                <th className="px-3 py-2 text-left font-medium">ขอคืน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((r: InputVatRow) => {
                const badge = invoiceBadge(r.completenessStatus);
                const claimable = r.inputVatClaimable === true;
                return (
                  <tr key={r.id} className="hover:bg-zinc-50/60">
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-500">{dayLabel(r.docDate)}</td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/ledger/expenses?${base.toString()}${base.toString() ? "&" : ""}selected=${r.id}`}
                        className="font-medium text-zinc-800 hover:text-[var(--color-brand-600)] hover:underline"
                      >
                        {r.vendor || r.docCode}
                      </Link>
                      {r.vendorTaxId && <div className="text-[11px] text-zinc-400">{r.vendorTaxId}</div>}
                    </td>
                    <td className="px-3 py-2 text-zinc-500">{r.categoryName || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">{baht(r.vat)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${badge.cls}`}>
                        {badge.dot} {badge.label}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {claimable ? (
                        <span className="text-[12px] font-medium text-emerald-700">✓ ขอคืนได้</span>
                      ) : (
                        <span className="text-[12px] text-amber-700">
                          ✗ ไม่ได้
                          {r.inputVatBlockReason && (
                            <span className="text-zinc-400"> · {BLOCK_REASON_TH[r.inputVatBlockReason] ?? r.inputVatBlockReason}</span>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[11px] text-zinc-400">
        * "ขอคืนได้" = ระบบตรวจว่าเป็นใบกำกับภาษีเต็มรูปในนามเจพีซิ้งค์ · นักบัญชีปรับ/ยืนยันรายใบได้ในหน้ารายจ่าย
      </p>
    </div>
  );
}
