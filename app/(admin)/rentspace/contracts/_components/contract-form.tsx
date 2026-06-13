"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X, FileText } from "lucide-react";
import { actSaveContract } from "../../_actions";

type Unit = { id: string; code: string; name?: string | null; baseRentThb?: unknown; building?: string | null };
type Tenant = {
  id: string;
  bizName?: string | null;
  prefix?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  nickname?: string | null;
};
type Template = { id: string; name: string; isDefault: boolean };

function tenantLabel(t: Tenant): string {
  const person = [t.prefix, t.firstName, t.lastName].filter(Boolean).join(" ").trim();
  if (t.bizName && person) return `${t.bizName} (${person})`;
  return t.bizName || person || t.nickname || "ไม่ระบุชื่อ";
}

const LATE_FEE_LABELS: Record<string, string> = {
  none: "ไม่คิดค่าปรับ",
  fixed: "คงที่ (บาท)",
  percent_total: "% ของยอดบิล",
  per_day: "ต่อวัน (บาท/วัน)",
};

function num(v: string): number {
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function ContractForm({
  projectId,
  units,
  tenants,
  templates,
  trigger,
}: {
  projectId: string;
  units: Unit[];
  tenants: Tenant[];
  templates: Template[];
  /** optional custom open button; defaults to a primary "ทำสัญญาใหม่" */
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const today = new Date().toISOString().slice(0, 10);
  const defaultTemplate = templates.find((t) => t.isDefault)?.id ?? "";

  // form state
  const [unitId, setUnitId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [templateId, setTemplateId] = useState(defaultTemplate);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");
  const [rentAmount, setRentAmount] = useState("");
  const [rentDueDay, setRentDueDay] = useState("5");
  const [depositAmount, setDepositAmount] = useState("");
  const [depositMonths, setDepositMonths] = useState("");
  const [vatPercent, setVatPercent] = useState("0");
  const [lateFeeType, setLateFeeType] = useState<"none" | "fixed" | "percent_total" | "per_day">("none");
  const [lateFeeValue, setLateFeeValue] = useState("");
  const [lateFeeGraceDays, setLateFeeGraceDays] = useState("7");
  const [schedule, setSchedule] = useState<{ fromPeriod: string; amount: string }[]>([]);
  const [note, setNote] = useState("");

  function reset() {
    setUnitId("");
    setTenantId("");
    setTemplateId(defaultTemplate);
    setStartDate(today);
    setEndDate("");
    setRentAmount("");
    setRentDueDay("5");
    setDepositAmount("");
    setDepositMonths("");
    setVatPercent("0");
    setLateFeeType("none");
    setLateFeeValue("");
    setLateFeeGraceDays("7");
    setSchedule([]);
    setNote("");
  }

  // when a unit is picked, prefill rent from its base rent
  function onPickUnit(id: string) {
    setUnitId(id);
    const u = units.find((x) => x.id === id);
    const base = u?.baseRentThb != null ? Number(u.baseRentThb) : 0;
    if (base > 0 && !rentAmount) setRentAmount(String(base));
  }

  function submit(activate: boolean) {
    if (!unitId) return toast.error("กรุณาเลือกห้อง/ยูนิต");
    if (!tenantId) return toast.error("กรุณาเลือกผู้เช่า");
    if (num(rentAmount) <= 0) return toast.error("กรุณากรอกค่าเช่า");
    if (!startDate) return toast.error("กรุณาเลือกวันเริ่มสัญญา");

    const rentSchedule = schedule
      .filter((s) => s.fromPeriod && num(s.amount) > 0)
      .map((s) => ({ fromPeriod: s.fromPeriod, amount: num(s.amount) }));

    start(async () => {
      try {
        await actSaveContract({
          projectId,
          unitId,
          tenantId,
          templateId: templateId || undefined,
          startDate,
          endDate: endDate || undefined,
          rentAmountThb: num(rentAmount),
          rentDueDay: Number(rentDueDay) || 5,
          depositAmountThb: num(depositAmount),
          depositMonths: num(depositMonths),
          vatPercent: num(vatPercent),
          lateFeeType,
          lateFeeValue: num(lateFeeValue),
          lateFeeGraceDays: Number(lateFeeGraceDays) || 7,
          rentSchedule: rentSchedule.length ? rentSchedule : undefined,
          note: note || undefined,
          activate,
        });
        toast.success(activate ? "เริ่มสัญญาเรียบร้อย" : "บันทึกร่างสัญญาแล้ว");
        setOpen(false);
        reset();
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  return (
    <>
      <span onClick={() => setOpen(true)}>
        {trigger ?? (
          <button className="rs-btn">
            <Plus className="h-4 w-4" /> ทำสัญญาใหม่
          </button>
        )}
      </span>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="rs-card w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-b-none sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b"
              style={{ background: "#fff", borderColor: "var(--rs-border)" }}
            >
              <div className="flex items-center gap-2 font-bold text-lg" style={{ color: "var(--rs-text)" }}>
                <FileText className="h-5 w-5" style={{ color: "var(--rs-brand)" }} /> ทำสัญญาใหม่
              </div>
              <button onClick={() => setOpen(false)} disabled={pending} className="p-1 rounded-lg hover:bg-black/5">
                <X className="h-5 w-5" style={{ color: "var(--rs-text-2)" }} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="ห้อง / ยูนิต *">
                  <select className="rs-input" value={unitId} onChange={(e) => onPickUnit(e.target.value)}>
                    <option value="">— เลือกห้อง —</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.code}
                        {u.name ? ` · ${u.name}` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="ผู้เช่า *">
                  <select className="rs-input" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
                    <option value="">— เลือกผู้เช่า —</option>
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        {tenantLabel(t)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="แม่แบบสัญญา (ไม่บังคับ)">
                <select className="rs-input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  <option value="">— ไม่ใช้แม่แบบ —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.isDefault ? " (ค่าเริ่มต้น)" : ""}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="วันเริ่มสัญญา *">
                  <input type="date" className="rs-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </Field>
                <Field label="วันสิ้นสุด (ไม่บังคับ)">
                  <input type="date" className="rs-input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </Field>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="ค่าเช่า/เดือน (บาท) *">
                  <input inputMode="decimal" className="rs-input" value={rentAmount} onChange={(e) => setRentAmount(e.target.value)} placeholder="0.00" />
                </Field>
                <Field label="ครบกำหนดชำระ (วันที่)">
                  <input
                    type="number"
                    min={1}
                    max={28}
                    className="rs-input"
                    value={rentDueDay}
                    onChange={(e) => setRentDueDay(e.target.value)}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="เงินประกัน (บาท)">
                  <input inputMode="decimal" className="rs-input" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} placeholder="0.00" />
                </Field>
                <Field label="ประกัน (กี่เดือน)">
                  <input inputMode="decimal" className="rs-input" value={depositMonths} onChange={(e) => setDepositMonths(e.target.value)} placeholder="0" />
                </Field>
                <Field label="VAT (%)">
                  <input inputMode="decimal" className="rs-input" value={vatPercent} onChange={(e) => setVatPercent(e.target.value)} placeholder="0" />
                </Field>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="ค่าปรับล่าช้า">
                  <select
                    className="rs-input"
                    value={lateFeeType}
                    onChange={(e) => setLateFeeType(e.target.value as typeof lateFeeType)}
                  >
                    {Object.entries(LATE_FEE_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="ค่าปรับ (มูลค่า)">
                  <input
                    inputMode="decimal"
                    className="rs-input"
                    value={lateFeeValue}
                    onChange={(e) => setLateFeeValue(e.target.value)}
                    disabled={lateFeeType === "none"}
                    placeholder="0"
                  />
                </Field>
                <Field label="ผ่อนผัน (กี่วัน)">
                  <input
                    type="number"
                    min={0}
                    className="rs-input"
                    value={lateFeeGraceDays}
                    onChange={(e) => setLateFeeGraceDays(e.target.value)}
                    disabled={lateFeeType === "none"}
                  />
                </Field>
              </div>

              {/* rent escalation schedule */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[13px] font-semibold" style={{ color: "var(--rs-text)" }}>
                    ปรับค่าเช่าตามงวด (ไม่บังคับ)
                  </label>
                  <button
                    type="button"
                    onClick={() => setSchedule((s) => [...s, { fromPeriod: "", amount: "" }])}
                    className="inline-flex items-center gap-1 text-[12.5px] font-medium"
                    style={{ color: "var(--rs-brand)" }}
                  >
                    <Plus className="h-3.5 w-3.5" /> เพิ่มงวด
                  </button>
                </div>
                {schedule.length === 0 && (
                  <p className="text-[12px]" style={{ color: "var(--rs-text-3)" }}>
                    เช่น ปีที่ 2 ขึ้นค่าเช่า — ระบุงวดเริ่ม (เดือน) และค่าเช่าใหม่
                  </p>
                )}
                <div className="space-y-2">
                  {schedule.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="month"
                        className="rs-input flex-1"
                        value={row.fromPeriod}
                        onChange={(e) =>
                          setSchedule((s) => s.map((r, j) => (j === i ? { ...r, fromPeriod: e.target.value } : r)))
                        }
                      />
                      <input
                        inputMode="decimal"
                        className="rs-input flex-1"
                        placeholder="ค่าเช่าใหม่"
                        value={row.amount}
                        onChange={(e) =>
                          setSchedule((s) => s.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))
                        }
                      />
                      <button
                        type="button"
                        onClick={() => setSchedule((s) => s.filter((_, j) => j !== i))}
                        className="p-2 rounded-lg hover:bg-black/5"
                      >
                        <X className="h-4 w-4" style={{ color: "var(--rs-danger)" }} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <Field label="หมายเหตุ">
                <textarea className="rs-input min-h-[64px]" value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>

            <div
              className="sticky bottom-0 flex gap-2 px-5 py-3 border-t"
              style={{ background: "#fff", borderColor: "var(--rs-border)" }}
            >
              <button className="rs-btn rs-btn-ghost flex-1" disabled={pending} onClick={() => submit(false)}>
                บันทึกร่าง
              </button>
              <button className="rs-btn flex-1" disabled={pending} onClick={() => submit(true)}>
                {pending ? "กำลังบันทึก…" : "บันทึก + เริ่มสัญญา"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        :global(.rs-input) {
          width: 100%;
          height: 42px;
          padding: 0 12px;
          border-radius: 10px;
          border: 1px solid var(--rs-border);
          background: var(--rs-bg-2);
          color: var(--rs-text);
          font-size: 14px;
        }
        :global(textarea.rs-input) {
          height: auto;
          padding: 10px 12px;
        }
        :global(.rs-input:focus) {
          outline: none;
          border-color: var(--rs-brand);
          background: #fff;
        }
      `}</style>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}
