"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ReceiptText, Check, Search, AlertTriangle, Loader2, Eye } from "lucide-react";
import { formatBaht } from "@/lib/rentspace/format";
import {
  actGenerateBillsForUnits,
  actPreviewBillsForUnits,
  type BillPreviewRow,
} from "../../_actions";

export type BillRoom = {
  unitId: string;
  code: string;
  tenant: string | null;
  metersDone: boolean; // จดครบทั้งไฟ+น้ำแล้ว
  alreadyBilled: boolean; // ออกบิลงวดนี้แล้ว
};

/** ตัวเลขเงินในบรรทัดแยกย่อย — โชว์สตางค์ 2 ตำแหน่งให้ตรงกับยอดบิลจริง */
const dec2 = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * #9d — ออกบิลแบบ "เลือกห้อง" (ไม่ต้องทั้งโครงการ).
 * #2a — ช่องค้นหาห้อง · #2b — พรีวิวยอดบิลฝั่งขวาก่อนกดยืนยัน.
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
  const [q, setQ] = useState("");

  const billable = useMemo(() => rooms.filter((r) => !r.alreadyBilled), [rooms]);
  const billedCount = rooms.length - billable.length;

  // #2a ค้นหา: กรองด้วยรหัสห้อง หรือ ชื่อผู้เช่า
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return billable;
    return billable.filter(
      (r) =>
        r.code.toLowerCase().includes(term) ||
        (r.tenant ?? "").toLowerCase().includes(term),
    );
  }, [billable, q]);

  // #2b พรีวิวยอดบิลของห้องที่เลือก (โหลดอัตโนมัติเมื่อเลือกเปลี่ยน)
  const [preview, setPreview] = useState<{ rows: BillPreviewRow[]; sum: number } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const selKey = useMemo(() => [...sel].sort().join(","), [sel]);
  const reqRef = useRef(0);

  useEffect(() => {
    if (sel.size === 0) {
      setPreview(null);
      setPreviewLoading(false);
      return;
    }
    const ids = selKey.split(",").filter(Boolean);
    const reqId = ++reqRef.current;
    setPreviewLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await actPreviewBillsForUnits(projectId, period, ids);
        if (reqRef.current === reqId) setPreview(res);
      } catch {
        if (reqRef.current === reqId) setPreview(null);
      } finally {
        if (reqRef.current === reqId) setPreviewLoading(false);
      }
    }, 350); // debounce — กันยิงรัวตอนติ๊กหลายห้องเร็ว ๆ
    return () => clearTimeout(timer);
  }, [selKey, projectId, period, sel.size]);

  function toggle(id: string) {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAllReady() {
    // เลือกเฉพาะห้องที่จดครบ "ในผลค้นหาปัจจุบัน"
    setSel(new Set(filtered.filter((r) => r.metersDone).map((r) => r.unitId)));
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
    if (
      hasMissing &&
      !confirm(
        "บางห้องที่เลือกยังไม่ได้จดมิเตอร์ครบ — บิลจะมีแต่ค่าเช่า (เพิ่มค่าน้ำ-ไฟภายหลังได้). ดำเนินการต่อ?",
      )
    ) {
      return;
    }
    start(async () => {
      try {
        const res = await actGenerateBillsForUnits(projectId, period, [...sel]);
        toast.success(
          `ออกบิลแล้ว ${res.created} ใบ${res.skipped ? ` · ข้าม ${res.skipped} (มีบิลแล้ว)` : ""}`,
        );
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
          <button type="button" className="rs-btn rs-btn-ghost !h-11 sm:!h-8 !px-3 sm:!px-2.5" onClick={selectAllReady}>
            เลือกห้องที่จดครบ
          </button>
          {sel.size > 0 && (
            <button type="button" className="rs-btn rs-btn-ghost !h-11 sm:!h-8 !px-3 sm:!px-2.5" onClick={clearSel}>
              ล้าง
            </button>
          )}
        </div>
      </div>

      <p className="mt-1 text-[12px]" style={{ color: "var(--rs-text-3)" }}>
        เลือกห้องทางซ้าย → ดูยอดบิลทางขวาก่อนกดยืนยัน
        {billedCount > 0 ? ` · ออกบิลแล้ว ${billedCount} ห้อง` : ""}
      </p>

      {billable.length === 0 ? (
        <p className="mt-3 text-[13px]" style={{ color: "var(--rs-ok)" }}>
          ✓ ทุกห้องที่มีสัญญาออกบิลงวดนี้ครบแล้ว
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ───── ฝั่งซ้าย: ค้นหา + เลือกห้อง ───── */}
          <div>
            {/* #2a ช่องค้นหา */}
            <div className="relative">
              <Search
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4"
                style={{ color: "var(--rs-text-3)" }}
                aria-hidden="true"
              />
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ค้นหาห้อง / ชื่อผู้เช่า…"
                aria-label="ค้นหาห้องที่จะออกบิล"
                className="w-full h-11 sm:h-9 rounded-xl pl-9 pr-3 text-base sm:text-sm outline-none focus:ring-2"
                style={{
                  background: "var(--rs-bg-2)",
                  border: "1px solid var(--rs-border)",
                  color: "var(--rs-text)",
                  // @ts-expect-error css var for ring
                  "--tw-ring-color": "var(--rs-brand)",
                }}
              />
            </div>

            {filtered.length === 0 ? (
              <p className="mt-3 text-[13px]" style={{ color: "var(--rs-text-3)" }}>
                ไม่พบห้องที่ตรงกับ “{q}”
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-2 max-h-[420px] overflow-auto pr-1">
                {filtered.map((r) => {
                  const checked = sel.has(r.unitId);
                  return (
                    <button
                      key={r.unitId}
                      type="button"
                      onClick={() => toggle(r.unitId)}
                      aria-pressed={checked}
                      className="relative text-left rounded-xl p-3 sm:p-2.5 min-h-[44px] transition-all"
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
            )}
          </div>

          {/* ───── ฝั่งขวา: พรีวิวยอดบิล (#2b) ───── */}
          <div
            className="rounded-xl p-3 flex flex-col"
            style={{ background: "var(--rs-bg-2)", border: "1px solid var(--rs-border)" }}
          >
            <div className="flex items-center gap-1.5">
              <Eye className="h-4 w-4" style={{ color: "var(--rs-brand)" }} aria-hidden="true" />
              <h3 className="font-semibold text-[13.5px]" style={{ color: "var(--rs-text)" }}>
                พรีวิวยอดบิลก่อนออก
              </h3>
              {previewLoading && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "var(--rs-text-3)" }} aria-hidden="true" />
              )}
            </div>

            {sel.size === 0 ? (
              <p className="mt-6 mb-6 text-center text-[12.5px]" style={{ color: "var(--rs-text-3)" }}>
                เลือกห้องทางซ้ายเพื่อดูยอดบิลที่จะออก
              </p>
            ) : (
              <>
                <div className="mt-2 space-y-1.5 max-h-[360px] overflow-auto pr-1">
                  {(preview?.rows ?? []).map((row) => (
                    <div
                      key={row.unitId}
                      className="rounded-lg px-2.5 py-2"
                      style={{ background: "#fff", border: "1px solid var(--rs-border)" }}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="font-semibold text-[13px] truncate" style={{ color: "var(--rs-text)" }}>
                          {row.code}
                          {row.tenant ? (
                            <span className="font-normal text-[11.5px]" style={{ color: "var(--rs-text-3)" }}>
                              {" · "}
                              {row.tenant}
                            </span>
                          ) : null}
                        </div>
                        <div className="font-bold tabular-nums text-[13px] shrink-0" style={{ color: "var(--rs-text)" }}>
                          {formatBaht(row.total)}
                        </div>
                      </div>
                      <div className="text-[11px] mt-0.5" style={{ color: "var(--rs-text-3)" }}>
                        ค่าเช่า {dec2(row.rent)}
                        {row.electric > 0 ? ` · ไฟ ${dec2(row.electric)}` : ""}
                        {row.water > 0 ? ` · น้ำ ${dec2(row.water)}` : ""}
                        {row.lateFee > 0 ? ` · ค่าปรับ ${dec2(row.lateFee)}` : ""}
                        {row.discount > 0 ? ` · ส่วนลด -${dec2(row.discount)}` : ""}
                        {row.vat > 0 ? ` · VAT ${dec2(row.vat)}` : ""}
                      </div>
                      {row.missingMeter && (
                        <div
                          className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-medium"
                          style={{ color: "#B45309" }}
                        >
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                          ยังไม่ได้จดมิเตอร์ครบ — บิลนี้ยังไม่รวมค่าน้ำ/ไฟ
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div
                  className="mt-2 pt-2 flex items-center justify-between"
                  style={{ borderTop: "1px solid var(--rs-border)" }}
                >
                  <span className="text-[12.5px]" style={{ color: "var(--rs-text-2)" }}>
                    รวม {sel.size} ห้อง
                  </span>
                  <span className="font-bold tabular-nums" style={{ color: "var(--rs-brand)" }}>
                    {formatBaht(preview?.sum ?? 0)}
                  </span>
                </div>

                <button
                  className="rs-btn w-full justify-center mt-3"
                  onClick={generate}
                  disabled={pending || sel.size === 0}
                  style={sel.size === 0 ? { opacity: 0.5 } : undefined}
                >
                  <ReceiptText className="h-4 w-4" />
                  {pending ? "กำลังออกบิล…" : `ยืนยันออกบิล ${sel.size} ห้อง`}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
