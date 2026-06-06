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

import { useEffect, useMemo, useState, useTransition } from "react";
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
  ReceiptText,
  ChevronDown,
  Building2,
  ListTree,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import {
  expenseConfirmability,
  confirmabilityMessage,
} from "@/lib/ledger/confirmability";
import { ReceiptThumb } from "./ReceiptThumb";
import { VoucherMenu } from "./VoucherMenu";
import { SendToTrcloudButton } from "./SendToTrcloudButton";
import { AttachReplacementButton } from "./AttachReplacementButton";
import type { AttachReplacementAction } from "./AttachReplacementButton";
import { StatusBadge } from "./_kit/StatusBadge";
import { ConfidenceTag } from "./_kit/ConfidenceTag";
import { missingLabel } from "./_kit/CompletenessDot";
import { DocTag, PaymentTag } from "./_kit/StatusTags";
import { AmountInput } from "./_kit/AmountInput";
import type { ExpenseRow, CategoryOption, BranchOption } from "./_kit/types";
import type {
  ExpenseItem,
  ExpenseDocType,
  PaymentStatus,
  CompletenessStatus,
  BuyerMatchStatus,
  InputVatBlockReason,
} from "@/lib/ledger/types";

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
  // — Input-VAT claimability (ภาษีซื้อ) — นักบัญชีปรับ "ขอคืนได้?" + เหตุผล —
  inputVatClaimable: boolean | null;
  inputVatBlockReason: InputVatBlockReason | null;
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
/** Accountant override of "ขอคืนได้?" + เหตุผล — wired to overrideClaimability action. */
export type OverrideClaimabilityAction = (raw: {
  expenseId: string;
  claimable: boolean;
  reason?: InputVatBlockReason;
}) => Promise<LedgerActionResult>;
/** D2 · soft-void a fresh draft you created yourself (selfDeleteExpense). Server re-checks owner/age/draft/not-pushed. */
export type SelfDeleteAction = (id: string) => Promise<LedgerActionResult>;
/** D2 · ask the office to delete a row you can't self-void (requestDeleteExpense). Always ok from the user side. */
export type RequestDeleteAction = (
  id: string,
  reason?: string,
) => Promise<LedgerActionResult>;
/** D1 · idempotent find-or-create of the "สำนักงาน (ส่วนกลาง)" branch (ensureCentralBranch).
 *  Called ONLY when the user deliberately picks the central option — returns the branchId to drop in. */
export type EnsureCentralBranchAction = (
  companyId: string,
) => Promise<LedgerActionResult & { branchId?: string }>;

// ── ภาษีซื้อ copy maps (deterministic, ไม่ใช้ AI) ──
const COMPLETENESS_META: Record<
  CompletenessStatus,
  { title: string; verdict: string; cls: string; chip: string }
> = {
  green_full: {
    title: "ใบกำกับเต็มรูป — ขอคืนภาษีซื้อได้",
    verdict: "ขอคืนได้",
    cls: "border-emerald-200 bg-emerald-50 text-emerald-800",
    chip: "bg-emerald-600 text-white",
  },
  yellow_partial: {
    title: "ใบยังไม่สมบูรณ์ — ยังขอคืนไม่ได้",
    verdict: "ลงค่าใช้จ่ายได้ · ขอคืน VAT ไม่ได้ (ต้องขอใบใหม่)",
    cls: "border-amber-200 bg-amber-50 text-amber-800",
    chip: "bg-amber-500 text-white",
  },
  red_invalid: {
    title: "ใบไม่ถูกต้อง — ขอคืนภาษีซื้อไม่ได้",
    verdict: "ขอคืนไม่ได้จนกว่าจะแก้ใบให้ถูก",
    cls: "border-rose-200 bg-rose-50 text-rose-800",
    chip: "bg-rose-600 text-white",
  },
  undecided: {
    title: "ยังไม่ได้ตรวจสถานะใบกำกับ",
    verdict: "กดบันทึก/ยืนยันเพื่อให้ระบบตรวจให้",
    cls: "border-zinc-200 bg-zinc-50 text-zinc-700",
    chip: "bg-zinc-400 text-white",
  },
};

