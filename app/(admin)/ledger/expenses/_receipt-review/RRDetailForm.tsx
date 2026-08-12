"use client";

// คอลัมน์ 2 — ฟอร์มลงบัญชี (§1 ลงบัญชี · §2 ข้อมูลร้านค้า · §3 รายการ+ยอดเงิน · แถบปุ่ม).
//
// MONEY-SAFETY (ห้ามพลาด):
// - reuse ExpenseDraft + runRecheck + expenseConfirmability + trcloud-state จาก pane เดิม 100%.
// - เขียน DB ผ่าน server action เดิมเท่านั้น (saveExpense/confirmExpense/sendExpenseToTrcloud/
//   createPaymentRequestAction/overrideClaimability) — ไม่มี write path ใหม่ · ไม่คำนวณเงินฝั่ง server
//   บน client. "ยอดที่ต้องโอน" บนจอ = preview (total − wht) เท่านั้น · ยอดจริง server คิดใน
//   createPaymentRequest().
// - ไม่มีอะไร write ตอน mount/select · ทุก write อยู่หลังปุ่มที่คนกดเอง (no auto-post).
// - locked/void/ส่ง TRCloud แล้ว/กำลังส่ง/อยู่ในคำขอโอน → ทุกช่อง disabled + ห้าม save/confirm.
//
// Pixel: mockup "หน้าตรวจใบเสร็จ" คอลัมน์กลาง — inline style ตรงตาม px/hex/radius/grid + คลาส
// rr-num/rr-mono/rr-hb/rr-bright(6)/rr-ul จาก receipt-review.css.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import type { ReceiptReviewData, RRSelectedExpense } from "./types";
import { runRecheck, type ExpenseDraft } from "@/components/ledger/ExpenseReviewPane";
import {
  expenseConfirmability,
  confirmabilityMessage,
} from "@/lib/ledger/confirmability";
import { trcloudState } from "@/lib/ledger/trcloud-state";
import { llCSlotForGl } from "@/lib/ledger/coa-chart";
import { SearchableSelect } from "@/components/ledger/SearchableSelect";
import type { ExpenseDocType, PaymentStatus, ExpenseItem } from "@/lib/ledger/types";
import {
  saveExpense,
  confirmExpense,
  sendExpenseToTrcloud,
  createPaymentRequestAction,
  overrideClaimability,
} from "../../_actions";

// ── consts (copy จาก ExpenseReviewPane — ไม่ได้ export) ───────────────────────
const DOC_TYPES: { value: ExpenseDocType; label: string }[] = [
  { value: "tax_invoice", label: "ใบกำกับภาษี" },
  { value: "receipt", label: "ใบเสร็จรับเงิน" },
  { value: "cash_bill", label: "บิลเงินสด" },
  { value: "quotation", label: "ใบเสนอราคา / ใบแจ้งหนี้" },
  { value: "delivery_note", label: "ใบส่งของ" },
  { value: "other", label: "อื่น ๆ" },
];
// values ตรงกับ pane (ให้ข้อมูลที่บันทึกสอดคล้องกันทั้งระบบ) — label ในมุมมองนี้เหมือน mockup.
const PAYMENT_METHODS = ["เงินสด", "โอน", "บัตรเครดิต", "เช็ค", "อื่นๆ"];
// visual-only (ไม่มีฟิลด์ใน draft/schema → ไม่ persist): บัญชีจ่าย/รับ/กำหนดชำระ.
const PAY_FROM_HINTS = ["บัญชีจ่ายออก (ของเรา)"];
const PAY_TO_HINTS = ["บัญชีรับโอน (ผู้ขาย)"];
const DUE_HINTS = ["ทันที", "7 วัน", "15 วัน", "30 วัน"];

