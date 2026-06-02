"use client";

// ExpenseReviewPane — ฝั่งขวาของหน้า "รายจ่าย" (multi-pane).
// แสดงรูปใบเสร็จ + ฟอร์มแก้ค่าที่ AI อ่านได้ + ความมั่นใจราย field + Recheck
// แล้วให้บัญชี "ยืนยัน" (draft → confirmed).  *** ห้าม auto-post ***
//
// Recheck (เบาๆ ฝั่ง client เพื่อ feedback ทันที — ฝั่ง server ตรวจซ้ำใน action):
//   - เลขภาษี 13 หลัก
//   - subtotal + vat - wht ≈ total (tolerance < 1)
//   - vat ≈ 7% ของ subtotal (sanity)
//
// Server actions มาจาก props (parent ฉีดจาก lib/ledger/actions หรือ local
// fallback — ดู NOTE[ledger-partition-B] ใน _kit/types.ts).

import { useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Save,
  Ban,
  Loader2,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { ReceiptThumb } from "./ReceiptThumb";
import { VoucherMenu } from "./VoucherMenu";
import { StatusBadge } from "./_kit/StatusBadge";
import { ConfidenceTag } from "./_kit/ConfidenceTag";
import { AmountInput } from "./_kit/AmountInput";
import type { ExpenseRow, CategoryOption, BranchOption } from "./_kit/types";

export type ExpenseDraft = {
  vendor: string;
  vendorTaxId: string;
  docDate: string;
  categoryId: string;
  branchId: string;
  paymentMethod: string;
  subtotal: number;
  vat: number;
  wht: number;
  total: number;
  note: string;
};

export type RecheckFinding = {
  field: string;
  level: "warn" | "error";
  message: string;
};

/** Action result contract — keep loose so partition B can satisfy it. */
export type LedgerActionResult = { ok: boolean; error?: string };

export type SaveExpenseAction = (
  id: string,
  patch: ExpenseDraft,
) => Promise<LedgerActionResult>;
export type ConfirmExpenseAction = (
  id: string,
  patch: ExpenseDraft,
) => Promise<LedgerActionResult>;
export type VoidExpenseAction = (id: string) => Promise<LedgerActionResult>;

const PAYMENT_METHODS = [
  "เงินสด",
  "โอน",
  "บัตรเครดิต",
  "เช็ค",
  "อื่นๆ",
];

// Pure validators — also used (re-implemented) server-side in recheck.ts.
export function runRecheck(d: ExpenseDraft): RecheckFinding[] {
  const out: RecheckFinding[] = [];
  if (d.vendorTaxId && !/^\d{13}$/.test(d.vendorTaxId.replace(/\D/g, ""))) {
    out.push({
      field: "vendorTaxId",
      level: "warn",
      message: "เลขภาษีควรเป็น 13 หลัก",
    });
  }
  const computed = d.subtotal + d.vat - d.wht;
  if (d.total > 0 && Math.abs(computed - d.total) >= 1) {
    out.push({
      field: "total",
      level: "error",
      message: `ยอดรวมไม่ตรง: ยอดย่อย ${d.subtotal.toLocaleString()} + VAT ${d.vat.toLocaleString()} − หัก ${d.wht.toLocaleString()} = ${computed.toLocaleString()} ≠ ${d.total.toLocaleString()}`,
    });
  }
  if (d.subtotal > 0 && d.vat > 0) {
    const ratio = d.vat / d.subtotal;
    if (Math.abs(ratio - 0.07) > 0.02) {
      out.push({
        field: "vat",
        level: "warn",
        message: `VAT ${(ratio * 100).toFixed(1)}% ผิดปกติ (ปกติ 7%)`,
      });
    }
  }
  return out;
}

function FieldLabel({
  children,
  confidence,
}: {
  children: React.ReactNode;
  confidence?: number | null;
}) {
  return (
    <div className="mb-1 flex items-center gap-1.5">
      <label className="text-xs font-semibold text-zinc-600">{children}</label>
      <ConfidenceTag score={confidence} />
    </div>
  );
}

export function ExpenseReviewPane({
  expense,
  categories,
  branches,
  onSave,
  onConfirm,
  onVoid,
  readOnly = false,
}: {
  expense: ExpenseRow;
  categories: CategoryOption[];
  branches: BranchOption[];
  onSave: SaveExpenseAction;
  onConfirm: ConfirmExpenseAction;
  onVoid: VoidExpenseAction;
  /** locked/void → ดูอย่างเดียว */
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState<ExpenseDraft>({
    vendor: expense.vendor ?? "",
    vendorTaxId: expense.vendorTaxId ?? "",
    docDate: expense.docDate ?? "",
    categoryId: expense.categoryId ?? "",
    branchId: expense.branchId ?? "",
    paymentMethod: expense.paymentMethod ?? "",
    subtotal: expense.subtotal,
    vat: expense.vat,
    wht: expense.wht,
    total: expense.total,
    note: expense.note ?? "",
  });
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  const conf = useMemo(() => expense.ocrConfidence ?? {}, [expense.ocrConfidence]);
  const findings = useMemo(() => runRecheck(draft), [draft]);
  const hasError = findings.some((f) => f.level === "error");
  const locked = readOnly || expense.status === "locked" || expense.status === "void";

  // Overall AI confidence = mean of per-field scores (null if AI didn't read it).
  const overallConf = useMemo(() => {
    const vals = Object.values(conf).filter(
      (v): v is number => typeof v === "number" && !Number.isNaN(v),
    );
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [conf]);

  function set<K extends keyof ExpenseDraft>(k: K, v: ExpenseDraft[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
    setMsg(null);
  }

  function handle(
    action: SaveExpenseAction | ConfirmExpenseAction,
    successText: string,
  ) {
    setMsg(null);
    startTransition(async () => {
      const res = await action(expense.id, draft);
      setMsg(
        res.ok
          ? { kind: "ok", text: successText }
          : { kind: "err", text: res.error ?? "บันทึกไม่สำเร็จ" },
      );
    });
  }

  function handleVoid() {
    if (!confirm("ยกเลิกใบนี้? จะเปลี่ยนสถานะเป็น 'ยกเลิก'")) return;
    setMsg(null);
    startTransition(async () => {
      const res = await onVoid(expense.id);
      setMsg(
        res.ok
          ? { kind: "ok", text: "ยกเลิกแล้ว" }
          : { kind: "err", text: res.error ?? "ยกเลิกไม่สำเร็จ" },
      );
    });
  }

  const inputCls =
    "h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)] disabled:bg-zinc-50 disabled:text-zinc-500";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-mono text-lg font-bold tracking-tight">
            {expense.docCode}
          </div>
          <div className="text-xs text-zinc-500">
            ที่มา:{" "}
            {expense.source === "line"
              ? "LINE"
              : expense.source === "email"
                ? "อีเมล"
                : "เว็บ"}
            {expense.ocrModel ? ` · AI: ${expense.ocrModel}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* ออกเอกสาร PV/JV/PCV/ใบแทนใบเสร็จ — เปิดเอกสารพิมพ์ใน tab ใหม่.
              เปิดได้เฉพาะรายการที่ "ยืนยันแล้ว/ปิดงวด" (ร่าง/ยกเลิก ออกไม่ได้). */}
          <VoucherMenu
            expenseId={expense.id}
            companyId={expense.companyId}
            vendorTaxId={expense.vendorTaxId}
            disabled={expense.status !== "confirmed" && expense.status !== "locked"}
          />
          <StatusBadge status={expense.status} />
        </div>
      </div>

      {/* AI confidence / needs-review banner — บัญชีเห็นทันทีว่า AI มั่นใจแค่ไหน */}
      {expense.status === "draft" && (overallConf != null || expense.needsReview) && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm",
            expense.needsReview || (overallConf != null && overallConf < 0.6)
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : overallConf != null && overallConf < 0.85
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-800",
          )}
        >
          <Sparkles className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            {expense.needsReview
              ? "AI ไม่มั่นใจบางช่อง — โปรดตรวจก่อนยืนยัน"
              : overallConf != null && overallConf >= 0.85
                ? "AI อ่านได้ครบ — ตรวจแล้วกดยืนยันได้เลย"
                : "AI อ่านได้บางส่วน — ตรวจช่องที่มีสีเหลือง/แดง"}
          </span>
          {overallConf != null && (
            <ConfidenceTag score={overallConf} showLabel className="shrink-0" />
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
        {/* รูปใบเสร็จ (sticky บนจอใหญ่ — เลื่อนฟอร์มแล้วรูปยังอยู่) */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <ReceiptThumb
            thumbUrl={expense.thumbUrl}
            originalUrl={expense.originalUrl}
            alt={`ใบเสร็จ ${expense.docCode}`}
          />
        </div>

        {/* ฟอร์มแก้ */}
        <div className="space-y-3">
          <div>
            <FieldLabel confidence={conf.vendor}>ผู้ขาย / ร้านค้า</FieldLabel>
            <input
              className={inputCls}
              value={draft.vendor}
              disabled={locked}
              onChange={(e) => set("vendor", e.target.value)}
              placeholder="ชื่อร้าน / บริษัท"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel confidence={conf.vendor_tax_id ?? conf.vendorTaxId}>
                เลขภาษี 13 หลัก
              </FieldLabel>
              <input
                className={inputCls}
                value={draft.vendorTaxId}
                disabled={locked}
                inputMode="numeric"
                onChange={(e) => set("vendorTaxId", e.target.value)}
                placeholder="0000000000000"
              />
            </div>
            <div>
              <FieldLabel confidence={conf.doc_date ?? conf.docDate}>
                วันที่บนเอกสาร
              </FieldLabel>
              <input
                type="date"
                className={inputCls}
                value={draft.docDate}
                disabled={locked}
                onChange={(e) => set("docDate", e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel confidence={conf.suggested_category ?? conf.category}>
                หมวด
              </FieldLabel>
              <select
                className={inputCls}
                value={draft.categoryId}
                disabled={locked}
                onChange={(e) => set("categoryId", e.target.value)}
              >
                <option value="">— เลือกหมวด —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>สาขา</FieldLabel>
              <select
                className={inputCls}
                value={draft.branchId}
                disabled={locked}
                onChange={(e) => set("branchId", e.target.value)}
              >
                <option value="">— ไม่ระบุ —</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} · {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* ยอดเงิน */}
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-zinc-50 p-3">
            <div>
              <FieldLabel confidence={conf.subtotal}>ยอดย่อย</FieldLabel>
              <AmountInput
                value={draft.subtotal}
                disabled={locked}
                ariaLabel="ยอดย่อย"
                onValueChange={(v) => set("subtotal", v)}
              />
            </div>
            <div>
              <FieldLabel confidence={conf.vat}>VAT</FieldLabel>
              <AmountInput
                value={draft.vat}
                disabled={locked}
                ariaLabel="VAT"
                onValueChange={(v) => set("vat", v)}
              />
            </div>
            <div>
              <FieldLabel>หัก ณ ที่จ่าย</FieldLabel>
              <AmountInput
                value={draft.wht}
                disabled={locked}
                ariaLabel="หัก ณ ที่จ่าย"
                onValueChange={(v) => set("wht", v)}
              />
            </div>
            <div>
              <FieldLabel confidence={conf.total}>ยอดรวม</FieldLabel>
              <AmountInput
                value={draft.total}
                disabled={locked}
                ariaLabel="ยอดรวม"
                onValueChange={(v) => set("total", v)}
                className="border-zinc-300 font-semibold"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel confidence={conf.payment_method ?? conf.paymentMethod}>
                วิธีชำระ
              </FieldLabel>
              <select
                className={inputCls}
                value={draft.paymentMethod}
                disabled={locked}
                onChange={(e) => set("paymentMethod", e.target.value)}
              >
                <option value="">— ไม่ระบุ —</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>หมายเหตุ</FieldLabel>
              <input
                className={inputCls}
                value={draft.note}
                disabled={locked}
                onChange={(e) => set("note", e.target.value)}
                placeholder="โน้ตเพิ่มเติม"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Recheck */}
      {findings.length > 0 && (
        <div
          role={hasError ? "alert" : "status"}
          aria-live={hasError ? "assertive" : "polite"}
          className={cn(
            "space-y-1 rounded-xl border p-3 text-sm",
            hasError
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : "border-amber-200 bg-amber-50 text-amber-800",
          )}
        >
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="size-4" aria-hidden />
            ตรวจยอด (Recheck)
          </div>
          <ul className="ml-5 list-disc space-y-0.5">
            {findings.map((f, i) => (
              <li key={i}>{f.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ผลลัพธ์การบันทึก */}
      {msg && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm",
            msg.kind === "ok"
              ? "bg-emerald-50 text-emerald-800"
              : "bg-rose-50 text-rose-800",
          )}
        >
          {msg.kind === "ok" ? (
            <CheckCircle2 className="size-4" aria-hidden />
          ) : (
            <AlertTriangle className="size-4" aria-hidden />
          )}
          {msg.text}
        </div>
      )}

      {/* Actions — ห้าม auto-post: ต้องกดยืนยันเอง.
          Sticky bottom bar so the confirm button is always reachable on phones. */}
      {!locked && (
        <div className="sticky bottom-0 -mx-4 border-t border-zinc-100 bg-white/95 px-4 pb-1 pt-3 backdrop-blur sm:-mx-6 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={pending || hasError}
              onClick={() => handle(onConfirm, "ยืนยันแล้ว · บันทึกเป็น 'ยืนยันแล้ว'")}
              title={hasError ? "แก้ยอดที่ไม่ตรงก่อนยืนยัน" : undefined}
              className="flex-1 sm:flex-none"
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <CheckCircle2 className="size-4" aria-hidden />
              )}
              ยืนยัน
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => handle(onSave, "บันทึกร่างแล้ว")}
            >
              <Save className="size-4" aria-hidden />
              บันทึกร่าง
            </Button>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={handleVoid}
              className="ml-auto text-rose-600 hover:bg-rose-50"
            >
              <Ban className="size-4" aria-hidden />
              ยกเลิก
            </Button>
          </div>
          <p className="mt-2 flex items-center gap-1 text-[11px] text-zinc-400">
            <ShieldCheck className="size-3.5" aria-hidden />
            {hasError
              ? "ยอดไม่ตรง — แก้ให้ถูกก่อนจึงจะกด “ยืนยัน” ได้"
              : "ระบบไม่บันทึกอัตโนมัติ — รายการเป็น “ร่าง” จนกว่าจะกดยืนยันเอง"}
          </p>
        </div>
      )}
    </div>
  );
}
