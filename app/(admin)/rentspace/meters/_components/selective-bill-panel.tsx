"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ReceiptText, Check } from "lucide-react";
import { actGenerateBillsForUnits } from "../../_actions";

export type BillRoom = {
  unitId: string;
  code: string;
  tenant: string | null;
  metersDone: boolean; // จดครบทั้งไฟ+น้ำแล้ว
  alreadyBilled: boolean; // ออกบิลงวดนี้แล้ว
};

/**
 * #9d — ออกบิลแบบ "เลือกห้อง" (ไม่ต้องทั้งโครงการ).
 * โชว์เฉพาะห้องที่มีสัญญาใช้งาน · ห้องที่ออกบิลแล้วถูกล็อก · เตือนห้องยังไม่จดมิเตอร์.
 */
export default function SelectiveBillPanel({
  projectId,
  period,
  rooms,
}: {
  projectId: string;
  period: string;
  rooms: BillRoom[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<Set<string>>(new Set());

  const billable = useMemo(() => rooms.filter((r) => !r.alreadyBilled), [rooms]);
  const billedCount = rooms.length - billable.length;

  function toggle(id: string) {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAllReady() {
    setSel(new Set(billable.filter((r) => r.metersDone).map((r) => r.unitId)));
  }
  function clearSel() {
    setSel(new Set());
  }

  function generate() {
    if (sel.size === 0) {
      toast.error("ยังไม่ได้เลือกห้อง");
      return;
    }
    const hasMissing = billable.some((r) => sel.has(r.unitId) && !r.metersDone);
    if (hasMissing && !confirm("บางห้องที่เลือกยังไม่ได้จดมิเตอร์ครบ — บิลจะมีแต่ค่าเช่า (เพิ่มค่าน้ำ-ไฟภายหลังได้). ดำเนินการต่อ?")) {
      return;
    }
    start(async () => {
      try {
        const res = await actGenerateBillsForUnits(projectId, period, [...sel]);
        toast.success(`ออกบิลแล้ว ${res.created} ใบ${res.skipped ? ` · ข้าม ${res.skipped} (มีบิลแล้ว)` : ""}`);
        setSel(new Set());
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ออกบิลไม่สำเร็จ");
      }
    });
  }

  if (rooms.length === 0) return null;

  return (
    <div className="rs-card p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ReceiptText className="h-4 w-4" style={{ color: "var(--rs-brand)" }} />
          <h2 className="font-bold" style={{ color: "var(--rs-text)" }}>
            ออกบิลรายห้อง (เลือกได้)
          </h2>
        </div>
        <div className="flex items-center gap-2 text-[12.5px]">
          <button type="button" className="rs-btn rs-btn-ghost !h-8 !px-2.5" onClick={selectAllReady}>
            เลือกห้องที่จดครบ
          </button>
          {sel.size > 0 && (
            <button type="button" className="rs-btn rs-btn-ghost !h-8 !px-2.5" onClick={clearSel}>
              ล้าง
            </button>
          )}
        </div>
      </div>

      <p className="mt-1 text-[12px]" style={{ color: "var(--rs-text-3)" }}>
        เลือกเฉพาะห้องที่ต้องการออกบิลงวดนี้ — ไม่ต้องทั้งโครงการ
        {billedCount > 0 ? ` · ออกบิลแล้ว ${billedCount} ห้อง` : ""}
      </p>

      {billable.length === 0 ? (
        <p className="mt-3 text-[13px]" style={{ color: "var(--rs-ok)" }}>
          ✓ ทุกห้องที่มีสัญญาออกบิลงวดนี้ครบแล้ว
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {billable.map((r) => {
              const checked = sel.has(r.unitId);
              return (
                <button
                  key={r.unitId}
                  type="button"
                  onClick={() => toggle(r.unitId)}
                  className="relative text-left rounded-xl p-2.5 transition-all"
                  style={{
                    border: `1.5px solid ${checked ? "var(--rs-brand)" : "var(--rs-border)"}`,
                    background: checked ? "var(--rs-brand-50)" : "#fff",
                  }}
                >
                  {checked && (
                    <span
                      className="absolute top-1.5 right-1.5 flex items-center justify-center rounded-full"
                      style={{ width: 16, height: 16, background: "var(--rs-brand)" }}
                    >
                      <Check className="h-2.5 w-2.5 text-white" />
                    </span>
                  )}
                  <div className="font-bold text-[14px]" style={{ color: "var(--rs-text)" }}>
                    {r.code}
                  </div>
                  {r.tenant && (
                    <div className="text-[11.5px] truncate" style={{ color: "var(--rs-text-2)" }}>
                      {r.tenant}
                    </div>
                  )}
                  <div
                    className="mt-1 inline-block text-[10.5px] font-semibold px-1.5 py-0.5 rounded"
                    style={
                      r.metersDone
                        ? { background: "var(--rs-ok-soft)", color: "var(--rs-ok)" }
                        : { background: "var(--rs-pending-soft)", color: "var(--rs-pending)" }
                    }
                  >
                    {r.metersDone ? "จดมิเตอร์ครบ" : "ยังไม่ครบ"}
                  </div>
                </button>
              );
            })}
          </div>

          <button
            className="rs-btn w-full justify-center mt-3"
            onClick={generate}
            disabled={pending || sel.size === 0}
            style={sel.size === 0 ? { opacity: 0.5 } : undefined}
          >
            <ReceiptText className="h-4 w-4" />
            {pending ? "กำลังออกบิล…" : `ออกบิล ${sel.size} ห้องที่เลือก`}
          </button>
        </>
      )}
    </div>
  );
}