const BUYER_MATCH_LABEL: Record<BuyerMatchStatus, string> = {
  matched: "ผู้ซื้อตรง (เลขภาษีเจพีซิ้งค์)",
  mismatch: "ผู้ซื้อไม่ตรง — ใบออกผิดบริษัท/เลขผิด",
  not_found_on_doc: "ไม่เจอเลขภาษีผู้ซื้อบนใบ",
  undecided: "ยังไม่ตรวจผู้ซื้อ",
};

const BLOCK_REASON_LABEL: Record<InputVatBlockReason, string> = {
  abbreviated_86_6: "ใบกำกับอย่างย่อ (ม.86/6)",
  buyer_mismatch: "ผู้ซื้อไม่ตรง / เลขผิด",
  wrong_entity: "ออกผิดบริษัทในเครือ",
  incomplete_invoice: "ใบไม่ครบองค์ประกอบ (ม.86/4)",
  entertainment: "ค่ารับรอง",
  passenger_car: "รถยนต์นั่ง ≤10 ที่นั่ง",
  other: "อื่น ๆ",
};

/** เหตุผลที่ให้นักบัญชีเลือกตอนตั้ง "ขอคืนไม่ได้". */
const BLOCK_REASON_OPTIONS: InputVatBlockReason[] = [
  "abbreviated_86_6",
  "buyer_mismatch",
  "wrong_entity",
  "incomplete_invoice",
  "entertainment",
  "passenger_car",
  "other",
];

const PAYMENT_METHODS = [
  "เงินสด",
  "โอน",
  "บัตรเครดิต",
  "เช็ค",
  "อื่นๆ",
];

