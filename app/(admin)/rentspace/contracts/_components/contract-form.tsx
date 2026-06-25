"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X, FileText, Check, ChevronLeft, ChevronRight, Search, DoorOpen, User, Eye, AlertTriangle } from "lucide-react";
import { actSaveContract, actSaveTenant } from "../../_actions";
import { ContractPreview, type ContractPreviewProject } from "@/components/rentspace/contract-preview";

type Unit = {
  id: string;
  code: string;
  name?: string | null;
  baseRentThb?: unknown;
  building?: string | null;
  /** present เมื่อ caller ส่ง units ทั้งหมด — ใช้กรองห้องว่าง/จองในสเต็ป 1 */
  status?: string | null;
};
type Tenant = {
  id: string;
  bizName?: string | null;
  prefix?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  nickname?: string | null;
  phones?: string[] | null;
};
type Template = { id: string; name: string; isDefault: boolean; bodyHtml?: string | null };

/** ค่าตั้งต้นเมื่อ "แก้ไขสัญญาเดิม" — ถ้าไม่ส่ง = สร้างใหม่ */
type EditInitial = {
  id: string;
  unitId: string;
  tenantId: string;
  templateId?: string | null;
  startDate: string;
  endDate?: string | null;
  rentAmountThb: number;
  rentDueDay?: number | null;
  depositAmountThb: number;
  depositMonths?: number | null;
  vatPercent?: number | null;
  electricRate?: number | null;
  waterRate?: number | null;
  lateFeeType?: "none" | "fixed" | "percent_total" | "per_day";
  lateFeeValue?: number | null;
  lateFeeGraceDays?: number | null;
  promoDiscountThb?: number | null;
  promoMonths?: number | null;
  billIssueDay?: number | null;
  customTermsHtml?: string | null;
  note?: string | null;
  /** เซ็นแล้วหรือยัง — ใช้โชว์แบนเนอร์เตือนตอนแก้ */
  tenantSigned?: boolean;
};

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

function baht(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function thaiDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}

