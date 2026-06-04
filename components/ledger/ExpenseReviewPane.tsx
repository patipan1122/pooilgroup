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
  Plus,
  Trash2,
  FileText,
  Wallet,
  StickyNote,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { ReceiptThumb } from "./ReceiptThumb";
import { VoucherMenu } from "./VoucherMenu";
import { StatusBadge } from "./_kit/StatusBadge";
import { ConfidenceTag } from "./_kit/ConfidenceTag";
import { AmountInput } from "./_kit/AmountInput";
import type { ExpenseRow, CategoryOption, BranchOption } from "./_kit/types";
import type { ExpenseItem, ExpenseDocType, PaymentStatus } from "@/lib/ledger/types";

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
  // — Bainy-parity fields —
  docType: ExpenseDocType;
  vendorDocNumber: string;
  vendorAddress: string;
  vendorBranchCode: string;
  discount: number;
  paymentStatus: PaymentStatus;
  claimantName: string;
  bankDetail: string;
  isRecurring: boolean;
  items: ExpenseItem[];
};

const DOC_TYPES: { value: ExpenseDocType; label: string }[] = [
  { value: "tax_invoice", label: "ใบกำกับภาษี" },
  { value: "receipt", label: "ใบเสร็จรับเงิน" },
  { value: "cash_bill", label: "บิลเงินสด" },
  { value: "delivery_note", label: "ใบส่งของ" },
  { value: "other", label: "อื่น ๆ" },
];

const PAYMENT_STATUSES: { value: PaymentStatus; label: string }[] = [
  { value: "paid", label: "จ่ายครบแล้ว" },
  { value: "unpaid", label: "ยังไม่จ่าย" },
  { value: "partial", label: "จ่ายบางส่วน" },
];