/** D2 self-delete window — mirrors SELF_DELETE_WINDOW_MS in _actions.ts (server is authoritative). */
const SELF_DELETE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

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
  const computed = d.subtotal - (d.discount ?? 0) + d.vat - d.wht;
  if (d.total > 0 && Math.abs(computed - d.total) >= 1) {
    const discPart = (d.discount ?? 0) > 0 ? ` − ส่วนลด ${d.discount.toLocaleString()}` : "";
    out.push({
      field: "total",
      level: "error",
      message: `ยอดรวมไม่ตรง: ยอดย่อย ${d.subtotal.toLocaleString()}${discPart} + VAT ${d.vat.toLocaleString()} − หัก ${d.wht.toLocaleString()} = ${computed.toLocaleString()} ≠ ${d.total.toLocaleString()}`,
    });
  }
  const taxBase = d.subtotal - (d.discount ?? 0);
  if (taxBase > 0 && d.vat > 0) {
    const ratio = d.vat / taxBase;
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
  replacement,
  categories,
  branches,
  onSave,
  onConfirm,
  onVoid,
  onOverrideClaimability,
  onAttachReplacement,
  onSelfDelete,
  onRequestDelete,
  onEnsureCentralBranch,
  currentUserId,
  readOnly = false,
  canConfirm = true,
  canEditClaimability = false,
  showTrcloud = true,
}: {
  expense: ExpenseRow;
  /** ใบทดแทน (ถ้ามี) — โชว์ 2 รูปคู่กัน. */
  replacement?: ExpenseRow | null;
  categories: CategoryOption[];
  branches: BranchOption[];
  onSave: SaveExpenseAction;
  onConfirm: ConfirmExpenseAction;
  onVoid: VoidExpenseAction;
  /** นักบัญชีตั้ง "ขอคืนได้?" + เหตุผล (overrideClaimability action). */
  onOverrideClaimability?: OverrideClaimabilityAction;
  /** แนบใบใหม่ทดแทน (attachReplacementInvoice action). */
  onAttachReplacement?: AttachReplacementAction;
  /** D2 · ลบร่างของตัวเอง (selfDeleteExpense). ไม่ส่งมา = ไม่โชว์ปุ่มลบ. */
  onSelfDelete?: SelfDeleteAction;
  /** D2 · ขอให้บัญชีลบให้ (requestDeleteExpense). ไม่ส่งมา = ไม่โชว์ปุ่มลบ. */
  onRequestDelete?: RequestDeleteAction;
  /** D1 · สร้าง/หา "สำนักงาน (ส่วนกลาง)" เมื่อผู้ใช้เลือกตั้งใจ (ensureCentralBranch). */
  onEnsureCentralBranch?: EnsureCentralBranchAction;
  /** id ของผู้ใช้ปัจจุบัน — ใช้เช็คว่ารายการนี้ "ของฉัน" ไหม (UX gate; server re-checks). */
  currentUserId?: string | null;
  /** locked/void → ดูอย่างเดียว */
  readOnly?: boolean;
  /** false = staff ที่ยังไม่มีสิทธิ์ยืนยัน → กดได้แค่ "บันทึกร่าง" */
  canConfirm?: boolean;
  /** true = นักบัญชี/แอดมิน → ปรับ "ขอคืนได้?" + override + แนบใบทดแทนได้. */
  canEditClaimability?: boolean;
  /** false = ซ่อนปุ่ม "ส่งเข้า TRCloud" (LIFF/สมาชิก — ส่งเป็นงานบัญชีฝั่งเว็บ) */
  showTrcloud?: boolean;
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
    inputVatClaimable: expense.inputVatClaimable ?? null,
    inputVatBlockReason: expense.inputVatBlockReason ?? null,
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

  // ── ภาษีซื้อ (input-VAT) — สถานะสี + override "ขอคืนได้?" ──
  const completeness = (expense.completenessStatus ?? "undecided") as CompletenessStatus;
  const ccMeta = COMPLETENESS_META[completeness] ?? COMPLETENESS_META.undecided;
  const ccMissing = expense.completenessMissing ?? [];
  const isGreen = completeness === "green_full";
  // local claimable state (mirrors persisted; updated optimistically after override).
  const [claimable, setClaimable] = useState<boolean | null>(expense.inputVatClaimable ?? null);
  const [blockReason, setBlockReason] = useState<InputVatBlockReason>(
    expense.inputVatBlockReason ?? "other",
  );
  const [vatPending, setVatPending] = useState(false);
  const [vatMsg, setVatMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // เรียก overrideClaimability action จริง (เฉพาะนักบัญชี/แอดมิน).
  function applyClaimability(next: boolean, reason?: InputVatBlockReason) {
    if (!onOverrideClaimability) return;
    setVatPending(true);
    setVatMsg(null);
    startTransition(async () => {
      const res = await onOverrideClaimability({
        expenseId: expense.id,
        claimable: next,
        reason: next ? undefined : reason ?? blockReason,
      });
      setVatPending(false);
      if (res.ok) {
        setClaimable(next);
        setVatMsg({ kind: "ok", text: next ? "ตั้งเป็น 'ขอคืนได้' แล้ว" : "ตั้งเป็น 'ขอคืนไม่ได้' แล้ว" });
      } else {
        setVatMsg({ kind: "err", text: res.error ?? "ปรับสิทธิ์ขอคืนไม่สำเร็จ" });
      }
    });
  }

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

  // ── line-items accordion (M2) — มือถือ default ยุบไว้ (staff แก้ vendor/total/สาขา/หมวด
  //    เป็นหลัก ไม่ใช่รายการย่อย). มีรายการอยู่แล้ว → เปิดให้เห็นเลยกันงง. ───────────────
  const [itemsOpen, setItemsOpen] = useState(draft.items.length > 0);

  // ── confirm-gate (D1) — ปุ่ม "ยืนยัน" จะกดได้ต่อเมื่อมี "สาขา + หมวด" ครบ.
  //    คิดจากค่าใน draft ปัจจุบัน (UX layer; server ตรวจซ้ำใน action เสมอ). ──────────────
  const gate = useMemo(
    () =>
      expenseConfirmability({
        branchId: draft.branchId || null,
        categoryId: draft.categoryId || null,
      }),
    [draft.branchId, draft.categoryId],
  );
  const gateMissingBranch = gate.missing.includes("branch");
  const gateMissingCategory = gate.missing.includes("category");

  // ── "สำนักงาน (ส่วนกลาง)" — เมื่อ staff ไม่รู้สาขา เลือกอันนี้อย่างตั้งใจ →
  //    เรียก ensureCentralBranch ฝั่ง server แล้วเอา branchId มาใส่ช่องสาขา. ────────────
  const CENTRAL_OPTION = "__central__";
  const [centralPending, setCentralPending] = useState(false);
  function pickBranch(value: string) {
    if (value === CENTRAL_OPTION) {
      if (!onEnsureCentralBranch) return;
      setCentralPending(true);
      setMsg(null);
      startTransition(async () => {
        const res = await onEnsureCentralBranch(expense.companyId);
        setCentralPending(false);
        if (res.ok && res.branchId) {
          set("branchId", res.branchId);
        } else {
          setMsg({ kind: "err", text: res.error ?? "สร้างสาขาสำนักงานไม่สำเร็จ" });
        }
      });
      return;
    }
    set("branchId", value);
  }
  // central branch อาจยังไม่อยู่ใน branches list (เพิ่ง create) → โชว์ option ของมันเองด้วย.
  const centralBranch = useMemo(
    () => branches.find((b) => b.name === "สำนักงาน (ส่วนกลาง)"),
    [branches],
  );

  // ── delete control (D2) — เช็คฝั่ง client ว่า "ลบเองได้ไหม" (server re-checks):
  //    ของฉัน + ร่าง + ยังไม่ส่ง TRCloud + ภายใน 5 นาที. ────────────────────────────────
  const isMine = currentUserId != null && expense.createdBy === currentUserId;
  const createdAtMs = useMemo(() => {
    const t = new Date(expense.createdAt).getTime();
    return Number.isNaN(t) ? 0 : t;
  }, [expense.createdAt]);
  // นาฬิกาเดินจริง → countdown 5 นาที (nice-to-have; server ตัดสินจริง).
  const [now, setNow] = useState(() => Date.now());
  const withinWindow = createdAtMs > 0 && now - createdAtMs < SELF_DELETE_WINDOW_MS;
  const canSelfDelete =
    isMine && expense.status === "draft" && expense.trcloudDocId == null && withinWindow;
  const secsLeft = canSelfDelete
    ? Math.max(0, Math.ceil((createdAtMs + SELF_DELETE_WINDOW_MS - now) / 1000))
    : 0;
  // เดินนาฬิกาเฉพาะตอนยังอยู่ในหน้าต่าง self-delete (กัน setInterval ค้าง).
  useEffect(() => {
    if (!isMine || expense.status !== "draft" || expense.trcloudDocId != null) return;
    if (createdAtMs <= 0 || Date.now() - createdAtMs >= SELF_DELETE_WINDOW_MS) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isMine, expense.status, expense.trcloudDocId, createdAtMs]);

  const [delConfirm, setDelConfirm] = useState(false); // 2-step self-delete กันกดพลาด
  const [delPending, setDelPending] = useState(false);

  function handleSelfDelete() {
    if (!onSelfDelete) return;
    if (!delConfirm) {
      setDelConfirm(true);
      return;
    }
    setDelConfirm(false);
    setDelPending(true);
    setMsg(null);
    startTransition(async () => {
      const res = await onSelfDelete(expense.id);
      setDelPending(false);
      setMsg(
        res.ok
          ? { kind: "ok", text: "ลบรายการแล้ว (ขึ้นเป็น 'ยกเลิก')" }
          : { kind: "err", text: res.error ?? "ลบไม่สำเร็จ" },
      );
    });
  }

  function handleRequestDelete() {
    if (!onRequestDelete) return;
    const reason = prompt("เหตุผลที่ขอลบ (ไม่ใส่ก็ได้):") ?? undefined;
    setDelPending(true);
    setMsg(null);
    startTransition(async () => {
      const res = await onRequestDelete(expense.id, reason);
      setDelPending(false);
      // requestDeleteExpense ตอบ ok:true เสมอ — .error เป็น hint (ยังไม่เชื่อม LINE).
      setMsg(
        res.error
          ? { kind: "ok", text: res.error }
          : { kind: "ok", text: "ส่งคำขอให้บัญชีลบแล้ว" },
      );
    });
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
    // h-11/text-base on mobile = ≥44px touch target + 16px (no iOS zoom); sm: keeps the dense desktop form.
    "h-11 w-full rounded-lg border border-zinc-200 bg-white px-2 text-base outline-none focus:ring-2 focus:ring-[var(--color-brand-200)] disabled:bg-zinc-50 disabled:text-zinc-500 sm:h-9 sm:text-sm";

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
          {showTrcloud && (
            <SendToTrcloudButton
              expenseId={expense.id}
              status={expense.status}
              trcloudDocId={expense.trcloudDocId}
              trcloudDocNo={expense.trcloudDocNo}
              trcloudError={expense.trcloudError}
            />
          )}
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

      {/* ── สถานะใบกำกับ — ผิดตรงไหน (ภาษีซื้อ) ── */}
      {completeness !== "undecided" && (
        <div className={cn("rounded-xl border p-3", ccMeta.cls)}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <DocTag
                docType={expense.docType}
                vat={expense.vat}
                completenessStatus={completeness}
              />
              <PaymentTag status={expense.paymentStatus} />
              <h3 className="text-sm font-bold">{ccMeta.title}</h3>
            </div>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", ccMeta.chip)}>
              {ccMeta.verdict}
            </span>
          </div>

          {/* ผลตรวจผู้ซื้อ (เลขภาษี 13 หลักเป๊ะ — ไม่ใช้ชื่อ) */}
          <p className="mt-1.5 text-xs opacity-90">
            {BUYER_MATCH_LABEL[(expense.buyerMatchStatus ?? "undecided") as BuyerMatchStatus]}
            {expense.buyerTaxIdOnDoc ? ` · เลขบนใบ ${expense.buyerTaxIdOnDoc}` : ""}
          </p>

          {/* รายการ "ขาดตรงไหน" เป็นภาษาไทย */}
          {ccMissing.length > 0 && (
            <ul className="mt-2 ml-4 list-disc space-y-0.5 text-xs">
              {ccMissing.map((m) => (
                <li key={m}>{missingLabel(m)}</li>
              ))}
            </ul>
          )}
          {expense.inputVatBlockReason && (
            <p className="mt-2 text-xs font-medium">
              เหตุผล: {BLOCK_REASON_LABEL[expense.inputVatBlockReason as InputVatBlockReason]}
            </p>
          )}

          {/* ปุ่มแนบใบใหม่ทดแทน — โชว์เมื่อยังไม่เขียว + มี action + มีสิทธิ์ */}
          {!isGreen && !locked && canEditClaimability && onAttachReplacement && !expense.replacedById && (
            <div className="mt-3 border-t border-current/15 pt-3">
              <AttachReplacementButton
                expenseId={expense.id}
                onAttach={onAttachReplacement}
              />
            </div>
          )}
          {expense.replacedById && (
            <p className="mt-3 flex items-center gap-1 border-t border-current/15 pt-3 text-xs font-medium">
              <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
              มีใบทดแทนแล้ว — ดูรูปทั้ง 2 ใบด้านล่าง
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
        {/* รูปใบเสร็จ (sticky บนจอใหญ่ — เลื่อนฟอร์มแล้วรูปยังอยู่).
            ถ้ามีใบทดแทน → โชว์ 2 รูปคู่กัน (ใบเดิม + ใบใหม่). */}
        <div className="space-y-2 lg:sticky lg:top-20 lg:self-start">
          {replacement ? (
            <>
              <div>
                <p className="mb-1 text-[11px] font-semibold text-zinc-500">ใบเดิม</p>
                <ReceiptThumb
                  thumbUrl={expense.thumbUrl}
                  originalUrl={expense.originalUrl}
                  alt={`ใบเสร็จเดิม ${expense.docCode}`}
                />
              </div>
              <div>
                <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                  <ReceiptText className="size-3.5" aria-hidden /> ใบทดแทน (ใหม่)
                </p>
                <ReceiptThumb
                  thumbUrl={replacement.thumbUrl}
                  originalUrl={replacement.originalUrl}
                  alt={`ใบทดแทน ${replacement.docCode}`}
                />
              </div>
            </>
          ) : (
            <ReceiptThumb
              thumbUrl={expense.thumbUrl}
              originalUrl={expense.originalUrl}
              alt={`ใบเสร็จ ${expense.docCode}`}
            />
          )}
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel>ประเภทเอกสาร</FieldLabel>
                <select
                  className={inputCls}
                  aria-label="ประเภทเอกสาร"
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                  aria-label="วันที่ออกเอกสาร"
                  value={draft.docDate}
                  disabled={locked}
                  onChange={(e) => set("docDate", e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel confidence={conf.suggested_category ?? conf.category}>
                  ประเภทค่าใช้จ่าย
                </FieldLabel>
                <select
                  className={cn(inputCls, gateMissingCategory && "border-amber-300 ring-1 ring-amber-200")}
                  aria-label="ประเภทค่าใช้จ่าย"
                  value={draft.categoryId}
                  disabled={locked}
                  onChange={(e) => set("categoryId", e.target.value)}
                >
                  <option value="">— เลือกหมวด —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {gateMissingCategory && (
                  <p className="mt-1 text-[11px] text-amber-700">ต้องระบุหมวดหมู่ค่าใช้จ่าย</p>
                )}
              </div>
              <div>
                <FieldLabel>สาขา (ของเรา)</FieldLabel>
                <select
                  className={cn(inputCls, gateMissingBranch && "border-amber-300 ring-1 ring-amber-200")}
                  aria-label="สาขา"
                  value={draft.branchId}
                  disabled={locked || centralPending}
                  onChange={(e) => pickBranch(e.target.value)}
                >
                  <option value="">— ไม่ระบุ —</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.code} · {b.name}</option>
                  ))}
                  {/* เลือก "สำนักงาน (ส่วนกลาง)" อย่างตั้งใจเมื่อไม่รู้สาขา —
                      ถ้ายังไม่มีในลิสต์ เสนอเป็นตัวเลือกพิเศษ (เรียก ensureCentralBranch). */}
                  {onEnsureCentralBranch && !centralBranch && (
                    <option value={CENTRAL_OPTION}>สำนักงาน (ส่วนกลาง)</option>
                  )}
                </select>
                {gateMissingBranch && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-700">
                    {centralPending ? (
                      <Loader2 className="size-3 animate-spin" aria-hidden />
                    ) : (
                      <Building2 className="size-3" aria-hidden />
                    )}
                    {centralPending ? "กำลังตั้งสาขาสำนักงาน…" : "ต้องระบุสาขา — ไม่รู้สาขาเลือก “สำนักงาน (ส่วนกลาง)”"}
                  </p>
                )}
              </div>
            </div>

            {/* แยกรายการ — line items (M2: มือถือ default ยุบไว้ใต้ accordion · ≥768px
                stack เป็นการ์ดต่อรายการ เพื่อไม่ให้ grid ล้นจอ 375px เวลายอด 5+ หลัก). */}
            <div className="rounded-xl border border-zinc-100 bg-zinc-50/60 p-2.5">
              <button
                type="button"
                onClick={() => setItemsOpen((o) => !o)}
                aria-expanded={itemsOpen}
                aria-controls="line-items-body"
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-600">
                  <ListTree className="size-3.5 text-zinc-400" aria-hidden />
                  รายการสินค้า / บริการ {draft.items.length > 0 ? `(${draft.items.length})` : ""}
                </span>
                <ChevronDown
                  className={cn("size-4 text-zinc-400 transition-transform", itemsOpen && "rotate-180")}
                  aria-hidden
                />
              </button>

              {itemsOpen && (
                <div id="line-items-body" className="mt-2">
                  <div className="mb-1.5 flex items-center justify-end">
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
                    <div className="space-y-2 md:space-y-1.5">
                      {draft.items.map((it, i) => (
                        <div
                          key={i}
                          className="rounded-lg border border-zinc-200 bg-white p-2 md:grid md:grid-cols-[minmax(0,1fr)_56px_80px_88px_28px] md:items-center md:gap-1.5 md:rounded-md md:border-0 md:bg-transparent md:p-0"
                        >
                          {/* ชื่อรายการ — กว้างเต็มบนมือถือ */}
                          <input
                            className="h-11 w-full rounded-md border border-zinc-200 bg-white px-2 text-base outline-none focus:ring-2 focus:ring-[var(--color-brand-200)] disabled:bg-zinc-100 md:h-8 md:text-xs"
                            value={it.description}
                            disabled={locked}
                            onChange={(e) => updateItem(i, { description: e.target.value })}
                            placeholder="ชื่อสินค้า/บริการ"
                          />
                          {/* จำนวน · ราคา/หน่วย · ยอดรวม — มือถือ stack เป็น 3 ช่องมีป้ายกำกับ */}
                          <div className="mt-2 grid grid-cols-3 gap-1.5 md:mt-0 md:contents">
                            <label className="block md:contents">
                              <span className="mb-0.5 block text-[10px] font-medium text-zinc-400 md:hidden">จำนวน</span>
                              <input
                                className="h-11 w-full rounded-md border border-zinc-200 bg-white px-1.5 text-right text-base outline-none focus:ring-2 focus:ring-[var(--color-brand-200)] disabled:bg-zinc-100 md:h-8 md:text-xs"
                                value={it.qty}
                                disabled={locked}
                                inputMode="decimal"
                                onChange={(e) => updateItem(i, { qty: Number(e.target.value) || 0 })}
                                aria-label="จำนวน"
                              />
                            </label>
                            <label className="block md:contents">
                              <span className="mb-0.5 block text-[10px] font-medium text-zinc-400 md:hidden">ราคา/หน่วย</span>
                              <input
                                className="h-11 w-full rounded-md border border-zinc-200 bg-white px-1.5 text-right text-base outline-none focus:ring-2 focus:ring-[var(--color-brand-200)] disabled:bg-zinc-100 md:h-8 md:text-xs"
                                value={it.unitPrice}
                                disabled={locked}
                                inputMode="decimal"
                                onChange={(e) => updateItem(i, { unitPrice: Number(e.target.value) || 0 })}
                                aria-label="ราคาต่อหน่วย"
                              />
                            </label>
                            <label className="block md:contents">
                              <span className="mb-0.5 block text-[10px] font-medium text-zinc-400 md:hidden">ยอดรวม</span>
                              <input
                                className="h-11 w-full rounded-md border border-zinc-200 bg-white px-1.5 text-right text-base font-medium outline-none focus:ring-2 focus:ring-[var(--color-brand-200)] disabled:bg-zinc-100 md:h-8 md:text-xs"
                                value={it.amount}
                                disabled={locked}
                                inputMode="decimal"
                                onChange={(e) => updateItem(i, { amount: Number(e.target.value) || 0 })}
                                aria-label="ยอดรวมรายการ"
                              />
                            </label>
                          </div>
                          {!locked && (
                            <button
                              type="button"
                              onClick={() => removeItem(i)}
                              className="mt-1 flex h-9 w-full items-center justify-center gap-1 rounded-md text-xs text-rose-500 hover:bg-rose-50 md:mt-0 md:size-7 md:w-auto md:text-transparent"
                              aria-label="ลบรายการ"
                            >
                              <Trash2 className="size-3.5" aria-hidden />
                              <span className="md:hidden">ลบรายการนี้</span>
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

            {/* ภาษีซื้อ — "ขอคืนได้?" + เหตุผล (เฉพาะนักบัญชี/แอดมิน · เรียก override action จริง) */}
            {canEditClaimability && onOverrideClaimability && (
              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-700">ภาษีซื้อ (VAT) นี้ขอคืนได้?</p>
                    <p className="text-[11px] text-zinc-400">
                      ระบบแนะนำจากสถานะสี — ปรับเองได้ บันทึกไว้ใครเปลี่ยน/เมื่อไหร่
                    </p>
                  </div>
                  {/* 2-state segmented toggle → override action */}
                  <div className="inline-flex overflow-hidden rounded-lg border border-zinc-200">
                    <button
                      type="button"
                      onClick={() => applyClaimability(true)}
                      disabled={vatPending}
                      aria-pressed={claimable === true}
                      className={cn(
                        "px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50",
                        claimable === true
                          ? "bg-emerald-600 text-white"
                          : "bg-white text-zinc-600 hover:bg-zinc-50",
                      )}
                    >
                      ขอคืนได้
                    </button>
                    <button
                      type="button"
                      onClick={() => applyClaimability(false)}
                      disabled={vatPending}
                      aria-pressed={claimable === false}
                      className={cn(
                        "border-l border-zinc-200 px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50",
                        claimable === false
                          ? "bg-rose-600 text-white"
                          : "bg-white text-zinc-600 hover:bg-zinc-50",
                      )}
                    >
                      ขอคืนไม่ได้
                    </button>
                  </div>
                </div>

                {/* เหตุผล — จำเป็นเมื่อ "ขอคืนไม่ได้" */}
                {claimable === false && (
                  <div className="mt-2.5">
                    <label className="mb-1 block text-xs font-semibold text-zinc-600">
                      เหตุผลที่ขอคืนไม่ได้
                    </label>
                    <select
                      aria-label="เหตุผลที่ขอคืนไม่ได้"
                      className={inputCls}
                      value={blockReason}
                      disabled={vatPending}
                      onChange={(e) => {
                        const r = e.target.value as InputVatBlockReason;
                        setBlockReason(r);
                        applyClaimability(false, r);
                      }}
                    >
                      {BLOCK_REASON_OPTIONS.map((r) => (
                        <option key={r} value={r}>{BLOCK_REASON_LABEL[r]}</option>
                      ))}
                    </select>
                  </div>
                )}

                {vatPending && (
                  <p className="mt-2 flex items-center gap-1 text-[11px] text-zinc-400">
                    <Loader2 className="size-3 animate-spin" aria-hidden /> กำลังบันทึก…
                  </p>
                )}
                {vatMsg && (
                  <p className={cn("mt-2 text-[11px]", vatMsg.kind === "ok" ? "text-emerald-700" : "text-rose-600")}>
                    {vatMsg.text}
                  </p>
                )}
              </div>
            )}
          </section>

          {/* 3 · การชำระเงิน & ผู้เบิก */}
          <section className="space-y-3 rounded-2xl border border-zinc-100 p-3">
            <SectionTitle n={3} icon={<Wallet className="size-4" aria-hidden />}>
              การชำระเงิน & ผู้เบิก
            </SectionTitle>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                  aria-label="สถานะการชำระเงิน"
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel confidence={conf.payment_method ?? conf.paymentMethod}>วิธีชำระเงิน</FieldLabel>
                <select
                  className={inputCls}
                  aria-label="วิธีชำระเงิน"
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
              disabled={pending || hasError || !canConfirm || !gate.ok}
              onClick={() => handle(onConfirm, "ยืนยันแล้ว · บันทึกเป็น 'ยืนยันแล้ว'")}
              title={
                !canConfirm
                  ? "เฉพาะบัญชี/ผู้ดูแลยืนยันได้ — คุณกดบันทึกร่างได้"
                  : !gate.ok
                    ? confirmabilityMessage(gate.missing)
                    : hasError
                      ? "แก้ยอดที่ไม่ตรงก่อนยืนยัน"
                      : undefined
              }
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

            {/* ลบรายการ (D2) — ลบเองได้ภายใน 5 นาที (ของฉัน+ร่าง+ยังไม่ส่ง) ·
                นอกนั้นเป็น "ขอลบ" ส่งให้บัญชี. server ตรวจซ้ำทุกกรณี. */}
            {onSelfDelete && canSelfDelete ? (
              <Button
                variant="ghost"
                disabled={pending || delPending}
                onClick={handleSelfDelete}
                className={cn(
                  "ml-auto hover:bg-rose-50",
                  delConfirm ? "bg-rose-50 text-rose-700" : "text-rose-600",
                )}
                title={delConfirm ? "กดอีกครั้งเพื่อยืนยันการลบ" : undefined}
              >
                {delPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="size-4" aria-hidden />
                )}
                {delConfirm
                  ? "กดอีกครั้งเพื่อลบ"
                  : secsLeft > 0
                    ? `ลบรายการ (${Math.floor(secsLeft / 60)}:${String(secsLeft % 60).padStart(2, "0")})`
                    : "ลบรายการ"}
              </Button>
            ) : onRequestDelete ? (
              <Button
                variant="ghost"
                disabled={pending || delPending}
                onClick={handleRequestDelete}
                className="ml-auto text-rose-600 hover:bg-rose-50"
                title="ส่งคำขอให้บัญชีลบให้ (เกิน 5 นาที / ไม่ใช่ของคุณ / ยืนยันแล้ว)"
              >
                {delPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="size-4" aria-hidden />
                )}
                ขอลบ
              </Button>
            ) : (
              canConfirm && (
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={handleVoid}
                  className="ml-auto text-rose-600 hover:bg-rose-50"
                >
                  <Ban className="size-4" aria-hidden />
                  ยกเลิก
                </Button>
              )
            )}
          </div>

          {/* ถ้ามีปุ่มลบใหม่ + ผู้ใช้เป็นบัญชี → ยังให้ "ยกเลิก" แยกไว้ (void ของบัญชี). */}
          {(onSelfDelete || onRequestDelete) && canConfirm && (
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                disabled={pending}
                onClick={handleVoid}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-400 hover:text-rose-600 disabled:opacity-50"
              >
                <Ban className="size-3" aria-hidden /> ยกเลิกใบนี้ (บัญชี)
              </button>
            </div>
          )}

          <p className="mt-2 flex items-center gap-1 text-[11px] text-zinc-400">
            <ShieldCheck className="size-3.5" aria-hidden />
            {hasError
              ? "ยอดไม่ตรง — แก้ให้ถูกก่อนจึงจะกด “ยืนยัน” ได้"
              : !gate.ok && canConfirm
                ? confirmabilityMessage(gate.missing)
                : "ระบบไม่บันทึกอัตโนมัติ — รายการเป็น “ร่าง” จนกว่าจะกดยืนยันเอง"}
          </p>
        </div>
      )}
    </div>
  );
}
