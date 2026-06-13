"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, FileDown, X } from "lucide-react";
import { actGenerateMonthlyBills, actCreateBill } from "../../_actions";

type ContractOpt = { id: string; contractNo: string; unitCode: string; tenantName: string };

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
  const [bulkPending, startBulk] = useTransition();
  const [pending, start] = useTransition();

  const [contractId, setContractId] = useState(contracts[0]?.id ?? "");
  const [singlePeriod, setSinglePeriod] = useState(period);

  function generateAll() {
    if (
      !confirm(
        `ออกบิลเดือนนี้ให้สัญญาที่ใช้งานอยู่ทั้งหมด (${contracts.length} สัญญา)?\nบิลที่มีอยู่แล้วของงวดนี้จะไม่ถูกออกซ้ำ`,
      )
    )
      return;
    startBulk(async () => {
      try {
        const r = await actGenerateMonthlyBills(projectId, period);
        toast.success(`ออกบิลใหม่ ${r.created} ใบ · ข้าม ${r.skipped} ใบ (จาก ${r.total} สัญญา)`);
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
    <div className="flex items-center gap-2 print:hidden">
      <button className="rs-btn rs-btn-ghost" onClick={generateAll} disabled={bulkPending || contracts.length === 0}>
        <FileDown className="h-4 w-4" /> {bulkPending ? "กำลังออกบิล…" : "ออกบิลทั้งโครงการ (เดือนนี้)"}
      </button>
      <button className="rs-btn" onClick={() => setOpen(true)} disabled={contracts.length === 0}>
        <Plus className="h-4 w-4" /> ออกบิล
      </button>

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
                <select className="rs-d-input" value={contractId} onChange={(e) => setContractId(e.target.value)}>
                  {contracts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.unitCode} · {c.tenantName} ({c.contractNo})
                    </option>
                  ))}
                </select>
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