/** บวกเดือนแบบปลอดภัย แล้วถอย 1 วัน → ได้วันสิ้นสุดสัญญาแบบครบรอบพอดี */
function addMonths(iso: string, months: number): string {
  if (!iso || months <= 0) return "";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // กันเดือนล้น (เช่น 31 ม.ค. +1 = 3 มี.ค.)
  if (d.getDate() < day) d.setDate(0);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

const STEPS = ["เลือกห้องว่าง", "ผู้เช่า", "เงื่อนไขการเช่า", "ทบทวน"] as const;

export function ContractForm({
  projectId,
  project,
  units,
  tenants,
  templates,
  editInitial,
  trigger,
}: {
  projectId: string;
  /** ข้อมูลโครงการ/บัญชีรับเงิน — ใช้เรนเดอร์พรีวิวสัญญา */
  project: ContractPreviewProject;
  units: Unit[];
  tenants: Tenant[];
  templates: Template[];
  /** ถ้าส่งมา = โหมดแก้ไขสัญญาเดิม (ไม่ใช่สร้างใหม่) */
  editInitial?: EditInitial;
  /** optional custom open button; defaults to a primary "ทำสัญญาใหม่" */
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [step, setStep] = useState(0);
  const [showPreview, setShowPreview] = useState(false); // มือถือ: เปิด/ปิด sheet พรีวิว

  const today = new Date().toISOString().slice(0, 10);
  const defaultTemplate = editInitial?.templateId ?? templates.find((t) => t.isDefault)?.id ?? "";
  const isEdit = !!editInitial;
  const editSigned = !!editInitial?.tenantSigned;

  // ── form state (prefill จาก editInitial ถ้ามี) ─────────────────
  const [unitId, setUnitId] = useState(editInitial?.unitId ?? "");
  const [tenantId, setTenantId] = useState(editInitial?.tenantId ?? "");
  const [templateId, setTemplateId] = useState(defaultTemplate);
  const [startDate, setStartDate] = useState(editInitial?.startDate ?? today);
  const [endDate, setEndDate] = useState(editInitial?.endDate ?? "");
  const [termMonths, setTermMonths] = useState(""); // ตัวช่วยคำนวณวันสิ้นสุด
  const [rentAmount, setRentAmount] = useState(editInitial ? String(editInitial.rentAmountThb) : "");
  const [rentDueDay, setRentDueDay] = useState(String(editInitial?.rentDueDay ?? 5));
  const [depositAmount, setDepositAmount] = useState(editInitial ? String(editInitial.depositAmountThb) : "");
  const [vatPercent, setVatPercent] = useState(String(editInitial?.vatPercent ?? 0));
  const [electricRate, setElectricRate] = useState(editInitial?.electricRate != null ? String(editInitial.electricRate) : "");
  const [waterRate, setWaterRate] = useState(editInitial?.waterRate != null ? String(editInitial.waterRate) : "");
  const [lateFeeType, setLateFeeType] = useState<"none" | "fixed" | "percent_total" | "per_day">(editInitial?.lateFeeType ?? "none");
  const [lateFeeValue, setLateFeeValue] = useState(editInitial?.lateFeeValue ? String(editInitial.lateFeeValue) : "");
  const [lateFeeGraceDays, setLateFeeGraceDays] = useState(String(editInitial?.lateFeeGraceDays ?? 7));
  const [promoDiscount, setPromoDiscount] = useState(editInitial?.promoDiscountThb ? String(editInitial.promoDiscountThb) : "");
  const [promoMonths, setPromoMonths] = useState(editInitial?.promoMonths ? String(editInitial.promoMonths) : "");
  const [billIssueDay, setBillIssueDay] = useState(editInitial?.billIssueDay ? String(editInitial.billIssueDay) : "");
  const [note, setNote] = useState(editInitial?.note ?? "");
  // เนื้อหาสัญญาแบบแก้ได้อิสระ — โหลดจากแม่แบบ/สัญญาเดิม แล้วปรับสดได้
  const [customTermsHtml, setCustomTermsHtml] = useState(editInitial?.customTermsHtml ?? "");

  // step-1 unit search
  const [unitSearch, setUnitSearch] = useState("");

  // step-2 tenant picker
  const [tenantSearch, setTenantSearch] = useState("");
  const [newTenantMode, setNewTenantMode] = useState(false);
  const [ntPrefix, setNtPrefix] = useState("");
  const [ntFirst, setNtFirst] = useState("");
  const [ntLast, setNtLast] = useState("");
  const [ntBiz, setNtBiz] = useState("");
  const [ntPhone, setNtPhone] = useState("");
  const [ntIdCard, setNtIdCard] = useState("");

  // ── selectors / derived ─────────────────────────────────────
  const selectedUnit = useMemo(() => units.find((u) => u.id === unitId) ?? null, [units, unitId]);
  const selectedTenant = useMemo(() => tenants.find((t) => t.id === tenantId) ?? null, [tenants, tenantId]);

  // ห้องว่าง/จองเท่านั้น (caller อาจส่ง units กรองมาแล้ว — ถ้าไม่มี field status ก็ถือว่าเลือกได้)
  const vacantUnits = useMemo(
    () => units.filter((u) => u.status == null || u.status === "vacant" || u.status === "reserved"),
    [units],
  );
  const filteredUnits = useMemo(() => {
    const q = unitSearch.trim().toLowerCase();
    if (!q) return vacantUnits;
    return vacantUnits.filter((u) =>
      [u.code, u.name, u.building].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [vacantUnits, unitSearch]);

  const filteredTenants = useMemo(() => {
    const q = tenantSearch.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter((t) =>
      [tenantLabel(t), ...(t.phones ?? [])].join(" ").toLowerCase().includes(q),
    );
  }, [tenants, tenantSearch]);

  const ntName = [ntBiz, ntFirst, ntLast].filter(Boolean).join(" ").trim();
  const newTenantValid = newTenantMode && (ntBiz.trim() !== "" || ntFirst.trim() !== "");

  function reset() {
    setStep(0);
    setShowPreview(false);
    setUnitId(editInitial?.unitId ?? "");
    setTenantId(editInitial?.tenantId ?? "");
    setTemplateId(defaultTemplate);
    setStartDate(editInitial?.startDate ?? today);
    setEndDate(editInitial?.endDate ?? "");
    setTermMonths("");
    setRentAmount(editInitial ? String(editInitial.rentAmountThb) : "");
    setRentDueDay(String(editInitial?.rentDueDay ?? 5));
    setDepositAmount(editInitial ? String(editInitial.depositAmountThb) : "");
    setVatPercent(String(editInitial?.vatPercent ?? 0));
    setElectricRate(editInitial?.electricRate != null ? String(editInitial.electricRate) : "");
    setWaterRate(editInitial?.waterRate != null ? String(editInitial.waterRate) : "");
    setLateFeeType(editInitial?.lateFeeType ?? "none");
    setLateFeeValue(editInitial?.lateFeeValue ? String(editInitial.lateFeeValue) : "");
    setLateFeeGraceDays(String(editInitial?.lateFeeGraceDays ?? 7));
    setPromoDiscount(editInitial?.promoDiscountThb ? String(editInitial.promoDiscountThb) : "");
    setPromoMonths(editInitial?.promoMonths ? String(editInitial.promoMonths) : "");
    setBillIssueDay(editInitial?.billIssueDay ? String(editInitial.billIssueDay) : "");
    setNote(editInitial?.note ?? "");
    setCustomTermsHtml(editInitial?.customTermsHtml ?? "");
    setUnitSearch("");
    setTenantSearch("");
    setNewTenantMode(false);
    setNtPrefix("");
    setNtFirst("");
    setNtLast("");
    setNtBiz("");
    setNtPhone("");
    setNtIdCard("");
  }

  function close() {
    if (pending) return;
    setOpen(false);
    reset();
  }

  // เลือกห้อง → prefill ค่าเช่าจาก baseRent ถ้ายังว่าง
  function onPickUnit(u: Unit) {
    setUnitId(u.id);
    const base = u.baseRentThb != null ? Number(u.baseRentThb) : 0;
    if (base > 0 && !rentAmount) setRentAmount(String(base));
  }

  function onPickTenant(id: string) {
    setNewTenantMode(false);
    setTenantId(id);
  }

  // เลือกแม่แบบ → โหลดเนื้อหาแม่แบบเข้า "เนื้อสัญญาแบบแก้ได้" (ถ้ายังไม่เคยแก้เอง)
  function onPickTemplate(id: string) {
    setTemplateId(id);
    const tpl = templates.find((t) => t.id === id);
    // เติมเนื้อหาก็ต่อเมื่อช่องว่าง เพื่อไม่ทับสิ่งที่ผู้ใช้พิมพ์เอง
    if (tpl?.bodyHtml && !customTermsHtml.trim()) setCustomTermsHtml(tpl.bodyHtml);
  }

  // ── ค่าที่ส่งให้พรีวิว (อัปเดตสดตามฟอร์ม) ──────────────────────
  const previewTenantName =
    selectedTenant ? tenantLabel(selectedTenant) : newTenantValid ? ntName : "ผู้เช่า";
  const previewBody = customTermsHtml.trim()
    ? customTermsHtml
    : templates.find((t) => t.id === templateId)?.bodyHtml ?? "";
  const previewValues = {
    tenantName: previewTenantName,
    unitCode: selectedUnit?.code ?? "—",
    unitName: selectedUnit?.name ?? null,
    rentAmountThb: num(rentAmount),
    depositAmountThb: num(depositAmount),
    depositMonths:
      num(rentAmount) > 0 ? Math.round((num(depositAmount) / num(rentAmount)) * 10) / 10 : 0,
    rentDueDay: Number(rentDueDay) || 5,
    startDate,
    endDate: endDate || null,
    vatPercent: num(vatPercent),
  };

  // ── ตัวช่วย deposit / term ───────────────────────────────────
  function setDepositByMonths(months: number) {
    const r = num(rentAmount);
    if (r > 0) setDepositAmount(String(Math.round(r * months * 100) / 100));
  }
  function applyTermMonths(m: string) {
    setTermMonths(m);
    const months = Number(m);
    if (months > 0 && startDate) setEndDate(addMonths(startDate, months));
  }

  // ── step gating ──────────────────────────────────────────────
  const canNext = useMemo(() => {
    if (step === 0) return !!unitId;
    if (step === 1) return !!tenantId || newTenantValid;
    if (step === 2) return num(rentAmount) > 0 && !!startDate;
    return true;
  }, [step, unitId, tenantId, newTenantValid, rentAmount, startDate]);

  function goNext() {
    if (!canNext) {
      if (step === 0) toast.error("กรุณาเลือกห้อง");
      else if (step === 1) toast.error("กรุณาเลือกผู้เช่า หรือกรอกชื่อผู้เช่าใหม่");
      else if (step === 2) {
        if (num(rentAmount) <= 0) toast.error("กรุณากรอกค่าเช่า");
        else toast.error("กรุณาเลือกวันเริ่มสัญญา");
      }
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  // ── submit ───────────────────────────────────────────────────
  function submit(activate: boolean) {
    if (!unitId) return toast.error("กรุณาเลือกห้อง/ยูนิต");
    if (!tenantId && !newTenantValid) return toast.error("กรุณาเลือกผู้เช่า");
    if (num(rentAmount) <= 0) return toast.error("กรุณากรอกค่าเช่า");
    if (!startDate) return toast.error("กรุณาเลือกวันเริ่มสัญญา");

    start(async () => {
      try {
        // ถ้าเป็นผู้เช่าใหม่ → สร้างก่อนเพื่อให้ได้ tenantId
        let finalTenantId = tenantId;
        if (!finalTenantId && newTenantValid) {
          const created = await actSaveTenant({
            prefix: ntPrefix || undefined,
            firstName: ntFirst || undefined,
            lastName: ntLast || undefined,
            bizName: ntBiz || undefined,
            phones: ntPhone ? [ntPhone] : undefined,
            idCardNo: ntIdCard || undefined,
          });
          finalTenantId = created.id;
        }

        const res = await actSaveContract({
          id: editInitial?.id,
          projectId,
          unitId,
          tenantId: finalTenantId,
          templateId: templateId || undefined,
          startDate,
          endDate: endDate || undefined,
          rentAmountThb: num(rentAmount),
          rentDueDay: Number(rentDueDay) || 5,
          depositAmountThb: num(depositAmount),
          vatPercent: num(vatPercent),
          electricRate: electricRate ? num(electricRate) : undefined,
          waterRate: waterRate ? num(waterRate) : undefined,
          lateFeeType,
          lateFeeValue: num(lateFeeValue),
          lateFeeGraceDays: Number(lateFeeGraceDays) || 7,
          promoDiscountThb: promoDiscount ? num(promoDiscount) : undefined,
          promoMonths: promoMonths ? Number(promoMonths) : undefined,
          billIssueDay: billIssueDay ? Number(billIssueDay) : undefined,
          customTermsHtml: customTermsHtml.trim() || undefined,
          note: note || undefined,
          activate,
        });
        if (res && "reSignRequired" in res && res.reSignRequired) {
          toast.success("ออกฉบับแก้ไขแล้ว — ส่งลิงก์ให้ผู้เช่าเซ็นใหม่");
        } else {
          toast.success(isEdit ? "บันทึกสัญญาแล้ว" : activate ? "เริ่มสัญญาเรียบร้อย" : "บันทึกร่างสัญญาแล้ว");
        }
        setOpen(false);
        reset();
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  // ── review summary rows ──────────────────────────────────────
  const tenantSummary = selectedTenant ? tenantLabel(selectedTenant) : newTenantValid ? `${ntName} (ผู้เช่าใหม่)` : "—";
  const depositMonthsEq = num(rentAmount) > 0 ? (num(depositAmount) / num(rentAmount)).toFixed(1) : "0";

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
          onClick={close}
        >
          <div
            className="w-full sm:max-w-2xl lg:max-w-5xl max-h-[92vh] sm:max-h-[88vh] flex"
            onClick={(e) => e.stopPropagation()}
          >
          {/* ── LEFT: form column ── */}
          <div className="rs-card w-full lg:w-[480px] lg:flex-shrink-0 max-h-[92vh] sm:max-h-[88vh] flex flex-col rounded-b-none sm:rounded-2xl lg:rounded-r-none overflow-hidden">
            {/* ── sticky header + stepper ── */}
            <div
              className="sticky top-0 z-10 px-5 pt-4 pb-3 border-b"
              style={{ background: "#fff", borderColor: "var(--rs-border)" }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-lg" style={{ color: "var(--rs-text)" }}>
                  <FileText className="h-5 w-5" style={{ color: "var(--rs-brand)" }} /> {isEdit ? "แก้ไขสัญญา" : "ทำสัญญาใหม่"}
                </div>
                <button onClick={close} disabled={pending} className="-mr-2 inline-flex size-11 sm:size-9 items-center justify-center rounded-lg hover:bg-black/5" aria-label="ปิด">
                  <X className="h-5 w-5" style={{ color: "var(--rs-text-2)" }} />
                </button>
              </div>

              {/* visual stepper: circles + connecting lines */}
              <div className="mt-3 flex items-center">
                {STEPS.map((label, i) => {
                  const done = i < step;
                  const active = i === step;
                  return (
                    <div key={label} className="flex items-center" style={{ flex: i < STEPS.length - 1 ? 1 : "0 0 auto" }}>
                      <div className="flex flex-col items-center gap-1">
                        <div
                          className="flex items-center justify-center rounded-full text-[12px] font-bold transition-all"
                          style={{
                            width: 28,
                            height: 28,
                            background: done || active ? "var(--rs-brand)" : "var(--rs-bg-2)",
                            color: done || active ? "#fff" : "var(--rs-text-3)",
                            border: `1.5px solid ${done || active ? "var(--rs-brand)" : "var(--rs-border)"}`,
                          }}
                        >
                          {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                        </div>
                        <span
                          className="text-[10.5px] font-medium whitespace-nowrap"
                          style={{ color: active ? "var(--rs-brand)" : "var(--rs-text-3)" }}
                        >
                          {label}
                        </span>
                      </div>
                      {i < STEPS.length - 1 && (
                        <div
                          className="h-[2px] flex-1 mx-1.5 -mt-4 rounded"
                          style={{ background: i < step ? "var(--rs-brand)" : "var(--rs-border)" }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── scrollable body ── */}
            <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
              {/* แบนเนอร์เตือนเมื่อแก้สัญญาที่เซ็นแล้ว */}
              {editSigned && (
                <div
                  className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-[12.5px]"
                  style={{ background: "var(--rs-pending-soft)", color: "var(--rs-pending)" }}
                >
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>สัญญานี้เซ็นแล้ว — การบันทึกจะออกฉบับแก้ไขและต้องให้ผู้เช่าเซ็นใหม่</span>
                </div>
              )}

              {/* มือถือ: ปุ่มเปิดพรีวิวสัญญาเต็มจอ */}
              <button
                type="button"
                onClick={() => setShowPreview(true)}
                className="lg:hidden rs-btn rs-btn-ghost w-full justify-center min-h-[44px]"
              >
                <Eye className="h-4 w-4" /> ดูตัวอย่างสัญญา
              </button>

              {/* STEP 1 — เลือกห้องว่าง */}
              {step === 0 && (
                <div className="space-y-3">
                  <div className="relative">
                    <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--rs-text-3)" }} />
                    <input
                      className="rs-input"
                      style={{ paddingLeft: 36 }}
                      placeholder="ค้นหาห้อง / อาคาร"
                      value={unitSearch}
                      onChange={(e) => setUnitSearch(e.target.value)}
                    />
                  </div>

                  {filteredUnits.length === 0 ? (
                    <div className="text-center py-10" style={{ color: "var(--rs-text-3)" }}>
                      <DoorOpen className="h-8 w-8 mx-auto mb-2 opacity-60" />
                      <p className="text-[13px]">ไม่มีห้องว่างที่ตรงกับการค้นหา</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      {filteredUnits.map((u) => {
                        const sel = u.id === unitId;
                        const base = u.baseRentThb != null ? Number(u.baseRentThb) : 0;
                        return (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => onPickUnit(u)}
                            className="relative text-left rounded-xl p-3 transition-all"
                            style={{
                              border: `1.5px solid ${sel ? "var(--rs-brand)" : "var(--rs-border)"}`,
                              background: sel ? "var(--rs-brand-50)" : "#fff",
                            }}
                          >
                            {sel && (
                              <span
                                className="absolute top-2 right-2 flex items-center justify-center rounded-full"
                                style={{ width: 18, height: 18, background: "var(--rs-brand)" }}
                              >
                                <Check className="h-3 w-3 text-white" />
                              </span>
                            )}
                            <div className="font-bold text-[15px]" style={{ color: "var(--rs-text)" }}>
                              {u.code}
                            </div>
                            {u.name && (
                              <div className="text-[12px] truncate" style={{ color: "var(--rs-text-2)" }}>
                                {u.name}
                              </div>
                            )}
                            {u.building && (
                              <div className="text-[11px]" style={{ color: "var(--rs-text-3)" }}>
                                {u.building}
                              </div>
                            )}
                            {base > 0 && (
                              <div className="mt-1.5 text-[12.5px] font-semibold tabular-nums" style={{ color: "var(--rs-brand)" }}>
                                ฿{baht(base)}<span className="font-normal" style={{ color: "var(--rs-text-3)" }}>/เดือน</span>
                              </div>
                            )}
                            {u.status === "reserved" && (
                              <div className="mt-1 inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: "var(--rs-bg-2)", color: "var(--rs-text-2)" }}>
                                จองแล้ว
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* STEP 2 — ผู้เช่า */}
              {step === 1 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[13px] font-semibold" style={{ color: "var(--rs-text)" }}>
                      เลือกผู้เช่า
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setNewTenantMode((v) => !v);
                        if (!newTenantMode) setTenantId("");
                      }}
                      className="inline-flex items-center gap-1 text-[12.5px] font-semibold"
                      style={{ color: newTenantMode ? "var(--rs-text-2)" : "var(--rs-brand)" }}
                    >
                      {newTenantMode ? (
                        <><X className="h-3.5 w-3.5" /> ยกเลิกเพิ่มใหม่</>
                      ) : (
                        <><Plus className="h-3.5 w-3.5" /> เพิ่มผู้เช่าใหม่</>
                      )}
                    </button>
                  </div>

                  {newTenantMode ? (
                    <div className="rounded-xl p-3 space-y-3" style={{ border: "1px solid var(--rs-border)", background: "var(--rs-bg-2)" }}>
                      <div className="grid grid-cols-3 gap-2">
                        <Field label="คำนำหน้า">
                          <input className="rs-input" value={ntPrefix} onChange={(e) => setNtPrefix(e.target.value)} placeholder="นาย/นาง/บจก." />
                        </Field>
                        <Field label="ชื่อ">
                          <input className="rs-input" value={ntFirst} onChange={(e) => setNtFirst(e.target.value)} />
                        </Field>
                        <Field label="นามสกุล">
                          <input className="rs-input" value={ntLast} onChange={(e) => setNtLast(e.target.value)} />
                        </Field>
                      </div>
                      <Field label="ชื่อร้าน / นิติบุคคล (ถ้ามี)">
                        <input className="rs-input" value={ntBiz} onChange={(e) => setNtBiz(e.target.value)} placeholder="เช่น ร้านกาแฟ / บจก. ..." />
                      </Field>
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="เบอร์โทร">
                          <input className="rs-input" inputMode="tel" value={ntPhone} onChange={(e) => setNtPhone(e.target.value)} placeholder="08x-xxx-xxxx" />
                        </Field>
                        <Field label="เลขบัตรประชาชน">
                          <input className="rs-input" inputMode="numeric" value={ntIdCard} onChange={(e) => setNtIdCard(e.target.value)} />
                        </Field>
                      </div>
                      <p className="text-[11.5px]" style={{ color: "var(--rs-text-3)" }}>
                        ต้องกรอกอย่างน้อย “ชื่อ” หรือ “ชื่อร้าน” — ระบบจะสร้างผู้เช่าใหม่ตอนกดบันทึกสัญญา
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="relative">
                        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--rs-text-3)" }} />
                        <input
                          className="rs-input"
                          style={{ paddingLeft: 36 }}
                          placeholder="ค้นหาผู้เช่า / เบอร์โทร"
                          value={tenantSearch}
                          onChange={(e) => setTenantSearch(e.target.value)}
                        />
                      </div>
                      {filteredTenants.length === 0 ? (
                        <div className="text-center py-8" style={{ color: "var(--rs-text-3)" }}>
                          <User className="h-7 w-7 mx-auto mb-2 opacity-60" />
                          <p className="text-[13px]">ไม่พบผู้เช่า — กด “เพิ่มผู้เช่าใหม่” ด้านบน</p>
                        </div>
                      ) : (
                        <div className="space-y-1.5 max-h-[44vh] overflow-y-auto">
                          {filteredTenants.map((t) => {
                            const sel = t.id === tenantId;
                            const phone = (t.phones ?? [])[0];
                            return (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => onPickTenant(t.id)}
                                className="w-full flex items-center justify-between text-left rounded-xl px-3 py-2.5 transition-all"
                                style={{
                                  border: `1.5px solid ${sel ? "var(--rs-brand)" : "var(--rs-border)"}`,
                                  background: sel ? "var(--rs-brand-50)" : "#fff",
                                }}
                              >
                                <div className="min-w-0">
                                  <div className="font-semibold text-[14px] truncate" style={{ color: "var(--rs-text)" }}>
                                    {tenantLabel(t)}
                                  </div>
                                  {phone && (
                                    <div className="text-[12px]" style={{ color: "var(--rs-text-3)" }}>
                                      {phone}
                                    </div>
                                  )}
                                </div>
                                {sel && (
                                  <span
                                    className="flex-shrink-0 flex items-center justify-center rounded-full"
                                    style={{ width: 20, height: 20, background: "var(--rs-brand)" }}
                                  >
                                    <Check className="h-3.5 w-3.5 text-white" />
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* STEP 3 — เงื่อนไขการเช่า */}
              {step === 2 && (
                <div className="space-y-4">
                  <Field label="แม่แบบสัญญา (ไม่บังคับ)">
                    <select className="rs-input" value={templateId} onChange={(e) => onPickTemplate(e.target.value)}>
                      <option value="">— ไม่ใช้แม่แบบ —</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {t.isDefault ? " (ค่าเริ่มต้น)" : ""}
                        </option>
                      ))}
                    </select>
                  </Field>

                  {/* เนื้อสัญญาแบบแก้ได้อิสระ — โหลดจากแม่แบบ แล้วปรับสด เห็นในพรีวิวทันที */}
                  <Field label="เนื้อหาสัญญา (แก้ไขได้ · ใช้ {{tenantName}} {{rentAmount}} ฯลฯ เป็นตัวแปร)">
                    <textarea
                      className="rs-input min-h-[120px] font-mono"
                      value={customTermsHtml}
                      onChange={(e) => setCustomTermsHtml(e.target.value)}
                      placeholder="เว้นว่าง = ใช้เนื้อสัญญามาตรฐาน · พิมพ์/วาง HTML หรือข้อความเพื่อกำหนดเอง"
                    />
                  </Field>
                  <p className="text-[11.5px] -mt-2" style={{ color: "var(--rs-text-3)" }}>
                    ตัวแปรที่ใช้ได้: {"{{tenantName}} {{unitCode}} {{rentAmount}} {{depositAmount}} {{depositMonths}} {{rentDueDay}} {{startDate}} {{endDate}} {{landlordName}} {{bankInfo}} {{today}}"}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Field label="ค่าเช่า/เดือน (บาท) *">
                        <input inputMode="decimal" className="rs-input" value={rentAmount} onChange={(e) => setRentAmount(e.target.value)} placeholder="0.00" />
                      </Field>
                    </div>
                    <div>
                      <Field label="ครบกำหนดชำระ (วันที่ 1-28)">
                        <input type="number" min={1} max={28} className="rs-input" value={rentDueDay} onChange={(e) => setRentDueDay(e.target.value)} />
                      </Field>
                    </div>
                  </div>

                  <div>
                    <Field label="เงินประกัน (บาท)">
                      <input inputMode="decimal" className="rs-input" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} placeholder="0.00" />
                    </Field>
                    <div className="flex gap-1.5 mt-1.5">
                      {[1, 2, 3].map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setDepositByMonths(m)}
                          disabled={num(rentAmount) <= 0}
                          className="text-[12px] font-medium px-2.5 py-1 rounded-lg transition disabled:opacity-40"
                          style={{ background: "var(--rs-brand-50)", color: "var(--rs-brand)" }}
                        >
                          = {m} เดือน
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="วันเริ่มสัญญา *">
                      <input
                        type="date"
                        className="rs-input"
                        value={startDate}
                        onChange={(e) => {
                          setStartDate(e.target.value);
                          if (termMonths) setEndDate(addMonths(e.target.value, Number(termMonths)));
                        }}
                      />
                    </Field>
                    <Field label="วันสิ้นสุด (ไม่บังคับ)">
                      <input
                        type="date"
                        className="rs-input"
                        value={endDate}
                        onChange={(e) => {
                          setEndDate(e.target.value);
                          setTermMonths("");
                        }}
                      />
                    </Field>
                  </div>
                  <div>
                    <label className="block text-[12.5px] font-medium mb-1" style={{ color: "var(--rs-text-2)" }}>
                      หรือกำหนดระยะเวลา (เดือน) — ระบบจะคำนวณวันสิ้นสุดให้
                    </label>
                    <div className="flex gap-1.5">
                      {[6, 12, 24, 36].map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => applyTermMonths(String(m))}
                          disabled={!startDate}
                          className="text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition disabled:opacity-40"
                          style={{
                            background: termMonths === String(m) ? "var(--rs-brand)" : "var(--rs-bg-2)",
                            color: termMonths === String(m) ? "#fff" : "var(--rs-text-2)",
                            border: "1px solid var(--rs-border)",
                          }}
                        >
                          {m} เดือน
                        </button>
                      ))}
                    </div>
                  </div>

                  <Field label="VAT (%)">
                    <input inputMode="decimal" className="rs-input" value={vatPercent} onChange={(e) => setVatPercent(e.target.value)} placeholder="0" />
                  </Field>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Field label="ค่าปรับล่าช้า">
                      <select
                        className="rs-input"
                        value={lateFeeType}
                        onChange={(e) => setLateFeeType(e.target.value as typeof lateFeeType)}
                      >
                        {Object.entries(LATE_FEE_LABELS).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
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

                  {/* #3 ส่วนลดส่งเสริมการขาย (โปรโมชั่น) — ลดต่อเดือน × จำนวนเดือน */}
                  <div className="rounded-xl p-3" style={{ border: "1px dashed var(--rs-border)", background: "var(--rs-bg-2)" }}>
                    <div className="text-[12.5px] font-semibold mb-2" style={{ color: "var(--rs-text-2)" }}>
                      ส่วนลดโปรโมชั่น (ถ้ามี) — ลดอัตโนมัติทุกบิลตามจำนวนเดือนที่กำหนด
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="ลดต่อเดือน (บาท)">
                        <input inputMode="decimal" className="rs-input" value={promoDiscount} onChange={(e) => setPromoDiscount(e.target.value)} placeholder="0" />
                      </Field>
                      <Field label="เป็นเวลา (เดือน)">
                        <input type="number" min={0} className="rs-input" value={promoMonths} onChange={(e) => setPromoMonths(e.target.value)} placeholder="0" />
                      </Field>
                    </div>
                  </div>

                  {/* #9c วันวางบิลเฉพาะสัญญานี้ (ถ้าต่างจากค่ากลางโครงการ) */}
                  <Field label="วันวางบิลของห้องนี้ (1-28 · เว้นว่าง = ใช้ค่ากลางโครงการ)">
                    <input type="number" min={1} max={28} className="rs-input" value={billIssueDay} onChange={(e) => setBillIssueDay(e.target.value)} placeholder="ตามโครงการ" />
                  </Field>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="ค่าไฟ/หน่วย (ไม่บังคับ — ใช้ค่าโครงการถ้าเว้นว่าง)">
                      <input inputMode="decimal" className="rs-input" value={electricRate} onChange={(e) => setElectricRate(e.target.value)} placeholder="ตามโครงการ" />
                    </Field>
                    <Field label="ค่าน้ำ/หน่วย (ไม่บังคับ)">
                      <input inputMode="decimal" className="rs-input" value={waterRate} onChange={(e) => setWaterRate(e.target.value)} placeholder="ตามโครงการ" />
                    </Field>
                  </div>

                  <Field label="หมายเหตุ">
                    <textarea className="rs-input min-h-[64px]" value={note} onChange={(e) => setNote(e.target.value)} />
                  </Field>
                </div>
              )}

              {/* STEP 4 — ทบทวน */}
              {step === 3 && (
                <div className="space-y-3">
                  <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--rs-border)" }}>
                    <SummaryRow label="ห้อง / ยูนิต" value={selectedUnit ? `${selectedUnit.code}${selectedUnit.name ? ` · ${selectedUnit.name}` : ""}` : "—"} />
                    <SummaryRow label="ผู้เช่า" value={tenantSummary} />
                    <SummaryRow label="ค่าเช่า/เดือน" value={`฿${baht(num(rentAmount))}`} strong />
                    <SummaryRow
                      label="เงินประกัน"
                      value={num(depositAmount) > 0 ? `฿${baht(num(depositAmount))}  (≈ ${depositMonthsEq} เดือน)` : "—"}
                    />
                    <SummaryRow label="ครบกำหนดชำระ" value={`ทุกวันที่ ${Number(rentDueDay) || 5} ของเดือน`} />
                    <SummaryRow
                      label="ช่วงสัญญา"
                      value={`${thaiDate(startDate)} ${endDate ? `– ${thaiDate(endDate)}` : "– ไม่มีกำหนด"}`}
                    />
                    <SummaryRow label="VAT" value={num(vatPercent) > 0 ? `${num(vatPercent)}%` : "ไม่มี"} />
                    <SummaryRow
                      label="ค่าไฟ / ค่าน้ำ ต่อหน่วย"
                      value={`${electricRate ? `฿${baht(num(electricRate))}` : "ตามโครงการ"} / ${waterRate ? `฿${baht(num(waterRate))}` : "ตามโครงการ"}`}
                    />
                    <SummaryRow
                      label="ค่าปรับล่าช้า"
                      value={
                        lateFeeType === "none"
                          ? "ไม่คิด"
                          : `${LATE_FEE_LABELS[lateFeeType]} · ${baht(num(lateFeeValue))} · ผ่อนผัน ${Number(lateFeeGraceDays) || 0} วัน`
                      }
                      last
                    />
                  </div>

                  {note && (
                    <div className="text-[12.5px] rounded-lg px-3 py-2" style={{ background: "var(--rs-bg-2)", color: "var(--rs-text-2)" }}>
                      หมายเหตุ: {note}
                    </div>
                  )}

                  <div
                    className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-[12.5px]"
                    style={{ background: "var(--rs-ok-soft)", color: "var(--rs-ok)" }}
                  >
                    <Check className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>เมื่อสร้างแล้ว ห้องจะเปลี่ยนเป็น “เช่าอยู่” (เฉพาะเมื่อกด “สร้าง + เริ่มสัญญา”) · บันทึกร่างจะยังไม่จองห้อง</span>
                  </div>
                </div>
              )}
            </div>

            {/* ── sticky footer ── */}
            <div
              className="sticky bottom-0 flex flex-wrap items-center gap-2 px-5 py-3 border-t"
              style={{ background: "#fff", borderColor: "var(--rs-border)" }}
            >
              {step > 0 && (
                <button className="rs-btn rs-btn-ghost min-h-[44px] sm:min-h-0" disabled={pending} onClick={goBack}>
                  <ChevronLeft className="h-4 w-4" /> ย้อนกลับ
                </button>
              )}

              {step < STEPS.length - 1 ? (
                <button
                  className="rs-btn flex-1 justify-center min-h-[44px] sm:min-h-0"
                  disabled={!canNext || pending}
                  onClick={goNext}
                  style={!canNext ? { opacity: 0.5 } : undefined}
                >
                  ถัดไป <ChevronRight className="h-4 w-4" />
                </button>
              ) : isEdit ? (
                <button className="rs-btn flex-1 justify-center min-h-[44px] sm:min-h-0" disabled={pending} onClick={() => submit(true)}>
                  {pending ? "กำลังบันทึก…" : editSigned ? "บันทึก + ออกฉบับแก้ไข" : "บันทึกการแก้ไข"}
                </button>
              ) : (
                <>
                  <button className="rs-btn rs-btn-ghost flex-1 justify-center min-h-[44px] sm:min-h-0 basis-[120px]" disabled={pending} onClick={() => submit(false)}>
                    บันทึกร่าง
                  </button>
                  <button className="rs-btn flex-1 justify-center min-h-[44px] sm:min-h-0 basis-[160px]" disabled={pending} onClick={() => submit(true)}>
                    {pending ? "กำลังบันทึก…" : "สร้าง + เริ่มสัญญา"}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* ── RIGHT: live A4 preview (desktop sticky) ── */}
          <div className="hidden lg:flex flex-col flex-1 rs-card rounded-l-none border-l-0 max-h-[88vh] overflow-hidden">
            <div
              className="sticky top-0 z-10 flex items-center gap-2 px-5 py-3 border-b font-bold"
              style={{ background: "var(--rs-bg-2)", borderColor: "var(--rs-border)", color: "var(--rs-text)" }}
            >
              <Eye className="h-4 w-4" style={{ color: "var(--rs-brand)" }} /> ตัวอย่างสัญญา (อัปเดตสด)
            </div>
            <div className="flex-1 overflow-y-auto p-4" style={{ background: "var(--rs-bg-3)" }}>
              <div className="mx-auto shadow-sm rounded-lg overflow-hidden" style={{ maxWidth: 720 }}>
                <ContractPreview values={previewValues} project={project} bodyHtml={previewBody} />
              </div>
            </div>
          </div>
          </div>
        </div>
      )}

      {/* ── mobile: full-screen preview sheet ── */}
      {open && showPreview && (
        <div className="lg:hidden fixed inset-0 z-[60] flex flex-col bg-black/40" onClick={() => setShowPreview(false)}>
          <div
            className="mt-auto sm:m-auto w-full sm:max-w-2xl max-h-[94vh] flex flex-col rs-card rounded-b-none sm:rounded-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="sticky top-0 z-10 flex items-center justify-between px-5 py-3 border-b font-bold"
              style={{ background: "#fff", borderColor: "var(--rs-border)", color: "var(--rs-text)" }}
            >
              <span className="inline-flex items-center gap-2">
                <Eye className="h-4 w-4" style={{ color: "var(--rs-brand)" }} /> ตัวอย่างสัญญา
              </span>
              <button onClick={() => setShowPreview(false)} className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-black/5" aria-label="ปิด">
                <X className="h-5 w-5" style={{ color: "var(--rs-text-2)" }} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3" style={{ background: "var(--rs-bg-3)" }}>
              <div className="mx-auto shadow-sm rounded-lg overflow-hidden bg-white">
                <ContractPreview values={previewValues} project={project} bodyHtml={previewBody} />
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        :global(.rs-input) {
          width: 100%;
          height: 44px;
          padding: 0 12px;
          border-radius: 10px;
          border: 1px solid var(--rs-border);
          background: var(--rs-bg-2);
          color: var(--rs-text);
          /* 16px บนมือถือ กัน iOS zoom เวลาแตะ input */
          font-size: 16px;
        }
        @media (min-width: 640px) {
          :global(.rs-input) {
            height: 42px;
            font-size: 14px;
          }
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

function SummaryRow({
  label,
  value,
  strong,
  last,
}: {
  label: string;
  value: string;
  strong?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 px-3.5 py-2.5"
      style={{ borderBottom: last ? "none" : "1px solid var(--rs-border)" }}
    >
      <span className="text-[13px]" style={{ color: "var(--rs-text-2)" }}>
        {label}
      </span>
      <span
        className="text-[13.5px] text-right tabular-nums"
        style={{ color: strong ? "var(--rs-brand)" : "var(--rs-text)", fontWeight: strong ? 700 : 500 }}
      >
        {value}
      </span>
    </div>
  );
}
