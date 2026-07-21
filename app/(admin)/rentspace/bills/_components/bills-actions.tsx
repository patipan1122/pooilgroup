"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, FileDown, X, AlertTriangle, Search } from "lucide-react";
import { actGenerateMonthlyBills, actCreateBill, actBillingPreview } from "../../_actions";
import { currentPeriod, periodLabel, formatBaht } from "@/lib/rentspace/format";

type ContractOpt = {
  id: string;
  contractNo: string;
  unitCode: string;
  tenantName: string;
  alreadyBilled?: boolean; // มีบิลของงวดนี้อยู่แล้ว → ทำป้ายเตือนในตัวเลือก
};

type PreviewRow = {
  code: string;
  tenant: string;
  rent: number;
  utility: number;
  total: number;
  hasMeter: boolean;
  alreadyBilled: boolean;
};
type Preview = { rows: PreviewRow[]; toBillCount: number; missingMeterCount: number; sum: number };

export function BillsActions({
  projectId,
  period,
  contracts,
}: {
  projectId: string;
  period: string;
  contracts: ContractOpt[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  // ── bulk preview modal state ──
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, startPreview] = useTransition();
  const [bulkPending, startBulk] = useTransition();
  const [preview, setPreview] = useState<Preview | null>(null);

  const [contractId, setContractId] = useState(contracts[0]?.id ?? "");
  const [singlePeriod, setSinglePeriod] = useState(period);
  const [contractQuery, setContractQuery] = useState("");

  // ค้นหาสัญญา/ห้อง/ผู้เช่า ในกล่องออกบิลรายห้อง — กรองตัวเลือกฝั่ง client
  const filteredContracts = useMemo(() => {
    const needle = contractQuery.trim().toLowerCase();
    if (!needle) return contracts;
    return contracts.filter((c) =>
      [c.unitCode, c.tenantName, c.contractNo].filter(Boolean).join(" ").toLowerCase().includes(needle),
    );
  }, [contracts, contractQuery]);

  const billPeriod = currentPeriod();

  /** Open the preview modal and load the table of rooms-to-be-billed. */
  function openPreview() {
    setPreview(null);
    setPreviewOpen(true);
    startPreview(async () => {
      try {
        const r = await actBillingPreview(projectId, billPeriod);
        setPreview(r);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ดึงตัวอย่างบิลไม่สำเร็จ");
        setPreviewOpen(false);
      }
    });
  }

  /** Actually run the monthly bill generation, then refresh + close. */
  function confirmGenerateAll() {
    startBulk(async () => {
      try {
        const r = await actGenerateMonthlyBills(projectId, billPeriod);
        toast.success(`ออกบิลใหม่ ${r.created} ใบ · ข้าม ${r.skipped} ใบ (จาก ${r.total} สัญญา)`);
        setPreviewOpen(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ออกบิลไม่สำเร็จ");
      }
    });
  }

  function createOne() {
    if (!contractId) return toast.error("กรุณาเลือกสัญญา");
    if (!/^\d{4}-\d{2}$/.test(singlePeriod)) return toast.error("งวดต้องอยู่ในรูปแบบ ปปปป-ดด");
    start(async () => {
      try {
        const r = await actCreateBill(contractId, singlePeriod, true);
        toast.success(r.created ? "ออกบิลแล้ว" : "มีบิลของงวดนี้อยู่แล้ว");
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ออกบิลไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden w-full sm:w-auto">
      <button
        className="rs-btn rs-btn-ghost min-h-[44px] sm:min-h-0 flex-1 sm:flex-none"
        onClick={openPreview}
        disabled={bulkPending || previewLoading || contracts.length === 0}
      >
        <FileDown className="h-4 w-4 shrink-0" /> <span className="truncate">{bulkPending ? "กำลังออกบิล…" : "ออกบิลทั้งโครงการ (เดือนนี้)"}</span>
      </button>
      <button className="rs-btn min-h-[44px] sm:min-h-0 flex-1 sm:flex-none" onClick={() => setOpen(true)} disabled={contracts.length === 0}>
        <Plus className="h-4 w-4 shrink-0" /> ออกบิล
      </button>

      {/* ───────── PREVIEW modal — ดูก่อนออกบิลทั้งโครงการ ───────── */}
      {previewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
          onClick={() => !bulkPending && setPreviewOpen(false)}
        >
          <div
            className="rs-card w-full sm:max-w-2xl rounded-b-none sm:rounded-2xl flex flex-col max-h-[92vh] sm:max-h-[88vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* header */}
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--rs-border)" }}>
              <div className="font-bold text-lg" style={{ color: "var(--rs-text)" }}>
                ออกบิลทั้งโครงการ · งวด {periodLabel(billPeriod)}
              </div>
              <button
                onClick={() => setPreviewOpen(false)}
                disabled={bulkPending}
                className="p-1 rounded-lg hover:bg-black/5"
              >
                <X className="h-5 w-5" style={{ color: "var(--rs-text-2)" }} />
              </button>
            </div>

            {/* body */}
            <div className="px-5 py-4 overflow-y-auto flex-1">
              {previewLoading || !preview ? (
                <div className="py-10 text-center text-sm" style={{ color: "var(--rs-text-2)" }}>
                  กำลังเตรียมตัวอย่างบิล…
                </div>
              ) : (
                <>
                  {/* amber meter warning */}
                  {preview.missingMeterCount > 0 && (
                    <div
                      className="flex items-start gap-2 rounded-xl px-3.5 py-3 mb-3 text-[13px] leading-relaxed"
                      style={{ background: "var(--rs-pending-soft)", color: "#92400E" }}
                    >
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "#D97706" }} />
                      <span>
                        ⚠️ {preview.missingMeterCount} ห้องยังไม่จดมิเตอร์ — บิลจะมีแต่ค่าเช่า ค่าน้ำ-ไฟเพิ่มภายหลัง
                      </span>
                    </div>
                  )}

                  {/* rooms table */}
                  <div className="-mx-1 overflow-x-auto">
                    <table className="w-full text-[13px]" style={{ minWidth: 520 }}>
                      <thead>
                        <tr style={{ color: "var(--rs-text-2)" }} className="text-left">
                          <th className="px-2 py-2 font-semibold">รหัส</th>
                          <th className="px-2 py-2 font-semibold">ผู้เช่า</th>
                          <th className="px-2 py-2 font-semibold text-right">ค่าเช่า</th>
                          <th className="px-2 py-2 font-semibold text-right">ค่าน้ำ-ไฟ</th>
                          <th className="px-2 py-2 font-semibold text-right">รวม</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-2 py-6 text-center" style={{ color: "var(--rs-text-3)" }}>
                              ไม่มีสัญญาที่ใช้งานอยู่ในโครงการนี้
                            </td>
                          </tr>
                        )}
                        {preview.rows.map((r, i) => (
                          <tr
                            key={`${r.code}-${i}`}
                            className="border-t"
                            style={{
                              borderColor: "var(--rs-border)",
                              opacity: r.alreadyBilled ? 0.5 : 1,
                            }}
                          >
                            <td className="px-2 py-2 font-medium" style={{ color: "var(--rs-text)" }}>
                              <div className="flex items-center gap-1.5">
                                <span>{r.code}</span>
                                {!r.alreadyBilled && !r.hasMeter && (
                                  <span
                                    className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold whitespace-nowrap"
                                    style={{ background: "var(--rs-pending-soft)", color: "#92400E" }}
                                  >
                                    ไม่มีมิเตอร์
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-2" style={{ color: "var(--rs-text-2)" }}>
                              {r.tenant}
                            </td>
                            {r.alreadyBilled ? (
                              <td colSpan={3} className="px-2 py-2 text-right" style={{ color: "var(--rs-text-3)" }}>
                                ออกแล้ว
                              </td>
                            ) : (
                              <>
                                <td className="px-2 py-2 text-right tabular-nums" style={{ color: "var(--rs-text)" }}>
                                  {formatBaht(r.rent)}
                                </td>
                                <td
                                  className="px-2 py-2 text-right tabular-nums"
                                  style={{ color: r.hasMeter ? "var(--rs-text)" : "var(--rs-text-3)" }}
                                >
                                  {r.hasMeter ? formatBaht(r.utility) : "—"}
                                </td>
                                <td className="px-2 py-2 text-right tabular-nums font-semibold" style={{ color: "var(--rs-text)" }}>
                                  {formatBaht(r.total)}
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            {/* footer: total + actions */}
            <div
              className="flex flex-col gap-3 px-5 py-3 border-t sm:flex-row sm:items-center sm:justify-between"
              style={{ borderColor: "var(--rs-border)" }}
            >
              <div className="text-sm" style={{ color: "var(--rs-text-2)" }}>
                รวมที่จะออกบิล:{" "}
                <span className="font-bold tabular-nums" style={{ color: "var(--rs-text)" }}>
                  {formatBaht(preview?.sum ?? 0)}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  className="rs-btn rs-btn-ghost flex-1 sm:flex-none"
                  disabled={bulkPending}
                  onClick={() => setPreviewOpen(false)}
                >
                  ยกเลิก
                </button>
                <button
                  className="rs-btn flex-1 sm:flex-none"
                  disabled={bulkPending || previewLoading || !preview || preview.toBillCount === 0}
                  onClick={confirmGenerateAll}
                  style={{ background: "#2563EB" }}
                >
                  {bulkPending ? "กำลังออกบิล…" : `ยืนยันออกบิล ${preview?.toBillCount ?? 0} ห้อง`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ───────── single-contract bill modal (unchanged) ───────── */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div className="rs-card w-full sm:max-w-md rounded-b-none sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--rs-border)" }}>
              <div className="font-bold text-lg" style={{ color: "var(--rs-text)" }}>
                ออกบิลรายห้อง
              </div>
              <button onClick={() => setOpen(false)} disabled={pending} className="p-1 rounded-lg hover:bg-black/5">
                <X className="h-5 w-5" style={{ color: "var(--rs-text-2)" }} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
                  สัญญา / ห้อง
                </label>
                {/* ค้นหาสัญญา — พิมพ์ห้อง/ผู้เช่า/เลขที่สัญญาเพื่อกรองรายการด้านล่าง */}
                <div className="relative mb-1.5">
                  <Search
                    className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: "var(--rs-text-3)" }}
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={contractQuery}
                    onChange={(e) => setContractQuery(e.target.value)}
                    placeholder="ค้นหาห้อง / ผู้เช่า / เลขที่สัญญา"
                    aria-label="ค้นหาสัญญา ห้อง หรือผู้เช่า"
                    className="rs-d-input"
                    style={{ paddingLeft: 34 }}
                  />
                </div>
                <select className="rs-d-input" value={contractId} onChange={(e) => setContractId(e.target.value)}>
                  {filteredContracts.length === 0 ? (
                    <option value="" disabled>
                      ไม่พบสัญญาที่ตรงกับ “{contractQuery.trim()}”
                    </option>
                  ) : (
                    filteredContracts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.unitCode} · {c.tenantName} ({c.contractNo}){c.alreadyBilled ? " — ออกบิลแล้ว" : ""}
                      </option>
                    ))
                  )}
                </select>
                {(() => {
                  const sel = contracts.find((c) => c.id === contractId);
                  return sel?.alreadyBilled ? (
                    <div className="text-[12px] mt-1" style={{ color: "var(--rs-pending)" }}>
                      ⚠️ ห้องนี้ออกบิลของงวดนี้แล้ว — ออกซ้ำจะขึ้นว่ามีอยู่แล้ว
                    </div>
                  ) : null;
                })()}
              </div>
              <div>
                <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
                  งวด (เดือน)
                </label>
                <input type="month" className="rs-d-input" value={singlePeriod} onChange={(e) => setSinglePeriod(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2 px-5 py-3 border-t" style={{ borderColor: "var(--rs-border)" }}>
              <button className="rs-btn rs-btn-ghost flex-1" disabled={pending} onClick={() => setOpen(false)}>
                ยกเลิก
              </button>
              <button className="rs-btn flex-1" disabled={pending} onClick={createOne}>
                {pending ? "กำลังออกบิล…" : "ออกบิล"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        :global(.rs-d-input) {
          width: 100%;
          height: 42px;
          padding: 0 12px;
          border-radius: 10px;
          border: 1px solid var(--rs-border);
          background: var(--rs-bg-2);
          color: var(--rs-text);
          font-size: 14px;
        }
        :global(.rs-d-input:focus) {
          outline: none;
          border-color: var(--rs-brand);
          background: #fff;
        }
      `}</style>
    </div>
  );
}
