// InstallmentTimeline — งวดงาน (F3) จัดกลุ่มตามผู้รับเหมา (vendorLabel = แถบหัวกลุ่ม).
// มือถือ = การ์ดแนวตั้ง · เดสก์ท็อป = แถวเช็คลิสต์กว้าง. paid → ReceiptThumb(slip) + โอนจริง.
// Footer: ยอดสัญญารวม · จ่ายจริง(เขียวเท่านั้น) · รอสลิป(แยก) · สลิปหลุด(เตือน).
// Server Component — client islands (MarkPaidSheet / InstallmentFormDialog / RowActions) เฉพาะ action.
import { CalendarDays, TriangleAlert } from "lucide-react";
import { ReceiptThumb } from "@/components/ledger/ReceiptThumb";
import { thaiDateLong } from "@/lib/utils/format";
import type {
  LedgerInstallmentRow,
  ProjectInstallmentSummary,
} from "@/lib/ledger/installments";
import { InstallmentStatusBadge } from "./InstallmentStatusBadge";
import { MarkPaidSheet } from "./MarkPaidSheet";
import { InstallmentFormDialog } from "./InstallmentFormDialog";
import { InstallmentRowActions } from "./InstallmentRowActions";

function baht(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} ฿`;
}

type Group = { vendorLabel: string | null; rows: LedgerInstallmentRow[] };

/** จัดกลุ่มตาม vendorLabel โดยคงลำดับที่มาจาก DB (seq asc). */
function groupByVendor(rows: LedgerInstallmentRow[]): Group[] {
  const order: (string | null)[] = [];
  const map = new Map<string | null, LedgerInstallmentRow[]>();
  for (const r of rows) {
    const key = r.vendorLabel ?? null;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(r);
  }
  return order.map((v) => ({ vendorLabel: v, rows: map.get(v)! }));
}

export function InstallmentTimeline({
  summary,
  projectId,
  companyId,
  canManage,
}: {
  summary: ProjectInstallmentSummary;
  projectId: string;
  companyId: string;
  canManage: boolean;
}) {
  const { rows, plannedTotal, paidTrustedTotal, amberCount, brokenCount } = summary;
  const groups = groupByVendor(rows);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
        <h2 className="text-sm font-bold text-zinc-800">
          งวดงาน
          <span className="ml-1.5 text-xs font-medium tabular-nums text-zinc-400">
            {rows.length} งวด
          </span>
        </h2>
        {canManage && (
          <InstallmentFormDialog projectId={projectId} mode="create" />
        )}
      </div>

      {rows.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <p className="text-sm font-medium text-zinc-700">ยังไม่มีงวดงาน</p>
          <p className="mt-1 text-xs text-zinc-500">
            {canManage
              ? "กด “เพิ่มงวด” เพื่อวางแผนการจ่ายเป็นงวด ๆ ตามสัญญา"
              : "ยังไม่มีการวางแผนงวดสำหรับโครงการนี้"}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-zinc-100">
          {groups.map((g, gi) => (
            <div key={g.vendorLabel ?? `__none_${gi}`}>
              {/* แถบหัวกลุ่มผู้รับเหมา */}
              <div className="flex items-center justify-between gap-2 bg-zinc-50 px-4 py-2">
                <span className="truncate text-xs font-semibold text-zinc-600">
                  {g.vendorLabel || "ไม่ระบุผู้รับเหมา"}
                </span>
                {canManage && (
                  <InstallmentFormDialog
                    projectId={projectId}
                    mode="create"
                    defaultVendorLabel={g.vendorLabel}
                  />
                )}
              </div>

              {g.rows.map((r) => {
                const isPaidGreen = r.status === "paid";
                const isAmber = r.status === "paid_pending_slip";
                const isBroken = r.status === "broken";
                return (
                  <div
                    key={r.id}
                    className="px-4 py-3 transition-colors hover:bg-zinc-50/60"
                  >
                    {/* บรรทัดบน: seq/label + สถานะ */}
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-zinc-100 text-[11px] font-semibold tabular-nums text-zinc-600">
                          {r.seq}
                        </span>
                        <span className="truncate text-sm font-medium text-zinc-800">
                          {r.label}
                        </span>
                      </div>
                      <InstallmentStatusBadge status={r.status} />
                    </div>

                    {/* บรรทัดกลาง: กำหนดจ่าย + ยอด */}
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
                        {r.dueDate && (
                          <span className="inline-flex items-center gap-1">
                            <CalendarDays className="size-3.5 text-zinc-400" aria-hidden />
                            กำหนด {thaiDateLong(r.dueDate)}
                          </span>
                        )}
                        <span className="tabular-nums">
                          ยอดสัญญา{" "}
                          <span className="font-medium text-zinc-700">{baht(r.plannedAmount)}</span>
                        </span>
                        {isPaidGreen && r.actualCashOut != null && (
                          <span className="tabular-nums text-emerald-700">
                            โอนจริง{" "}
                            <span className="font-semibold">{baht(r.actualCashOut)}</span>
                          </span>
                        )}
                      </div>

                      {/* Actions (canManage) */}
                      {canManage && (
                        <div className="flex items-center gap-1.5">
                          {r.status === "planned" && (
                            <MarkPaidSheet
                              installmentId={r.id}
                              installmentLabel={r.label}
                              plannedAmount={r.plannedAmount}
                              companyId={companyId}
                              projectId={projectId}
                            />
                          )}
                          {isAmber && (
                            <MarkPaidSheet
                              installmentId={r.id}
                              installmentLabel={r.label}
                              plannedAmount={r.plannedAmount}
                              companyId={companyId}
                              projectId={projectId}
                            />
                          )}
                          <InstallmentFormDialog
                            projectId={projectId}
                            mode="edit"
                            initial={{
                              id: r.id,
                              seq: r.seq,
                              label: r.label,
                              vendorLabel: r.vendorLabel,
                              dueDate: r.dueDate,
                              plannedAmount: r.plannedAmount,
                            }}
                          />
                          <InstallmentRowActions installmentId={r.id} status={r.status} />
                        </div>
                      )}
                    </div>

                    {/* บิลจ่ายจริง (เขียว) — โชว์สลิป */}
                    {isPaidGreen && (r.slipThumbUrl || r.slipOriginalUrl) && (
                      <div className="mt-2 max-w-[200px]">
                        <ReceiptThumb
                          thumbUrl={r.slipThumbUrl}
                          originalUrl={r.slipOriginalUrl}
                          alt={`สลิป ${r.label}`}
                        />
                      </div>
                    )}

                    {/* เตือนสลิปหลุด */}
                    {isBroken && (
                      <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700">
                        <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
                        บิลที่ผูกไว้ถูกถอด/ยกเลิก — ตรวจสอบและผูกบิลใหม่
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Footer สรุป */}
      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-zinc-100 bg-zinc-50 px-4 py-3 sm:grid-cols-4">
          <div>
            <p className="text-[11px] text-zinc-500">ยอดสัญญารวม</p>
            <p className="text-sm font-semibold tabular-nums text-zinc-900">{baht(plannedTotal)}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-500">จ่ายจริง (นับได้)</p>
            <p className="text-sm font-semibold tabular-nums text-emerald-700">
              {baht(paidTrustedTotal)}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-500">จ่ายแล้ว—รอสลิป</p>
            <p
              className={`text-sm font-semibold tabular-nums ${amberCount > 0 ? "text-amber-700" : "text-zinc-400"}`}
            >
              {amberCount} งวด
            </p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-500">สลิปหลุด</p>
            <p
              className={`text-sm font-semibold tabular-nums ${brokenCount > 0 ? "text-rose-700" : "text-zinc-400"}`}
            >
              {brokenCount} งวด
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