// ── helpers ───────────────────────────────────────────────────────────────────
function fmt2(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function round2(n: number): number {
  return +(Number.isFinite(n) ? n : 0).toFixed(2);
}
function shortDate(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** ป้ายความมั่นใจ AI แบบ mockup ("AI 80%" อำพัน / "100%" เขียว). null=ไม่โชว์. */
function ConfPill({ score, ai }: { score: number | null | undefined; ai?: boolean }) {
  if (score == null || Number.isNaN(score)) return null;
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  const high = score >= 0.85;
  return (
    <span
      className="rr-num"
      style={{
        fontSize: 9.5,
        fontWeight: 700,
        color: high ? "#059669" : "#b45309",
        background: high ? "#ecfdf5" : "#fef3c7",
        padding: "1px 5px",
        borderRadius: 4,
      }}
    >
      {ai ? `AI ${pct}%` : `${pct}%`}
    </span>
  );
}

/** ช่องกรอกเงิน (บาท) — เก็บ raw string local กันจุด/ศูนย์ท้ายหาย (เทคนิคเดียวกับ AmountInput)
 *  แต่ inline-styled ให้ตรง mockup (ไม่มี prefix ฿ · จัดขวา · ขอบอำพัน/เทาแล้วแต่ช่อง). */
function MoneyCell({
  value,
  onValue,
  disabled,
  amber,
}: {
  value: number;
  onValue: (n: number) => void;
  disabled?: boolean;
  amber?: boolean;
}) {
  const [raw, setRaw] = useState<string>(() => fmt2Raw(value));
  const last = useRef<number>(value);
  useEffect(() => {
    if (value !== last.current) {
      setRaw(fmt2Raw(value));
      last.current = value;
    }
  }, [value]);
  return (
    <input
      className="rr-num"
      inputMode="decimal"
      disabled={disabled}
      value={raw}
      onChange={(e) => {
        // strip ทุกอย่างที่ไม่ใช่ตัวเลข/จุด + กันจุดเกิน 1 จุด
        const parts = e.target.value.replace(/[^\d.]/g, "").split(".");
        const norm = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : parts.join(".");
        setRaw(norm);
        const n = norm === "" || norm === "." ? 0 : Number(norm);
        const num = Number.isNaN(n) ? 0 : n;
        last.current = num;
        onValue(num);
      }}
      style={{
        width: "100%",
        textAlign: "right",
        fontSize: 12,
        fontWeight: 600,
        padding: "6px 7px",
        border: `1px solid ${amber ? "#fcd34d" : "#e2e8f0"}`,
        borderRadius: 7,
        background: disabled ? "#f8fafc" : "#fff",
        color: "#0f172a",
      }}
    />
  );
}
function fmt2Raw(n: number): string {
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

// ── styles ──────────────────────────────────────────────────────────────────
const cardShell: CSSProperties = {
  background: "#fff",
  border: "1px solid #dfe3ea",
  borderRadius: 12,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  overflow: "hidden",
};
const badge = (bg: string): CSSProperties => ({
  width: 17,
  height: 17,
  borderRadius: "50%",
  background: bg,
  color: "#fff",
  fontSize: 10.5,
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "none",
});
const microLabel: CSSProperties = { fontSize: 10.5, color: "#94a3b8", fontWeight: 600 };
const stdInput = (border = "#e2e8f0"): CSSProperties => ({
  width: "100%",
  fontSize: 12,
  fontWeight: 600,
  padding: "7px 9px",
  border: `1px solid ${border}`,
  borderRadius: 8,
  background: "#fff",
  color: "#0f172a",
});
const stdSelect = (border = "#e2e8f0"): CSSProperties => ({
  width: "100%",
  fontSize: 12,
  fontWeight: 600,
  padding: "7px 6px",
  border: `1px solid ${border}`,
  borderRadius: 8,
  background: "#fff",
  color: "#0f172a",
});
const fieldCol: CSSProperties = { display: "flex", flexDirection: "column", gap: 3 };
const totLabel: CSSProperties = { fontSize: 10, color: "#94a3b8", fontWeight: 600 };
const ITEM_GRID = "20px 92px 1fr 46px 74px 80px";

// ── component ──────────────────────────────────────────────────────────────
export function RRDetailForm({ data }: { data: ReceiptReviewData }) {
  const exp = data.selectedExpense;
  if (!exp) {
    return (
      <div style={cardShell}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ textAlign: "center", color: "#94a3b8" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#64748b" }}>เลือกใบเสร็จเพื่อตรวจ</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>คลิกรายการจากคอลัมน์ซ้าย</div>
          </div>
        </div>
      </div>
    );
  }
  // key={exp.id} → remount + re-seed draft ใหม่ทุกครั้งที่สลับใบ (ไม่ต้องพึ่ง effect · money-safe)
  return <DetailBody key={exp.id} data={data} exp={exp} />;
}

function DetailBody({ data, exp }: { data: ReceiptReviewData; exp: RRSelectedExpense }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  // seed draft — mirror ExpenseReviewPane:363-388 เป๊ะ (ทุก field = expense.<x> ?? fallback)
  const [draft, setDraft] = useState<ExpenseDraft>(() => ({
    vendor: exp.vendor ?? "",
    vendorTaxId: exp.vendorTaxId ?? "",
    docDate: exp.docDate ?? "",
    categoryId: exp.categoryId ?? "",
    branchId: exp.branchId ?? "",
    paymentMethod: exp.paymentMethod ?? "",
    subtotal: exp.subtotal,
    vat: exp.vat,
    wht: exp.wht,
    total: exp.total,
    note: exp.note ?? "",
    title: exp.title ?? "",
    docType: exp.docType ?? "tax_invoice",
    vendorDocNumber: exp.vendorDocNumber ?? "",
    vendorAddress: exp.vendorAddress ?? "",
    vendorBranchCode: exp.vendorBranchCode ?? "",
    discount: exp.discount ?? 0,
    paymentStatus: exp.paymentStatus ?? "paid",
    claimantName: exp.claimantName ?? "",
    bankDetail: exp.bankDetail ?? "",
    isRecurring: exp.isRecurring ?? false,
    inputVatClaimable: exp.inputVatClaimable ?? null,
    inputVatBlockReason: exp.inputVatBlockReason ?? null,
    items: exp.items ?? [],
  }));

  function set<K extends keyof ExpenseDraft>(k: K, v: ExpenseDraft[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
    setErr(null);
  }
  // เงินก้อน (ยอดย่อย/ส่วนลด/VAT/หัก) → total เป็น DERIVED เสมอ = gross = subtotal − discount + vat
  // (ยึด convention ฝั่ง server: dashboard cashOut = Σtotal − Σwht · payout = billsGross − wht ·
  //  AP ตั้งหนี้เต็ม gross → เก็บ net จะจ่ายว/ตั้งหนี้ขาด). ทำให้ total ไม่ถูกแช่ →
  //  runRecheck (subtotal−discount+vat−wht≈total) สมดุลทันทีที่ wht=0 · confirm ไม่ deadlock.
  function setMoney(patch: Partial<Pick<ExpenseDraft, "subtotal" | "discount" | "vat" | "wht">>) {
    setDraft((d) => {
      const next = { ...d, ...patch };
      next.total = round2(next.subtotal - next.discount + next.vat);
      return next;
    });
    setErr(null);
  }
  function updateItem(i: number, patch: Partial<ExpenseItem>) {
    setDraft((d) => ({
      ...d,
      items: d.items.map((it, idx) => {
        if (idx !== i) return it;
        const merged = { ...it, ...patch };
        if (patch.qty != null || patch.unitPrice != null) {
          merged.amount = +(merged.qty * merged.unitPrice).toFixed(2);
        }
        return merged;
      }),
    }));
    setErr(null);
  }
  function addItem() {
    setDraft((d) => ({
      ...d,
      items: [...d.items, { description: "", qty: 1, unitPrice: 0, amount: 0, vatRate: null }],
    }));
    setErr(null);
  }

  // ── derived (reuse pane logic) ──
  const conf = exp.ocrConfidence ?? {};
  const findings = useMemo(() => runRecheck(draft), [draft]);
  const hasError = findings.some((f) => f.level === "error");
  const gate = useMemo(
    () =>
      expenseConfirmability({
        branchId: draft.branchId || null,
        categoryId: draft.categoryId || null,
      }),
    [draft.branchId, draft.categoryId],
  );
  const trState = trcloudState(exp.trcloudDocId);
  const isSent = trState === "sent";
  const isDraft = exp.status === "draft";
  const inActiveRequest = exp.payState === "requested";
  const locked =
    exp.status === "locked" ||
    exp.status === "void" ||
    trState === "sent" ||
    trState === "pending" ||
    inActiveRequest;

  const itemsSum = useMemo(
    () => draft.items.reduce((s, it) => s + (Number.isFinite(it.amount) ? it.amount : 0), 0),
    [draft.items],
  );
  // preview เท่านั้น — ยอดจริงคิด server-side ใน createPaymentRequest()
  const payoutPreview = draft.total - draft.wht;

  // ── writes (ทั้งหมดหลังปุ่ม · refresh หลังสำเร็จ) ──
  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setErr(null);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.ok) router.refresh();
        else setErr(res.error ?? "ทำรายการไม่สำเร็จ");
      } catch {
        setErr("เชื่อมต่อไม่สำเร็จ");
      }
    });
  }
  function doSave() {
    if (locked) return;
    run(() => saveExpense(exp.id, draft));
  }
  function doConfirm() {
    if (locked || !isDraft) return;
    // confirm = expense.confirm capability (server ปฏิเสธถ้าไม่มี) — ใช้ canEditClaimability
    // ซึ่งคำนวณจาก ledgerWebCanForRole(..., "expense.confirm") เป็น gate ฝั่ง UI ด้วย.
    if (!data.canEditClaimability) return;
    if (hasError) {
      setErr(findings.find((f) => f.level === "error")?.message ?? "ยอดเงินไม่ตรง");
      return;
    }
    if (!gate.ok) {
      setErr(confirmabilityMessage(gate.missing));
      return;
    }
    run(() => confirmExpense(exp.id, draft));
  }
  function doSend() {
    run(async () => {
      // ใบ locked → saveExpense ปฏิเสธ (แก้ไม่ได้) → ข้ามการเซฟ ส่งตรง
      if (exp.status === "locked") return sendExpenseToTrcloud(exp.id);
      // เซฟ draft ล่าสุดก่อนส่ง (กันส่งค่าเก่า — เหมือน onBeforeSend ของ pane)
      const s = await saveExpense(exp.id, draft);
      if (!s.ok) return s;
      return sendExpenseToTrcloud(exp.id);
    });
  }
  function doPayreq() {
    // server หา payee จากบิล/ประวัติผู้ขายเอง + คิดยอดโอนจริงเอง (client ส่งแค่ [id],{})
    run(() => createPaymentRequestAction([exp.id], {}));
  }
  function doToggleClaimable() {
    if (!data.canEditClaimability) return;
    const next = draft.inputVatClaimable === true ? false : true;
    run(async () => {
      const r = await overrideClaimability({ expenseId: exp.id, claimable: next });
      if (r.ok) set("inputVatClaimable", next);
      return r;
    });
  }

  // ── header status pill ──
  const pill = (() => {
    if (isSent) return { label: "ส่ง TRCloud แล้ว", fg: "#1e40af", bg: "#dbeafe" };
    if (exp.status === "void") return { label: "ยกเลิกแล้ว", fg: "#64748b", bg: "#f1f5f9" };
    if (exp.status === "locked") return { label: "ล็อกแล้ว", fg: "#1e40af", bg: "#dbeafe" };
    if (exp.status === "confirmed") return { label: "ยืนยันแล้ว", fg: "#166534", bg: "#ecfdf5" };
    return { label: "ร่าง · รอตรวจ", fg: "#b45309", bg: "#fffbeb" };
  })();

  // ── pipeline chips (สถานะจริงของใบ · ไม่ใช่ปุ่ม) ──
  const apDone = trcloudState(exp.trcloudApDocId) === "sent";
  const payDone = exp.payState === "requested" || exp.payState === "paid";
  const pipeline = [
    { label: "ยืนยันแล้ว", done: exp.status === "confirmed" || exp.status === "locked" },
    { label: "ส่ง TRCloud", done: isSent },
    { label: "สร้าง AP/PV", done: apDone },
    { label: "ตั้งขอโอน", done: payDone },
  ];

  // ── CTA state-machine (1 write ที่ปลอดภัยต่อการกด 1 ครั้ง) ──
  const canSendTrcloud = exp.status === "confirmed" || exp.status === "locked";
  const cta = (() => {
    if (isSent) {
      return { label: "ส่งแล้ว", bg: "#059669", fg: "#fff", shadow: "none", onClick: undefined, disabled: true, title: "ส่งเข้า TRCloud แล้ว" };
    }
    if (trState === "pending") {
      // มี push in-flight อยู่ (anti-double-push) — ห้ามส่งซ้ำ
      return { label: "กำลังส่ง…", bg: "#e2e8f0", fg: "#94a3b8", shadow: "none", onClick: undefined, disabled: true, title: "กำลังส่งเข้า TRCloud" };
    }
    if (isDraft) {
      const canConfirm = data.canEditClaimability; // = expense.confirm capability
      const ready = canConfirm && gate.ok && !hasError && !pending;
      return {
        label: "ยืนยัน",
        bg: ready ? "#2563eb" : "#e2e8f0",
        fg: ready ? "#fff" : "#94a3b8",
        shadow: ready ? "0 6px 16px rgba(37,99,235,.26)" : "none",
        onClick: ready ? doConfirm : undefined,
        disabled: !ready,
        title: !canConfirm
          ? "เฉพาะนักบัญชี/แอดมิน"
          : hasError
            ? findings.find((f) => f.level === "error")?.message
            : !gate.ok
              ? confirmabilityMessage(gate.missing)
              : undefined,
      };
    }
    if (canSendTrcloud) {
      // confirmed/locked แต่ยังไม่ส่ง (trState none/error) → ส่งเข้า TRCloud (re-send ปลอดภัย: dedup by ref)
      return {
        label: "ส่งเข้า TRCloud",
        bg: pending ? "#93c5fd" : "#2563eb",
        fg: "#fff",
        shadow: "0 6px 16px rgba(37,99,235,.26)",
        onClick: pending ? undefined : doSend,
        disabled: pending,
        title: undefined as string | undefined,
      };
    }
    // void / สถานะอื่น → ไม่มี action ที่ปลอดภัย
    return {
      label: exp.status === "void" ? "ยกเลิกแล้ว" : "—",
      bg: "#e2e8f0",
      fg: "#94a3b8",
      shadow: "none",
      onClick: undefined,
      disabled: true,
      title: undefined as string | undefined,
    };
  })();

  // ── ตั้งขอโอน eligibility (เฉพาะใบ confirmed/locked ที่ยังไม่มีคำขอ/ยังไม่จ่าย) ──
  const payEligible =
    data.payreqEnabled &&
    gate.ok &&
    canSendTrcloud &&
    exp.payState !== "requested" &&
    exp.payState !== "paid" &&
    !pending;
  const payBtn = payDone
    ? { fg: "#166534", bg: "#ecfdf5", border: "#bbf7d0" }
    : payEligible
      ? { fg: "#0f172a", bg: "#fff", border: "#e2e8f0" }
      : { fg: "#94a3b8", bg: "#f8fafc", border: "#e2e8f0" };

  // ── VAT banner (จากสถานะใบกำกับ + claimable) ──
  const claimableNow = draft.inputVatClaimable;
  const vatGreen = exp.completenessStatus === "green_full" || claimableNow === true;
  const buyerLine = exp.buyerNameSnapshot
    ? `หัวใบออกในนาม ${exp.buyerNameSnapshot}${exp.buyerTaxIdOnDoc ? ` · ${exp.buyerTaxIdOnDoc}` : ""}`
    : "ตรวจหัวใบผู้ซื้อก่อนขอคืนภาษีซื้อ";

  // pay method options — คง value เดิมของบิลไว้ถ้าไม่อยู่ในลิสต์ (กัน select ว่าง)
  const payMethods =
    draft.paymentMethod && !PAYMENT_METHODS.includes(draft.paymentMethod)
      ? [draft.paymentMethod, ...PAYMENT_METHODS]
      : PAYMENT_METHODS;

  // หมวดที่มีรหัสบัญชีแล้วแต่สูตร LL ยังไม่มีช่องรับ → ตก 5919999 แน่ตอนแปลงเป็น AP
  // ไม่ให้เลือกใหม่เลย (คงไว้ถ้าเป็นหมวดที่เลือกอยู่แล้ว) — เดียวกับ ExpenseReviewPane
  const activeCats = data.categories
    .filter(
      (c) =>
        (c.active && (!c.trcloudAccCode || llCSlotForGl(c.trcloudAccCode) !== null)) ||
        c.id === draft.categoryId,
    )
    .map((c) => ({ id: c.id, name: c.name }));

  return (
    <div style={cardShell}>
      {/* ── Header ── */}
      <div
        style={{
          flex: "none",
          padding: "9px 13px",
          borderBottom: "1px solid #eef1f5",
          display: "flex",
          alignItems: "center",
          gap: 9,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div className="rr-mono" style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2 }}>
            {draft.title.trim() || exp.docCode}
          </div>
          <div style={{ fontSize: 10.5, color: "#94a3b8" }}>
            ที่มา: {exp.source === "line" ? "LINE" : exp.source === "email" ? "อีเมล" : "เว็บ"}
            {exp.ocrModel ? ` · AI: ${exp.ocrModel}` : ""}
            {exp.createdAt ? ` · อัปโหลด ${shortDate(exp.createdAt)}` : ""}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div
          className="rr-hb"
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            color: "#475569",
            padding: "5px 10px",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
          }}
        >
          ออกเอกสาร ▾
        </div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: pill.fg,
            background: pill.bg,
            padding: "5px 10px",
            borderRadius: 999,
            whiteSpace: "nowrap",
          }}
        >
          {pill.label}
        </div>
      </div>

      {/* ── Scroll body ── (overscroll:contain → เลื่อนสุดแล้วไม่ลามไปเลื่อนคอลัมน์อื่น/ทั้งจอ) */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overscrollBehavior: "contain",
          padding: "11px 13px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {/* ═══ Card A · §1 + §2 ═══ */}
        <div style={{ flex: "none", border: "1px solid #e8ecf2", borderRadius: 11, padding: "9px 11px" }}>
          {/* §1 ลงบัญชี */}
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
            <div style={badge("#2563eb")}>1</div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>ลงบัญชี</div>
            <div style={{ fontSize: 10.5, color: "#94a3b8" }}>— 2 ช่องที่ต้องเลือกเอง · พิมพ์ค้นหาได้</div>
            <div style={{ flex: 1 }} />
            <div className="rr-ul" style={{ fontSize: 10.5, fontWeight: 600, color: "#2563eb", cursor: "pointer" }}>
              จำค่านี้ไว้ให้ผู้ขายรายนี้
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 10px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={microLabel}>ประเภทค่าใช้จ่าย</div>
                <ConfPill score={conf.suggested_category ?? conf.category} ai />
              </div>
              <SearchableSelect
                options={activeCats}
                value={draft.categoryId}
                onChange={(id) => set("categoryId", id)}
                placeholder="— เลือกหมวด —"
                disabled={locked}
                searchPlaceholder="ค้นหาหมวด…"
                label="ประเภทค่าใช้จ่าย"
                selectClassName="!h-auto !rounded-lg !border-[#93c5fd] !py-[7px] !px-[9px] !text-[12.5px] !font-semibold"
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={microLabel}>สาขา / ศูนย์ต้นทุน (ของเรา)</div>
              <SearchableSelect
                options={data.branches}
                value={draft.branchId}
                onChange={(id) => set("branchId", id)}
                placeholder="— ไม่ระบุ —"
                disabled={locked}
                searchPlaceholder="ค้นหาสาขา…"
                label="สาขา / ศูนย์ต้นทุน"
                selectClassName="!h-auto !rounded-lg !border-[#93c5fd] !py-[7px] !px-[9px] !text-[12.5px] !font-semibold"
              />
            </div>
          </div>

          {/* §2 ข้อมูลร้านค้า (dashed divider บนหัวข้อ) */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              margin: "9px 0 8px",
              paddingTop: 9,
              borderTop: "1px dashed #e8ecf2",
            }}
          >
            <div style={badge("#334155")}>2</div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>ข้อมูลร้านค้าและเอกสาร</div>
            <div style={{ flex: 1 }} />
            <div className="rr-ul" style={{ fontSize: 10.5, fontWeight: 600, color: "#2563eb", cursor: "pointer" }}>
              🕘 ดูประวัติผู้ขายรายนี้และราคาที่เคยซื้อ
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: "7px 10px" }}>
            <div style={fieldCol}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={microLabel}>ชื่อร้านค้า / ผู้รับเงิน</div>
                <ConfPill score={conf.vendor} />
              </div>
              <input
                value={draft.vendor}
                disabled={locked}
                onChange={(e) => set("vendor", e.target.value)}
                placeholder="ชื่อร้าน / บริษัท"
                style={stdInput()}
              />
            </div>
            <div style={fieldCol}>
              <div style={microLabel}>ประเภทเอกสาร</div>
              <select
                aria-label="ประเภทเอกสาร"
                value={draft.docType}
                disabled={locked}
                onChange={(e) => set("docType", e.target.value as ExpenseDocType)}
                style={stdSelect()}
              >
                {DOC_TYPES.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={fieldCol}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={microLabel}>เลขผู้เสียภาษี (13 หลัก)</div>
                <ConfPill score={conf.vendor_tax_id} />
              </div>
              <input
                className="rr-num"
                value={draft.vendorTaxId}
                disabled={locked}
                inputMode="numeric"
                onChange={(e) => set("vendorTaxId", e.target.value)}
                placeholder="0000000000000"
                style={stdInput()}
              />
            </div>
            <div style={fieldCol}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={microLabel}>วันที่ออกเอกสาร</div>
                <ConfPill score={conf.doc_date} />
              </div>
              <input
                type="date"
                aria-label="วันที่ออกเอกสาร"
                className="rr-num"
                value={draft.docDate}
                disabled={locked}
                onChange={(e) => set("docDate", e.target.value)}
                style={stdInput(conf.doc_date != null && conf.doc_date < 0.85 ? "#fcd34d" : "#e2e8f0")}
              />
            </div>
            <div style={fieldCol}>
              <div style={microLabel}>รหัสสาขาผู้ขาย</div>
              <input
                className="rr-num"
                value={draft.vendorBranchCode}
                disabled={locked}
                onChange={(e) => set("vendorBranchCode", e.target.value)}
                placeholder="00000"
                style={stdInput()}
              />
            </div>
            <div style={{ ...fieldCol, gridColumn: "span 2" }}>
              <div style={microLabel}>ที่อยู่ผู้ขาย</div>
              <input
                value={draft.vendorAddress}
                disabled={locked}
                onChange={(e) => set("vendorAddress", e.target.value)}
                placeholder="ที่อยู่ (ถ้ามี)"
                style={{ ...stdInput(), fontWeight: 400 }}
              />
            </div>
          </div>

          {/* payment sub-grid (dashed divider) — วิธีชำระ wired · อีก 3 visual-only */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "96px 1fr 1fr 104px",
              gap: "8px 10px",
              marginTop: 8,
              paddingTop: 8,
              borderTop: "1px dashed #e8ecf2",
            }}
          >
            <div style={fieldCol}>
              <div style={microLabel}>วิธีชำระ</div>
              <select
                aria-label="วิธีชำระ"
                value={draft.paymentMethod}
                disabled={locked}
                onChange={(e) => set("paymentMethod", e.target.value)}
                style={stdSelect()}
              >
                <option value="">— ไม่ระบุ —</option>
                {payMethods.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div style={fieldCol}>
              <div style={microLabel}>บัญชีจ่ายออก (ของเรา)</div>
              <select aria-label="บัญชีจ่ายออก" disabled={locked} defaultValue={PAY_FROM_HINTS[0]} style={stdSelect()}>
                {PAY_FROM_HINTS.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </div>
            <div style={fieldCol}>
              <div style={microLabel}>บัญชีรับโอน (ผู้ขาย)</div>
              <select aria-label="บัญชีรับโอน" disabled={locked} defaultValue={PAY_TO_HINTS[0]} style={stdSelect()}>
                {PAY_TO_HINTS.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </div>
            <div style={fieldCol}>
              <div style={microLabel}>กำหนดชำระ</div>
              <select aria-label="กำหนดชำระ" disabled={locked} defaultValue={DUE_HINTS[0]} style={stdSelect()}>
                {DUE_HINTS.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </div>
          </div>

          {/* VAT banner */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              marginTop: 8,
              padding: "6px 9px",
              background: vatGreen ? "#f2fbf5" : "#fffbeb",
              border: `1px solid ${vatGreen ? "#bbf7d0" : "#fde68a"}`,
              borderRadius: 9,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: vatGreen ? "#166534" : "#b45309", whiteSpace: "nowrap" }}>
              {vatGreen ? "✓ ใบกำกับเต็มรูป · ขอคืน VAT ได้" : "ยังขอคืน VAT ไม่ได้ · ตรวจใบกำกับ"}
            </div>
            <div
              style={{
                fontSize: 10.5,
                color: vatGreen ? "#15803d" : "#a16207",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {buyerLine}
            </div>
            <div style={{ flex: 1 }} />
            {data.canEditClaimability && (
              <div
                className="rr-ul"
                onClick={pending ? undefined : doToggleClaimable}
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: vatGreen ? "#166534" : "#b45309",
                  cursor: pending ? "default" : "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                เปลี่ยนสถานะภาษีซื้อ
              </div>
            )}
          </div>
        </div>

        {/* ═══ Card B · §3 รายการและยอดเงิน ═══ */}
        <div style={{ flex: "none", border: "1px solid #e8ecf2", borderRadius: 11, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 11px" }}>
            <div style={badge("#334155")}>3</div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>รายการและยอดเงิน</div>
            <div style={{ fontSize: 10.5, color: "#94a3b8" }}>
              {draft.items.length} รายการ · แก้ตัวเลข/ชื่อได้ทุกช่อง
            </div>
            <div style={{ flex: 1 }} />
            {!locked && (
              <div
                className="rr-ul"
                onClick={addItem}
                style={{ fontSize: 11, fontWeight: 600, color: "#2563eb", cursor: "pointer" }}
              >
                + เพิ่มรายการ
              </div>
            )}
          </div>

          {/* table head */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: ITEM_GRID,
              gap: "0 7px",
              padding: "5px 11px",
              background: "#f8fafc",
              borderTop: "1px solid #eef1f5",
              borderBottom: "1px solid #eef1f5",
              fontSize: 10,
              color: "#94a3b8",
              fontWeight: 600,
            }}
          >
            <div>#</div>
            <div>รหัส/SKU</div>
            <div>ชื่อรายการ</div>
            <div style={{ textAlign: "right" }}>จน.</div>
            <div style={{ textAlign: "right" }}>ราคา</div>
            <div style={{ textAlign: "right" }}>รวม</div>
          </div>

          {/* rows */}
          {draft.items.length === 0 ? (
            <div style={{ padding: "10px 11px", fontSize: 11.5, color: "#94a3b8" }}>
              ยังไม่มีรายการย่อย — กด “+ เพิ่มรายการ” ถ้าต้องแยกบรรทัด
            </div>
          ) : (
            draft.items.map((it, i) => (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: ITEM_GRID,
                  gap: "0 7px",
                  alignItems: "center",
                  padding: "5px 11px",
                  borderBottom: "1px solid #f4f6f9",
                }}
              >
                <div style={{ fontSize: 11, color: "#94a3b8" }}>{i + 1}</div>
                {/* รหัส/SKU — visual only (ไม่มีฟิลด์ใน ExpenseItem → ไม่ persist) */}
                <input
                  aria-label={`รหัส/SKU รายการ ${i + 1}`}
                  disabled={locked}
                  defaultValue=""
                  placeholder="SKU"
                  style={itemInput(11.5)}
                />
                <input
                  aria-label={`ชื่อรายการ ${i + 1}`}
                  value={it.description}
                  disabled={locked}
                  onChange={(e) => updateItem(i, { description: e.target.value })}
                  placeholder="ชื่อสินค้า/บริการ"
                  style={itemInput(12)}
                />
                <input
                  aria-label={`จำนวน รายการ ${i + 1}`}
                  className="rr-num"
                  inputMode="decimal"
                  value={it.qty}
                  disabled={locked}
                  onChange={(e) => updateItem(i, { qty: Number(e.target.value) || 0 })}
                  style={{ ...itemInput(12), textAlign: "right", padding: "5px 5px" }}
                />
                <input
                  aria-label={`ราคา รายการ ${i + 1}`}
                  className="rr-num"
                  inputMode="decimal"
                  value={it.unitPrice}
                  disabled={locked}
                  onChange={(e) => updateItem(i, { unitPrice: Number(e.target.value) || 0 })}
                  style={{ ...itemInput(12), textAlign: "right", padding: "5px 6px" }}
                />
                <div className="rr-num" style={{ fontSize: 12, textAlign: "right", fontWeight: 700 }}>
                  {fmt2(it.amount)}
                </div>
              </div>
            ))
          )}

          {/* totals grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 92px 92px 92px 92px 150px",
              gap: "0 9px",
              padding: "7px 11px",
              background: "#fbfcfe",
              alignItems: "end",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <input
                aria-label="หมายเหตุถึงฝ่ายบัญชี"
                value={draft.note}
                disabled={locked}
                onChange={(e) => set("note", e.target.value)}
                placeholder="หมายเหตุถึงฝ่ายบัญชี (ถ้ามี)"
                style={{
                  width: "100%",
                  fontSize: 12,
                  padding: "6px 8px",
                  border: "1px solid #e2e8f0",
                  borderRadius: 7,
                  background: "#fff",
                  color: "#0f172a",
                }}
              />
              <div style={{ fontSize: 10, color: "#94a3b8" }}>ช่องขอบเหลือง = AI คำนวณ/ไม่มั่นใจ</div>
              {/* sync affordance (mirror pane :1169) — ดึงผลรวมรายการมาเป็น "ยอดย่อย" ตามต้องการ */}
              {!locked && Math.abs(itemsSum - draft.subtotal) >= 1 && (
                <div
                  className="rr-ul rr-num"
                  onClick={() => setMoney({ subtotal: round2(itemsSum) })}
                  style={{ fontSize: 10.5, fontWeight: 600, color: "#2563eb", cursor: "pointer" }}
                >
                  ใช้ผลรวมรายการ (฿{fmt2(itemsSum)})
                </div>
              )}
            </div>
            {/* รวมรายการ = ยอดย่อยก่อนภาษี (subtotal) แก้ได้ · total เป็น derived (setMoney) */}
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={totLabel}>รวมรายการ</div>
              <MoneyCell value={draft.subtotal} disabled={locked} onValue={(v) => setMoney({ subtotal: v })} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={totLabel}>ส่วนลด</div>
              <MoneyCell value={draft.discount} disabled={locked} amber onValue={(v) => setMoney({ discount: v })} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={totLabel}>VAT 7%</div>
              <MoneyCell value={draft.vat} disabled={locked} amber onValue={(v) => setMoney({ vat: v })} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={totLabel}>หัก ณ ที่จ่าย</div>
              <MoneyCell value={draft.wht} disabled={locked} onValue={(v) => setMoney({ wht: v })} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingLeft: 9, borderLeft: "1px solid #e8ecf2" }}>
              <div style={{ ...totLabel, display: "flex", alignItems: "baseline", gap: 4 }}>
                <span>ยอดที่ต้องโอน</span>
                <span style={{ fontSize: 9, fontWeight: 500, color: "#cbd5e1" }}>(ประมาณ)</span>
              </div>
              <div className="rr-num" style={{ fontSize: 17, fontWeight: 700, textAlign: "right", lineHeight: 1.4 }}>
                {fmt2(payoutPreview)} ฿
              </div>
            </div>
          </div>
        </div>

        {/* recheck (warn/error) — money-safety feedback ทันที เหมือน pane */}
        {findings.length > 0 && (
          <div
            role={hasError ? "alert" : "status"}
            style={{
              flex: "none",
              border: `1px solid ${hasError ? "#fecaca" : "#fde68a"}`,
              background: hasError ? "#fef2f2" : "#fffbeb",
              color: hasError ? "#b91c1c" : "#b45309",
              borderRadius: 9,
              padding: "7px 11px",
              fontSize: 11,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 2 }}>⚠ ตรวจยอดเงิน</div>
            <ul className="rr-num" style={{ margin: 0, paddingLeft: 16 }}>
              {findings.map((f, i) => (
                <li key={i}>{f.message}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── Footer action bar ── */}
      <div
        style={{
          flex: "none",
          borderTop: "1px solid #eef1f5",
          padding: "8px 13px 9px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "#fff",
        }}
      >
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {pipeline.map((p, i) => (
              <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    color: p.done ? "#166534" : "#94a3b8",
                    background: p.done ? "#ecfdf5" : "#f8fafc",
                    border: `1px solid ${p.done ? "#bbf7d0" : "#e2e8f0"}`,
                    padding: "2px 7px",
                    borderRadius: 999,
                  }}
                >
                  {p.label}
                </div>
                {i < pipeline.length - 1 && <div style={{ fontSize: 9, color: "#cbd5e1" }}>→</div>}
              </div>
            ))}
          </div>
          <div
            style={{
              fontSize: 10.5,
              color: err ? "#b91c1c" : "#94a3b8",
              fontWeight: err ? 600 : 400,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {err
              ? err
              : locked
                ? isSent
                  ? "ส่งเข้า TRCloud แล้ว · แก้ไขไม่ได้"
                  : inActiveRequest
                    ? "อยู่ระหว่างคำขอโอน · แก้ไขไม่ได้"
                    : "รายการนี้ถูกล็อก/ยกเลิก · แก้ไขไม่ได้"
                : "ระบบไม่บันทึกอัตโนมัติ · เป็น “ร่าง” จนกว่าจะกดยืนยันเอง"}
          </div>
        </div>

        {/* พักไว้ = saveExpense */}
        <button
          type="button"
          className="rr-hb"
          disabled={locked || pending}
          onClick={doSave}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #e2e8f0",
            background: "#fff",
            color: "#475569",
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: "nowrap",
            opacity: locked || pending ? 0.5 : 1,
            cursor: locked || pending ? "default" : "pointer",
          }}
        >
          พักไว้
        </button>

        {/* ตั้งขอโอน = createPaymentRequestAction([id],{}) */}
        <button
          type="button"
          className="rr-bright"
          disabled={!payEligible}
          onClick={payEligible ? doPayreq : undefined}
          title={
            !data.payreqEnabled
              ? "ระบบขอโอนยังไม่เปิดใช้"
              : payDone
                ? "ตั้งขอโอนแล้ว"
                : !gate.ok
                  ? "ระบุสาขาและหมวดก่อน"
                  : isDraft
                    ? "ยืนยันใบก่อนจึงตั้งขอโอนได้"
                    : undefined
          }
          style={{
            padding: "10px 13px",
            borderRadius: 10,
            border: `1px solid ${payBtn.border}`,
            background: payBtn.bg,
            color: payBtn.fg,
            fontSize: 12,
            fontWeight: 700,
            whiteSpace: "nowrap",
            cursor: payEligible ? "pointer" : "default",
          }}
        >
          ตั้งขอโอน
        </button>

        {/* primary CTA — state-aware (1 write/คลิก) */}
        <button
          type="button"
          className="rr-bright6"
          disabled={cta.disabled}
          onClick={cta.onClick}
          title={cta.title}
          style={{
            padding: "10px 16px",
            borderRadius: 10,
            background: cta.bg,
            color: cta.fg,
            fontSize: 12.5,
            fontWeight: 700,
            whiteSpace: "nowrap",
            boxShadow: cta.shadow,
            border: "none",
            cursor: cta.disabled ? "default" : "pointer",
          }}
        >
          {pending ? "กำลังทำงาน…" : cta.label}
        </button>
      </div>
    </div>
  );
}

// item-row input/select styles (radius 6, border #e8ecf2)
function itemInput(fontSize: number): CSSProperties {
  return {
    width: "100%",
    fontSize,
    fontWeight: 600,
    padding: "5px 7px",
    border: "1px solid #e8ecf2",
    borderRadius: 6,
    background: "#fff",
    color: "#0f172a",
  };
}