/** Section title chip — mirrors Bainy's numbered sections (1·2·3·4). */
function SectionTitle({ n, icon, children }: { n: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="flex size-6 items-center justify-center rounded-full bg-[var(--color-brand-600,#2563EB)] text-xs font-bold text-white">
        {n}
      </span>
      <span className="text-zinc-500">{icon}</span>
      <h3 className="text-sm font-bold text-zinc-800">{children}</h3>
    </div>
  );
}

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
    docType: expense.docType ?? "tax_invoice",
    vendorDocNumber: expense.vendorDocNumber ?? "",
    vendorAddress: expense.vendorAddress ?? "",
    vendorBranchCode: expense.vendorBranchCode ?? "",
    discount: expense.discount ?? 0,
    paymentStatus: expense.paymentStatus ?? "paid",
    claimantName: expense.claimantName ?? "",
    bankDetail: expense.bankDetail ?? "",
    isRecurring: expense.isRecurring ?? false,
    items: expense.items ?? [],
  });
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );
  // Drive sync (manual "ส่งเข้า Google Drive") — separate from the save/confirm tx.
  const [driveUrl, setDriveUrl] = useState<string | null>(expense.driveWebUrl ?? null);
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveErr, setDriveErr] = useState<string | null>(null);
  async function syncDrive() {
    setDriveBusy(true);
    setDriveErr(null);
    try {
      const res = await fetch("/api/ledger/drive/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: expense.id, companyId: expense.companyId }),
      });
      const j = (await res.json()) as { ok: boolean; driveWebUrl?: string; notConfigured?: boolean; error?: string };
      if (j.ok && j.driveWebUrl) setDriveUrl(j.driveWebUrl);
      else setDriveErr(j.notConfigured ? "ยังไม่ได้ตั้งค่า Google Drive (แอดมินตั้งใน Vercel)" : (j.error ?? "ส่งไม่สำเร็จ"));
    } catch {
      setDriveErr("เชื่อมต่อไม่สำเร็จ");
    } finally {
      setDriveBusy(false);
    }
  }

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

  // ── line items (แยกรายการ) ──
  function addItem() {
    set("items", [...draft.items, { description: "", qty: 1, unitPrice: 0, amount: 0, vatRate: null }]);
  }
  function updateItem(i: number, patch: Partial<ExpenseItem>) {
    const next = draft.items.map((it, idx) => {
      if (idx !== i) return it;
      const merged = { ...it, ...patch };
      // qty × unitPrice → amount (unless amount was the field edited directly)
      if (patch.qty != null || patch.unitPrice != null) {
        merged.amount = +(merged.qty * merged.unitPrice).toFixed(2);
      }
      return merged;
    });
    set("items", next);
  }
  function removeItem(i: number) {
    set("items", draft.items.filter((_, idx) => idx !== i));
  }
  const itemsSum = useMemo(
    () => draft.items.reduce((s, it) => s + (Number.isFinite(it.amount) ? it.amount : 0), 0),
    [draft.items],
  );

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

        {/* ฟอร์มแก้ — 4 ส่วนแบบ Bainy */}
        <div className="space-y-5">
          {/* 1 · ข้อมูลร้านค้า & เอกสาร */}
          <section className="space-y-3 rounded-2xl border border-zinc-100 p-3">
            <SectionTitle n={1} icon={<FileText className="size-4" aria-hidden />}>
              ข้อมูลร้านค้า & เอกสาร
            </SectionTitle>
            <div>
              <FieldLabel confidence={conf.vendor}>ชื่อร้านค้า / ผู้รับเงิน</FieldLabel>
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
                <FieldLabel>ประเภทเอกสาร</FieldLabel>
                <select
                  className={inputCls}
                  value={draft.docType}
                  disabled={locked}
                  onChange={(e) => set("docType", e.target.value as ExpenseDocType)}
                >
                  {DOC_TYPES.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>เลขที่เอกสาร (ของร้าน)</FieldLabel>
                <input
                  className={inputCls}
                  value={draft.vendorDocNumber}
                  disabled={locked}
                  onChange={(e) => set("vendorDocNumber", e.target.value)}
                  placeholder="เช่น 6906-BR109-00129"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel confidence={conf.vendor_tax_id ?? conf.vendorTaxId}>
                  เลขผู้เสียภาษี (13 หลัก)
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
                  วันที่ออกเอกสาร
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
            <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
              <div>
                <FieldLabel>ที่อยู่ผู้ขาย</FieldLabel>
                <input
                  className={inputCls}
                  value={draft.vendorAddress}
                  disabled={locked}
                  onChange={(e) => set("vendorAddress", e.target.value)}
                  placeholder="ที่อยู่ (ถ้ามี)"
                />
              </div>
              <div>
                <FieldLabel>รหัสสาขา</FieldLabel>
                <input
                  className={inputCls}
                  value={draft.vendorBranchCode}
                  disabled={locked}
                  onChange={(e) => set("vendorBranchCode", e.target.value)}
                  placeholder="00000"
                />
              </div>
            </div>
          </section>

          {/* 2 · รายการ & ยอดเงิน */}
          <section className="space-y-3 rounded-2xl border border-zinc-100 p-3">
            <SectionTitle n={2} icon={<Wallet className="size-4" aria-hidden />}>
              รายการ & ยอดเงิน
            </SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel confidence={conf.suggested_category ?? conf.category}>
                  ประเภทค่าใช้จ่าย
                </FieldLabel>
                <select
                  className={inputCls}
                  value={draft.categoryId}
                  disabled={locked}
                  onChange={(e) => set("categoryId", e.target.value)}
                >
                  <option value="">— เลือกหมวด —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>สาขา (ของเรา)</FieldLabel>
                <select
                  className={inputCls}
                  value={draft.branchId}
                  disabled={locked}
                  onChange={(e) => set("branchId", e.target.value)}
                >
                  <option value="">— ไม่ระบุ —</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.code} · {b.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* แยกรายการ — line items */}
            <div className="rounded-xl border border-zinc-100 bg-zinc-50/60 p-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-600">
                  รายการสินค้า / บริการ {draft.items.length > 0 ? `(${draft.items.length})` : ""}
                </span>
                {!locked && (
                  <button
                    type="button"
                    onClick={addItem}
                    className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-xs font-medium text-[var(--color-brand-600,#2563EB)] ring-1 ring-zinc-200 hover:bg-zinc-50"
                  >
                    <Plus className="size-3.5" aria-hidden /> เพิ่มรายการ
                  </button>
                )}
              </div>
              {draft.items.length === 0 ? (
                <p className="px-1 py-2 text-xs text-zinc-400">ยังไม่มีรายการย่อย — เพิ่มได้ถ้าต้องการแยกบรรทัด</p>
              ) : (
                <div className="space-y-1.5">
                  {draft.items.map((it, i) => (
                    <div key={i} className="grid grid-cols-[minmax(0,1fr)_56px_80px_88px_28px] items-center gap-1.5">
                      <input
                        className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs outline-none focus:ring-2 focus:ring-[var(--color-brand-200)] disabled:bg-zinc-100"
                        value={it.description}
                        disabled={locked}
                        onChange={(e) => updateItem(i, { description: e.target.value })}
                        placeholder="ชื่อสินค้า/บริการ"
                      />
                      <input
                        className="h-8 rounded-md border border-zinc-200 bg-white px-1.5 text-right text-xs outline-none focus:ring-2 focus:ring-[var(--color-brand-200)] disabled:bg-zinc-100"
                        value={it.qty}
                        disabled={locked}
                        inputMode="decimal"
                        onChange={(e) => updateItem(i, { qty: Number(e.target.value) || 0 })}
                        aria-label="จำนวน"
                      />
                      <input
                        className="h-8 rounded-md border border-zinc-200 bg-white px-1.5 text-right text-xs outline-none focus:ring-2 focus:ring-[var(--color-brand-200)] disabled:bg-zinc-100"
                        value={it.unitPrice}
                        disabled={locked}
                        inputMode="decimal"
                        onChange={(e) => updateItem(i, { unitPrice: Number(e.target.value) || 0 })}
                        aria-label="ราคาต่อหน่วย"
                      />
                      <input
                        className="h-8 rounded-md border border-zinc-200 bg-white px-1.5 text-right text-xs font-medium outline-none focus:ring-2 focus:ring-[var(--color-brand-200)] disabled:bg-zinc-100"
                        value={it.amount}
                        disabled={locked}
                        inputMode="decimal"
                        onChange={(e) => updateItem(i, { amount: Number(e.target.value) || 0 })}
                        aria-label="ยอดรวมรายการ"
                      />
                      {!locked && (
                        <button
                          type="button"
                          onClick={() => removeItem(i)}
                          className="flex size-7 items-center justify-center rounded-md text-rose-500 hover:bg-rose-50"
                          aria-label="ลบรายการ"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      )}
                    </div>
                  ))}
                  {!locked && Math.abs(itemsSum - draft.subtotal) >= 1 && (
                    <button
                      type="button"
                      onClick={() => set("subtotal", +itemsSum.toFixed(2))}
                      className="mt-1 text-[11px] font-medium text-[var(--color-brand-600,#2563EB)] hover:underline"
                    >
                      ผลรวมรายการ = {itemsSum.toLocaleString()} — กดเติมเป็นยอดย่อย
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* ยอดเงิน */}
            <div className="grid grid-cols-2 gap-3 rounded-xl bg-zinc-50 p-3 sm:grid-cols-3">
              <div>
                <FieldLabel confidence={conf.subtotal}>ยอดก่อนภาษี (Net)</FieldLabel>
                <AmountInput value={draft.subtotal} disabled={locked} ariaLabel="ยอดย่อย" onValueChange={(v) => set("subtotal", v)} />
              </div>
              <div>
                <FieldLabel>ส่วนลด</FieldLabel>
                <AmountInput value={draft.discount} disabled={locked} ariaLabel="ส่วนลด" onValueChange={(v) => set("discount", v)} />
              </div>
              <div>
                <FieldLabel confidence={conf.vat}>VAT 7%</FieldLabel>
                <AmountInput value={draft.vat} disabled={locked} ariaLabel="VAT" onValueChange={(v) => set("vat", v)} />
              </div>
              <div>
                <FieldLabel>หัก ณ ที่จ่าย</FieldLabel>
                <AmountInput value={draft.wht} disabled={locked} ariaLabel="หัก ณ ที่จ่าย" onValueChange={(v) => set("wht", v)} />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <FieldLabel confidence={conf.total}>ยอดรวมสุทธิ</FieldLabel>
                <AmountInput value={draft.total} disabled={locked} ariaLabel="ยอดรวม" onValueChange={(v) => set("total", v)} className="border-zinc-300 font-semibold" />
              </div>
            </div>
          </section>

          {/* 3 · การชำระเงิน & ผู้เบิก */}
          <section className="space-y-3 rounded-2xl border border-zinc-100 p-3">
            <SectionTitle n={3} icon={<Wallet className="size-4" aria-hidden />}>
              การชำระเงิน & ผู้เบิก
            </SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>ชื่อผู้เบิก</FieldLabel>
                <input
                  className={inputCls}
                  value={draft.claimantName}
                  disabled={locked}
                  onChange={(e) => set("claimantName", e.target.value)}
                  placeholder="ใครเป็นคนจ่าย/เบิก"
                />
              </div>
              <div>
                <FieldLabel>สถานะการชำระเงิน</FieldLabel>
                <select
                  className={inputCls}
                  value={draft.paymentStatus}
                  disabled={locked}
                  onChange={(e) => set("paymentStatus", e.target.value as PaymentStatus)}
                >
                  {PAYMENT_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel confidence={conf.payment_method ?? conf.paymentMethod}>วิธีชำระเงิน</FieldLabel>
                <select
                  className={inputCls}
                  value={draft.paymentMethod}
                  disabled={locked}
                  onChange={(e) => set("paymentMethod", e.target.value)}
                >
                  <option value="">— ไม่ระบุ —</option>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>ธนาคาร / รายละเอียด</FieldLabel>
                <input
                  className={inputCls}
                  value={draft.bankDetail}
                  disabled={locked}
                  onChange={(e) => set("bankDetail", e.target.value)}
                  placeholder="เช่น KBank โอน"
                />
              </div>
            </div>
            <label className={cn("flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-2", locked && "opacity-60")}>
              <span className="text-sm">
                <span className="font-medium text-zinc-700">ตั้งเป็นรายจ่ายประจำ</span>
                <span className="block text-[11px] text-zinc-400">แสดงบนแดชบอร์ดตามวันที่กำหนด</span>
              </span>
              <input
                type="checkbox"
                checked={draft.isRecurring}
                disabled={locked}
                onChange={(e) => set("isRecurring", e.target.checked)}
                className="size-5 accent-[var(--color-brand-600,#2563EB)]"
              />
            </label>
          </section>

          {/* 4 · หมายเหตุ & หลักฐาน */}
          <section className="space-y-3 rounded-2xl border border-zinc-100 p-3">
            <SectionTitle n={4} icon={<StickyNote className="size-4" aria-hidden />}>
              หมายเหตุ & หลักฐาน
            </SectionTitle>
            <div>
              <FieldLabel>หมายเหตุ</FieldLabel>
              <textarea
                className={cn(inputCls, "h-auto min-h-[60px] py-2")}
                value={draft.note}
                disabled={locked}
                onChange={(e) => set("note", e.target.value)}
                placeholder="ระบุเหตุผลหรือวัตถุประสงค์ของค่าใช้จ่ายนี้…"
                rows={2}
              />
            </div>
            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-zinc-600">หลักฐานแนบ & ต้นฉบับ</span>
              {driveUrl ? (
                <a href={driveUrl} target="_blank" rel="noreferrer"
                   className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100">
                  <ExternalLink className="size-3.5" aria-hidden /> เปิดต้นฉบับใน Google Drive (แชร์ให้สำนักงานบัญชีได้)
                </a>
              ) : (expense.thumbUrl || expense.originalUrl) ? (
                <button
                  type="button"
                  onClick={syncDrive}
                  disabled={driveBusy}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                >
                  {driveBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ExternalLink className="size-3.5 text-zinc-400" aria-hidden />}
                  ส่งต้นฉบับเข้า Google Drive (เดือน/สาขา/หมวด)
                </button>
              ) : null}
              {driveErr && <p className="text-[11px] text-amber-600">{driveErr}</p>}
              {(expense.attachments ?? []).map((a, i) => (
                <a key={i} href={a.url} target="_blank" rel="noreferrer"
                   className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50">
                  <FileText className="size-3.5 text-zinc-400" aria-hidden />
                  {a.kind === "po" ? "ไฟล์ PO / ใบสั่งซื้อ" : "หลักฐานเพิ่มเติม"}{a.name ? ` · ${a.name}` : ""}
                </a>
              ))}
            </div>
          </section>
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
