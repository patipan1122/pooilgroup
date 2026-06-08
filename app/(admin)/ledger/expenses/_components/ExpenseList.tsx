"use client";

// Left pane of the รายจ่าย workspace: status/category/TRCloud/search filters, a
// scrollable receipt list, and a context-aware bulk bar (ยืนยันร่าง · ส่งเข้า TRCloud).
// All filters are URL-driven (GET form / router.push) so the server page re-reads
// scope on every change.
import { useState, useTransition, useEffect } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Loader2, CheckCircle2, AlertTriangle, Send, CloudCheck, Trash2, Banknote, Tags, Upload, QrCode } from "lucide-react";
import { StatusBadge } from "@/components/ledger/_kit/StatusBadge";
import { CompletenessDot } from "@/components/ledger/_kit/CompletenessDot";
import { DocTag, PaymentTag } from "@/components/ledger/_kit/StatusTags";
import { LedgerEmptyState } from "@/components/ledger/Brand";
import { expenseConfirmability } from "@/lib/ledger/confirmability";
import {
  bulkConfirm,
  bulkVoid,
  sendExpensesToTrcloud,
  createPaymentRequestAction,
  bulkClassify,
  lastPayeeForVendor,
} from "../../_actions";

/** Common Thai banks for the ขอโอนเงิน payee form (code → short name). */
const BANKS: { code: string; name: string }[] = [
  { code: "", name: "เลือกธนาคาร" },
  { code: "002", name: "กรุงเทพ" },
  { code: "004", name: "กสิกรไทย" },
  { code: "006", name: "กรุงไทย" },
  { code: "011", name: "ทหารไทยธนชาต" },
  { code: "014", name: "ไทยพาณิชย์" },
  { code: "025", name: "กรุงศรีอยุธยา" },
  { code: "030", name: "ออมสิน" },
  { code: "022", name: "ซีไอเอ็มบี ไทย" },
  { code: "024", name: "ยูโอบี" },
  { code: "069", name: "เกียรตินาคินภัทร" },
  { code: "067", name: "ทิสโก้" },
  { code: "073", name: "แลนด์ แอนด์ เฮ้าส์" },
];
import type { ExpenseTab } from "../page";
import { FilterSheet } from "./FilterSheet";
import type { ExpenseRow, LedgerStatusValue } from "@/components/ledger/_kit/types";

// PRIMARY status strip (redesign 2026-06-07) — the accountant's daily axis: triage
// รอยืนยัน → ยืนยันแล้ว → ส่ง TRCloud. "ส่งแล้ว" is the ?tr=sent filter (not a status),
// the rest drive ?status=. Source (LINE/email/…) moved into the ตัวกรอง popover.
// 5 tabs matching the design (รอตรวจ = draft AI ยังไม่ชัวร์/needsReview · รอยืนยัน =
// draft ตรวจแล้วรอบัญชียืนยัน · ยืนยันแล้ว = confirmed · ส่ง TRCloud = tr=sent · ทั้งหมด).
const PRIMARY_TABS: Array<{ id: "review" | "draft" | "confirmed" | "sent" | "all"; label: string }> = [
  { id: "review", label: "รอตรวจ" },
  { id: "draft", label: "รอยืนยัน" },
  { id: "confirmed", label: "ยืนยันแล้ว" },
  { id: "sent", label: "ส่ง TRCloud" },
  { id: "all", label: "ทั้งหมด" },
];

function baht(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} ฿`;
}

// แหล่งที่มา — จุดสีจิ๋วข้างชื่อร้าน (LINE เขียว · อีเมลฟ้า · เพิ่มเองเทา) เหมือนดีไซน์.
const SOURCE_DOT: Record<string, { cls: string; label: string }> = {
  line: { cls: "bg-[#06c755]", label: "จาก LINE" },
  email: { cls: "bg-sky-500", label: "จากอีเมล" },
  web: { cls: "bg-zinc-400", label: "เพิ่มเอง" },
};

export function ExpenseList({
  rows,
  categories,
  selectedId,
  baseParams,
  status,
  categoryId,
  tr,
  cc,
  q,
  draftIds,
  sendableIds,
  companyId,
  tab,
  sort,
  nr,
  statusCounts,
  listActions,
  payreqEnabled,
  branches,
}: {
  rows: ExpenseRow[];
  categories: Array<{ id: string; name: string; color: string | null; sort: number }>;
  /** สาขา (for the quick-classify dialog — audit P0). */
  branches?: Array<{ id: string; name: string; code?: string | null }>;
  selectedId?: string;
  baseParams: string;
  status?: LedgerStatusValue;
  categoryId?: string;
  tr?: "sent" | "unsent";
  /** ภาษีซื้อ color filter (?cc=) — green/yellow/red. */
  cc?: "green" | "yellow" | "red";
  q?: string;
  draftIds: string[];
  /** Confirmed/locked rows not yet pushed to TRCloud — eligible for bulk send. */
  sendableIds: string[];
  /** Active company scope — passed to bulk actions so they can't cross companies. */
  companyId: string;
  /** D4 source tab (?tab=) — all | line | web | mine (now lives inside ตัวกรอง). */
  tab: ExpenseTab;
  /** เรียงลำดับปัจจุบัน (?sort=) — undefined = ใหม่→เก่า (ค่าเริ่มต้น). */
  sort?: "date-asc" | "amount-desc" | "amount-asc";
  /** needsReview filter (?nr=) — true=รอตรวจ · false=รอยืนยัน · undefined=ไม่กรอง. */
  nr?: boolean;
  /** DB-accurate counts for the 5 PRIMARY tabs (รอตรวจ/รอยืนยัน/ยืนยันแล้ว/ส่ง/ทั้งหมด). */
  statusCounts: { all: number; review: number; draft: number; confirmed: number; sent: number };
  /** Shortcut actions (ไม่มีใบเสร็จ · สลิปรอจับคู่) — rendered inside the mobile
   *  ตัวกรอง sheet so they're off the page header. */
  listActions?: React.ReactNode;
  /** LEDGER_PAYREQ_V1 — show the "ขอโอนเงิน" bulk action (request a transfer). */
  payreqEnabled?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // Bulk-delete two-step guard: open a confirm sheet, require typing "ลบ".
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  // ขอโอนเงิน — payee dialog (LEDGER_PAYREQ_V1).
  const [payeeOpen, setPayeeOpen] = useState(false);
  const [payee, setPayee] = useState({ acctName: "", bankCode: "", acctNo: "", promptpay: "", qrImageUrl: "" });
  const [qrUploading, setQrUploading] = useState(false);
  // #1 quick-classify (audit P0) — set สาขา/หมวด for the ticked bills in one dialog.
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [classify, setClassify] = useState({ branchId: "", categoryId: "" });
  // a11y (bug-hunt P2) — close the payee dialog on Escape.
  useEffect(() => {
    if (!payeeOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) setPayeeOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [payeeOpen, pending]);

  const draftSet = new Set(draftIds);
  const sendableSet = new Set(sendableIds);
  const selDrafts = [...checked].filter((id) => draftSet.has(id));
  const selSendable = [...checked].filter((id) => sendableSet.has(id));
  const actionableIds = [...draftIds, ...sendableIds];

  // Request-transfer selection guards: bills must share ONE vendor (the payee is
  // a single account). The list is already company-scoped, so cross-company can't
  // happen here; the server re-validates company + vendor anyway.
  const checkedRows = rows.filter((r) => checked.has(r.id));
  const checkedVendors = Array.from(
    new Set(checkedRows.map((r) => (r.vendor ?? "").trim()).filter((v) => v.length > 0)),
  );
  const multiVendor = checkedVendors.length > 1;
  // ขอโอน requires each bill be classifiable (สาขา+หมวด · D6) — surface it in the
  // dialog so a request can't be silently rejected by the server (then look frozen).
  const checkedNeedFix = checkedRows.filter(
    (r) => !expenseConfirmability({ branchId: r.branchId, categoryId: r.categoryId }).ok,
  );
  const canRequest = checkedRows.length > 0 && !multiVendor && checkedNeedFix.length === 0;

  // Build a link to a row keeping company/branch/filter context.
  function rowHref(id: string) {
    const sp = new URLSearchParams(baseParams);
    sp.set("selected", id);
    return `${pathname}?${sp.toString()}`;
  }

  function setParam(key: string, next: string) {
    const sp = new URLSearchParams(baseParams);
    sp.delete(key);
    if (next) sp.set(key, next);
    if (selectedId) sp.set("selected", selectedId);
    router.push(`${pathname}?${sp.toString()}`);
  }

  // Clear all secondary filters in ONE push (sequential setParam calls each re-push
  // from the same baseParams snapshot, so only the last would actually apply).
  function clearFilters() {
    const sp = new URLSearchParams(baseParams);
    sp.delete("status");
    sp.delete("tr");
    sp.delete("cc");
    sp.delete("category");
    sp.delete("tab");
    sp.delete("nr");
    if (selectedId) sp.set("selected", selectedId);
    router.push(`${pathname}?${sp.toString()}`);
  }

  // PRIMARY status strip — sets status/tr/nr atomically (selecting one clears others)
  // so the 5 segmented tabs behave like a single tab group. รอตรวจ/รอยืนยัน both =
  // draft, split by needsReview (?nr=1 / ?nr=0).
  const activePrimary: "review" | "draft" | "confirmed" | "sent" | "all" | null =
    tr === "sent"
      ? "sent"
      : status === "confirmed"
        ? "confirmed"
        : status === "draft" && nr === true
          ? "review"
          : status === "draft" && nr === false
            ? "draft"
            : !status && !tr
              ? "all"
              : null; // locked/void via the ตัวกรอง popover → no primary highlight
  function setPrimaryTab(id: "review" | "draft" | "confirmed" | "sent" | "all") {
    const sp = new URLSearchParams(baseParams);
    sp.delete("status");
    sp.delete("tr");
    sp.delete("nr");
    if (id === "review") {
      sp.set("status", "draft");
      sp.set("nr", "1");
    } else if (id === "draft") {
      sp.set("status", "draft");
      sp.set("nr", "0");
    } else if (id === "confirmed") {
      sp.set("status", "confirmed");
    } else if (id === "sent") {
      sp.set("tr", "sent");
    }
    if (selectedId) sp.set("selected", selectedId);
    router.push(`${pathname}?${sp.toString()}`);
  }

  function toggle(id: string) {
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function selectAllActionable() {
    setChecked((prev) =>
      prev.size === actionableIds.length ? new Set() : new Set(actionableIds),
    );
  }

  function runBulkConfirm() {
    if (selDrafts.length === 0) return;
    setMsg(null);
    startTransition(async () => {
      const res = await bulkConfirm(selDrafts, companyId);
      if (res.ok) {
        setMsg({ kind: "ok", text: `ยืนยัน ${res.confirmed ?? 0} ใบ · ข้าม ${res.skipped ?? 0} ใบ (ยอดไม่ตรง)` });
        setChecked(new Set());
        router.refresh();
      } else {
        setMsg({ kind: "err", text: res.error ?? "ยืนยันไม่สำเร็จ" });
      }
    });
  }

  function runBulkSend() {
    if (selSendable.length === 0) return;
    setMsg(null);
    startTransition(async () => {
      const res = await sendExpensesToTrcloud(selSendable, companyId);
      if (res.ok) {
        const parts = [`ส่งเข้า TRCloud ${res.sent ?? 0} ใบ`];
        if (res.skipped) parts.push(`ข้าม ${res.skipped}`);
        if (res.failed) parts.push(`พลาด ${res.failed}`);
        setMsg({ kind: res.failed ? "err" : "ok", text: parts.join(" · ") });
        setChecked(new Set());
        router.refresh();
      } else {
        setMsg({ kind: "err", text: res.error ?? "ส่งเข้า TRCloud ไม่สำเร็จ" });
      }
    });
  }

  // #2 payee autofill (audit P1) — open the dialog + prefill from the vendor's last
  // request payee (fallback: bill.bankDetail). Reduces re-typing → fewer wrong accounts.
  function openPayeeDialog() {
    setMsg(null);
    setPayeeOpen(true);
    const vendor = checkedVendors[0];
    if (!vendor) return;
    lastPayeeForVendor(vendor, companyId)
      .then((p) => {
        if (!p) return;
        setPayee((cur) => ({
          acctName: cur.acctName || p.acctName || "",
          bankCode: cur.bankCode || p.bankCode || "",
          acctNo: cur.acctNo || p.acctNo || "",
          promptpay: cur.promptpay || p.promptpay || "",
          qrImageUrl: cur.qrImageUrl || "",
        }));
      })
      .catch(() => {});
  }

  // Per-row "ขอโอน" (hover) — tick just this row + open the payee dialog prefilled
  // from the vendor's last payee. Same single createPaymentRequestAction path.
  function openPayeeForRow(r: ExpenseRow) {
    setMsg(null);
    setChecked(new Set([r.id]));
    setPayeeOpen(true);
    const vendor = (r.vendor ?? "").trim();
    if (!vendor) return;
    lastPayeeForVendor(vendor, companyId)
      .then((p) => {
        if (!p) return;
        setPayee((cur) => ({
          acctName: cur.acctName || p.acctName || "",
          bankCode: cur.bankCode || p.bankCode || "",
          acctNo: cur.acctNo || p.acctNo || "",
          promptpay: cur.promptpay || p.promptpay || "",
          qrImageUrl: cur.qrImageUrl || "",
        }));
      })
      .catch(() => {});
  }

  // #1 quick-classify — apply สาขา/หมวด to the bills that need it (or all ticked).
  function runBulkClassify() {
    const needIds = checkedNeedFix.map((r) => r.id);
    const targetIds = needIds.length > 0 ? needIds : [...checked];
    if (targetIds.length === 0 || (!classify.branchId && !classify.categoryId)) return;
    setMsg(null);
    startTransition(async () => {
      const res = await bulkClassify(targetIds, classify.branchId, classify.categoryId, companyId);
      if (res.ok) {
        setMsg({ kind: "ok", text: `ตั้งสาขา/หมวดให้ ${res.updated ?? 0} ใบแล้ว — ขอโอนต่อได้เลย` });
        setClassifyOpen(false);
        setClassify({ branchId: "", categoryId: "" });
        router.refresh();
      } else {
        setMsg({ kind: "err", text: res.error ?? "ตั้งสาขา/หมวดไม่สำเร็จ" });
      }
    });
  }

  // แนบรูป QR (พร้อมเพย์/ธนาคาร) → presign → PUT R2 → เก็บ publicUrl ไว้ส่งกับคำขอ
  // (LINE การ์ดจะโชว์รูปนี้ให้ผู้บริหารสแกนจ่ายได้เลย).
  async function uploadQr(file: File) {
    if (!file.type.startsWith("image/")) {
      setMsg({ kind: "err", text: "แนบได้เฉพาะรูปภาพ QR" });
      return;
    }
    setQrUploading(true);
    setMsg(null);
    try {
      const pres = await fetch("/api/ledger/r2/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, contentType: file.type }),
      });
      const pj = (await pres.json()) as { url?: string; publicUrl?: string; error?: string };
      if (!pres.ok || !pj.url || !pj.publicUrl) throw new Error(pj.error ?? "presign");
      const put = await fetch(pj.url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error("upload");
      setPayee((p) => ({ ...p, qrImageUrl: pj.publicUrl as string }));
    } catch {
      setMsg({ kind: "err", text: "อัปโหลด QR ไม่สำเร็จ — ลองใหม่" });
    } finally {
      setQrUploading(false);
    }
  }

  function runRequestTransfer() {
    const ids = [...checked];
    if (ids.length === 0) return;
    setMsg(null);
    startTransition(async () => {
      const res = await createPaymentRequestAction(ids, {
        acctName: payee.acctName.trim() || undefined,
        bankCode: payee.bankCode || undefined,
        acctNo: payee.acctNo.trim() || undefined,
        promptpay: payee.promptpay.trim() || undefined,
        qrImageUrl: payee.qrImageUrl || undefined,
      });
      if (res.ok) {
        setMsg({ kind: "ok", text: "ส่งคำขอโอนเข้ากลุ่มผู้บริหารแล้ว ✅" });
        setChecked(new Set());
        setPayeeOpen(false);
        setPayee({ acctName: "", bankCode: "", acctNo: "", promptpay: "", qrImageUrl: "" });
        router.refresh();
      } else {
        setMsg({ kind: "err", text: res.error ?? "ขอโอนไม่สำเร็จ" });
      }
    });
  }

  function runBulkVoid() {
    const ids = [...checked];
    if (ids.length === 0) return;
    setMsg(null);
    startTransition(async () => {
      const res = await bulkVoid(ids, companyId);
      if (res.ok) {
        const extra = res.skipped ? ` · ข้าม ${res.skipped} (ถูกล็อก)` : "";
        setMsg({ kind: "ok", text: `ลบ ${res.voided ?? 0} ใบแล้ว${extra}` });
        setChecked(new Set());
        setConfirmDelete(false);
        setDeleteText("");
        router.refresh();
      } else {
        setMsg({ kind: "err", text: res.error ?? "ลบไม่สำเร็จ" });
      }
    });
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white">
      {/* Sticky filter header */}
      <div className="sticky top-14 z-20 space-y-2 rounded-t-2xl border-b border-zinc-200 bg-white p-3 sm:top-16">
        {/* PRIMARY status strip — รอยืนยัน → ยืนยันแล้ว → ส่งแล้ว (accountant triage axis).
            "ส่งแล้ว" = ?tr=sent, the rest = ?status=. Source/cc/หมวด live in ตัวกรอง. */}
        <div
          className="flex flex-wrap gap-1"
          role="tablist"
          aria-label="กรองตามสถานะ"
        >
          {PRIMARY_TABS.map((t) => {
            const active = activePrimary === t.id;
            const count = statusCounts[t.id];
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPrimaryTab(t.id)}
                className={
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-300)] " +
                  (active
                    ? "bg-[var(--color-brand-600)] text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200")
                }
              >
                {t.label}
                {count > 0 && (
                  <span
                    className={
                      "inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums " +
                      (active ? "bg-white/25 text-white" : "bg-white text-zinc-500")
                    }
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Toolbar: search + เรียงลำดับ + the single "ตัวกรอง" button (source/TRCloud/VAT/
            หมวด/สถานะ collapse into ONE popover — no more 5 stacked groups · "filter รก"). */}
        <div className="flex flex-wrap gap-2">
          <form method="GET" className="flex min-w-[180px] flex-1 gap-2">
            {baseParams
              .split("&")
              .filter(Boolean)
              .map((kv) => {
                const [k, v] = kv.split("=");
                if (k === "q") return null;
                return <input key={k} type="hidden" name={k} value={decodeURIComponent(v ?? "")} />;
              })}
            {selectedId && <input type="hidden" name="selected" value={selectedId} />}
            <input
              type="search"
              name="q"
              defaultValue={q ?? ""}
              placeholder="ค้นหา ผู้ขาย / เลขที่ / เลขภาษี"
              className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
            />
            <button
              type="submit"
              className="h-9 shrink-0 rounded-lg bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-800"
            >
              ค้นหา
            </button>
          </form>
          <select
            aria-label="เรียงลำดับ"
            value={sort ?? "date-desc"}
            onChange={(e) => setParam("sort", e.target.value === "date-desc" ? "" : e.target.value)}
            className="h-9 shrink-0 rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-700 outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
          >
            <option value="date-desc">ใหม่ → เก่า</option>
            <option value="date-asc">เก่า → ใหม่</option>
            <option value="amount-desc">ยอดมาก → น้อย</option>
            <option value="amount-asc">ยอดน้อย → มาก</option>
          </select>
          <FilterSheet
            status={status}
            tr={tr}
            cc={cc}
            categoryId={categoryId}
            categories={categories}
            tab={tab}
            onSet={setParam}
            onClear={clearFilters}
            extraActions={listActions}
          />
        </div>

        {/* Context-aware bulk bar — appears when there are actionable rows */}
        {actionableIds.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-zinc-50 px-2 py-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-700">
              <input
                type="checkbox"
                checked={checked.size > 0 && checked.size === actionableIds.length}
                onChange={selectAllActionable}
                className="size-3.5 accent-zinc-700"
              />
              เลือก ({checked.size})
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {selDrafts.length > 0 && (
                <button
                  onClick={runBulkConfirm}
                  disabled={pending}
                  className="inline-flex h-7 items-center gap-1 rounded-lg bg-emerald-600 px-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:bg-zinc-300"
                >
                  {pending ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                  ยืนยัน ({selDrafts.length})
                </button>
              )}
              {selSendable.length > 0 && (
                <button
                  onClick={runBulkSend}
                  disabled={pending}
                  className="inline-flex h-7 items-center gap-1 rounded-lg bg-blue-600 px-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:bg-zinc-300"
                >
                  {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                  ส่งเข้า TRCloud ({selSendable.length})
                </button>
              )}
              {checked.size > 0 && (
                <button
                  type="button"
                  onClick={() => { setDeleteText(""); setConfirmDelete(true); }}
                  disabled={pending}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-rose-200 bg-white px-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" />
                  ลบ ({checked.size})
                </button>
              )}
              {payreqEnabled && checked.size > 0 && (
                <button
                  type="button"
                  onClick={openPayeeDialog}
                  disabled={pending || multiVendor}
                  title={multiVendor ? "เลือกบิลผู้ขายเดียวกันเท่านั้น" : undefined}
                  className="inline-flex h-7 items-center gap-1 rounded-lg bg-[var(--color-brand-600)] px-2 text-xs font-semibold text-white hover:bg-[var(--color-brand-700)] disabled:bg-zinc-300"
                >
                  <Banknote className="size-3.5" />
                  ขอโอนเงิน ({checked.size})
                </button>
              )}
              {payreqEnabled && checkedNeedFix.length > 0 && branches && branches.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setMsg(null); setClassifyOpen(true); }}
                  disabled={pending}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                >
                  <Tags className="size-3.5" />
                  ตั้งสาขา/หมวด ({checkedNeedFix.length})
                </button>
              )}
            </div>
          </div>
        )}
        {payreqEnabled && multiVendor && checked.size > 0 && (
          <p className="px-2 text-[11px] text-amber-600">
            * ขอโอนได้ทีละผู้ขาย — ตอนนี้เลือกหลายผู้ขายอยู่ ({checkedVendors.length})
          </p>
        )}
        {/* Type-"ลบ" guard — bulk delete is destructive, so it needs a deliberate
            second step (CEO: "พิมคำว่าลบอีก กันลบโง่ๆ"). */}
        {confirmDelete && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
            <p className="text-xs font-semibold text-rose-800">
              ลบ {checked.size} รายการที่เลือก?
            </p>
            <p className="mt-0.5 text-[11px] text-rose-600">
              จะเปลี่ยนสถานะเป็น &ldquo;ยกเลิก&rdquo; (ถอดออกจากยอดรวม) · รายการที่ถูกล็อกจะถูกข้าม
            </p>
            <p className="mt-2 text-[11px] font-medium text-zinc-600">
              พิมพ์ <span className="font-bold text-rose-700">ลบ</span> เพื่อยืนยัน
            </p>
            <div className="mt-1 flex items-center gap-1.5">
              <input
                type="text"
                value={deleteText}
                onChange={(e) => setDeleteText(e.target.value)}
                placeholder="พิมพ์ ลบ"
                autoFocus
                className="h-8 w-24 rounded-lg border border-rose-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-rose-200"
              />
              <button
                type="button"
                onClick={runBulkVoid}
                disabled={pending || deleteText.trim() !== "ลบ"}
                className="inline-flex h-8 items-center gap-1 rounded-lg bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-700 disabled:bg-zinc-300"
              >
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                ยืนยันลบ
              </button>
              <button
                type="button"
                onClick={() => { setConfirmDelete(false); setDeleteText(""); }}
                disabled={pending}
                className="inline-flex h-8 items-center rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        )}
        {msg && (
          <p
            className={"text-xs " + (msg.kind === "ok" ? "text-emerald-700" : "text-rose-700")}
            role="status"
            aria-live="polite"
          >
            {msg.text}
          </p>
        )}
      </div>

      {/* ขอโอนเงิน — payee dialog (bottom-sheet on mobile, centered on desktop) */}
      {payeeOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={() => { if (!pending) setPayeeOpen(false); }}
        >
          <div
            className="w-full max-w-md rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="payee-dlg-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="payee-dlg-title" className="text-sm font-bold text-zinc-900">ขอโอนเงิน · {checked.size} ใบ</h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              ระบบจะส่งการ์ดเข้ากลุ่มผู้บริหารให้กดโอน · ใส่บัญชีผู้รับให้ครบ ผู้บริหารจะจ่ายได้เร็วขึ้น
            </p>
            {checkedNeedFix.length > 0 && (
              <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                ⚠️ มี {checkedNeedFix.length} ใบยังไม่ได้ระบุ <b>สาขา/หมวด</b> — ขอโอนได้เฉพาะใบที่ระบุครบ
                {branches && branches.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setPayeeOpen(false); setClassifyOpen(true); }}
                    className="ml-1 inline-flex items-center gap-1 rounded-md bg-amber-600 px-2 py-0.5 font-semibold text-white hover:bg-amber-700"
                  >
                    <Tags className="size-3" /> ตั้งให้เลย
                  </button>
                )}
              </div>
            )}
            <div className="mt-3 space-y-2">
              <input
                value={payee.acctName}
                onChange={(e) => setPayee((p) => ({ ...p, acctName: e.target.value }))}
                placeholder="ชื่อบัญชีผู้รับ"
                className="h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm outline-none focus:ring-2 focus:ring-violet-200"
              />
              <div className="flex gap-2">
                <select
                  value={payee.bankCode}
                  onChange={(e) => setPayee((p) => ({ ...p, bankCode: e.target.value }))}
                  aria-label="ธนาคารผู้รับเงิน"
                  className="h-10 w-36 rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-violet-200"
                >
                  {BANKS.map((b) => (
                    <option key={b.code} value={b.code}>{b.name}</option>
                  ))}
                </select>
                <input
                  value={payee.acctNo}
                  onChange={(e) => setPayee((p) => ({ ...p, acctNo: e.target.value }))}
                  placeholder="เลขบัญชี"
                  inputMode="numeric"
                  className="h-10 flex-1 rounded-lg border border-zinc-200 px-3 text-sm outline-none focus:ring-2 focus:ring-violet-200"
                />
              </div>
              <input
                value={payee.promptpay}
                onChange={(e) => setPayee((p) => ({ ...p, promptpay: e.target.value }))}
                placeholder="พร้อมเพย์ (ถ้ามี — เบอร์/เลขภาษี)"
                inputMode="numeric"
                className="h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm outline-none focus:ring-2 focus:ring-violet-200"
              />
              <p className="text-[11px] text-zinc-400">
                💡 ใส่พร้อมเพย์ (เบอร์/บัตรปชช) เพื่อให้ผู้บริหารสแกน QR จ่ายได้เลย · เลขบัญชีเฉย ๆ จะมีปุ่มคัดลอกให้แทน
              </p>
              {/* แนบรูป QR (พร้อมเพย์/ธนาคาร) — โชว์บนการ์ด LINE ให้ผู้บริหารสแกนจ่าย */}
              <div>
                <p className="mb-1 inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500">
                  <QrCode className="size-3" aria-hidden /> รูป QR (ถ้ามี) — ผู้บริหารสแกนจ่ายจากการ์ดได้เลย
                </p>
                {payee.qrImageUrl ? (
                  <div className="flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={payee.qrImageUrl} alt="QR" className="size-16 rounded-lg border border-zinc-200 object-contain" />
                    <button
                      type="button"
                      onClick={() => setPayee((p) => ({ ...p, qrImageUrl: "" }))}
                      className="text-xs font-medium text-rose-600 hover:underline"
                    >
                      ลบรูป
                    </button>
                  </div>
                ) : (
                  <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
                    {qrUploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                    {qrUploading ? "กำลังอัปโหลด…" : "แนบรูป QR"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={qrUploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadQr(f);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
            {/* Error shows INSIDE the dialog (the list-level msg is hidden behind this
                overlay — otherwise a rejected request looks like a frozen dialog). */}
            {msg && msg.kind === "err" && (
              <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{msg.text}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPayeeOpen(false)}
                disabled={pending}
                className="inline-flex h-9 items-center rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={runRequestTransfer}
                disabled={pending || !canRequest}
                title={!canRequest ? "ต้องระบุสาขา+หมวดทุกใบ + ผู้ขายเดียวกัน ก่อนขอโอน" : undefined}
                className="inline-flex h-9 items-center gap-1 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white hover:bg-violet-700 disabled:bg-zinc-300"
              >
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Banknote className="size-3.5" />}
                ส่งคำขอโอน
              </button>
            </div>
          </div>
        </div>
      )}

      {/* #1 quick-classify dialog — set สาขา/หมวด for the ticked bills in one place */}
      {classifyOpen && branches && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={() => { if (!pending) setClassifyOpen(false); }}
        >
          <div
            className="w-full max-w-md rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="ตั้งสาขาและหมวด"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-zinc-900">
              ตั้งสาขา/หมวด · {checkedNeedFix.length > 0 ? `${checkedNeedFix.length} ใบที่ยังขาด` : `${checked.size} ใบ`}
            </h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              ตั้งทีเดียวให้ทุกใบที่เลือก (ผู้ขายเดียวกันมักสาขาเดียวกัน) แล้วขอโอนต่อได้เลย
            </p>
            <div className="mt-3 space-y-2">
              <select
                value={classify.branchId}
                onChange={(e) => setClassify((c) => ({ ...c, branchId: e.target.value }))}
                aria-label="สาขา"
                className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-amber-200"
              >
                <option value="">— เลือกสาขา —</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.code ? `${b.code} · ${b.name}` : b.name}</option>
                ))}
              </select>
              <select
                value={classify.categoryId}
                onChange={(e) => setClassify((c) => ({ ...c, categoryId: e.target.value }))}
                aria-label="หมวดค่าใช้จ่าย"
                className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-amber-200"
              >
                <option value="">— เลือกหมวด —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setClassifyOpen(false)}
                disabled={pending}
                className="inline-flex h-9 items-center rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={runBulkClassify}
                disabled={pending || (!classify.branchId && !classify.categoryId)}
                className="inline-flex h-9 items-center gap-1 rounded-lg bg-amber-600 px-4 text-xs font-semibold text-white hover:bg-amber-700 disabled:bg-zinc-300"
              >
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Tags className="size-3.5" />}
                ตั้งให้ทุกใบ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List — card-per-row (friendly, scannable on mobile · matches design MCard) */}
      <ul className="max-h-[calc(100dvh-23rem)] space-y-2 overflow-y-auto p-2">
        {rows.length === 0 ? (
          <li>
            {q || status || categoryId || tr || cc || tab !== "all" ? (
              <LedgerEmptyState
                title="ไม่พบรายการตามเงื่อนไข"
                hint="ลองล้างตัวกรอง หรือเปลี่ยนคำค้น"
              />
            ) : (
              <LedgerEmptyState
                title="ยังไม่มีรายจ่าย"
                hint="ส่งรูปใบเสร็จใน LINE หรือกดอัปโหลด แล้วน้องใบเสร็จจะจดให้"
              />
            )}
          </li>
        ) : (
          rows.map((r) => {
            const active = selectedId === r.id;
            const isDraft = r.status === "draft";
            const isSendable = sendableSet.has(r.id);
            const selectable = isDraft || isSendable;
            const isPending = r.trcloudDocId === "pending";
            const pushed = !!r.trcloudDocId && !isPending;
            const pushErr = !pushed && !isPending && !!r.trcloudError;
            // D1 surfacing — show legacy/incomplete rows missing สาขา/หมวด so they
            // can be remediated (some were confirmed before the gate existed).
            const gate = expenseConfirmability({
              branchId: r.branchId,
              categoryId: r.categoryId,
            });
            const confirmedByAcct = !!r.confirmedBy;
            return (
              <li
                key={r.id}
                className={
                  "group flex items-stretch overflow-hidden rounded-xl border bg-white transition " +
                  (active
                    ? "border-[var(--color-brand-300)] shadow-sm"
                    : "border-zinc-100 hover:border-zinc-200 hover:shadow-sm")
                }
              >
                {selectable && (
                  <label className="flex shrink-0 items-center pl-3">
                    <input
                      type="checkbox"
                      checked={checked.has(r.id)}
                      onChange={() => toggle(r.id)}
                      onClick={(e) => e.stopPropagation()}
                      className={"size-4 " + (isDraft ? "accent-emerald-600" : "accent-blue-600")}
                      aria-label={`เลือก ${r.docCode}`}
                    />
                  </label>
                )}
                {/* Column: clickable row (→ detail) + a non-nested chip-rail beneath.
                    The category chip is its own <Link>, so it CANNOT live inside the
                    row <Link> (nested <a> is invalid) — hence the rail is a sibling. */}
                <div className="min-w-0 flex-1">
                  <Link
                    href={rowHref(r.id)}
                    aria-current={active ? "true" : undefined}
                    className={
                      "flex min-w-0 items-center justify-between gap-2 px-3 pb-1 pt-2.5 transition-colors hover:bg-zinc-50 " +
                      (active ? "bg-[var(--color-brand-50)]" : "")
                    }
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {/* จุดสีภาษีซื้อ — โชว์ก็ต่อเมื่อตรวจแล้ว (undecided = ใบเก่า ไม่รก) */}
                        {r.completenessStatus !== "undecided" && (
                          <CompletenessDot
                            status={r.completenessStatus}
                            missing={r.completenessMissing}
                          />
                        )}
                        {isDraft && r.needsReview && (
                          <AlertTriangle
                            className="size-3.5 shrink-0 text-amber-500"
                            aria-label="ต้องตรวจ"
                          />
                        )}
                        <span className="truncate text-sm font-medium text-zinc-800">
                          {r.vendor || "ไม่ระบุผู้ขาย"}
                        </span>
                        {SOURCE_DOT[r.source] && (
                          <span
                            className={"size-1.5 shrink-0 rounded-full " + SOURCE_DOT[r.source].cls}
                            title={SOURCE_DOT[r.source].label}
                            aria-hidden
                          />
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 truncate text-xs text-zinc-400">
                        <span className="font-mono">{r.docCode}</span>
                        {r.docDate && (
                          <span className="tabular-nums">· {r.docDate.slice(5)}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <div className="text-sm font-semibold tabular-nums text-zinc-900">
                        {baht(r.total)}
                      </div>
                      <StatusBadge status={r.status} className="text-[10px]" />
                    </div>
                  </Link>

                  {/* D3 chip-rail / "green zone" — one compact line of status signals.
                      Every coloured chip also carries a text label (a11y). */}
                  <div
                    className={
                      "flex flex-wrap items-center gap-1 px-3 pb-2 " +
                      (active ? "bg-[var(--color-brand-50)]" : "")
                    }
                  >
                    {/* ป้ายเอกสาร/ภาษีซื้อ (D3 pills · รู้จักใบเสนอราคา) + ป้ายจ่ายเงิน.
                        DocTag คืน null เองถ้า undecided (ใบเก่า) → ไม่รก. */}
                    <DocTag
                      docType={r.docType}
                      vat={r.vat}
                      completenessStatus={r.completenessStatus}
                      missing={r.completenessMissing}
                    />
                    {r.paymentStatus && r.paymentStatus !== "paid" && (
                      <PaymentTag status={r.paymentStatus} />
                    )}

                    {/* TRCloud send state */}
                    {isPending && (
                      <span
                        className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
                        title="กำลังส่งเข้า TRCloud..."
                      >
                        <Loader2 className="size-3 animate-spin" /> กำลังส่ง TRCloud
                      </span>
                    )}
                    {pushed && (
                      <span
                        className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700"
                        title={r.trcloudDocNo ? `TRCloud: ${r.trcloudDocNo}` : "ส่งเข้า TRCloud แล้ว"}
                      >
                        <CloudCheck className="size-3" />
                        {r.trcloudDocNo ? `TRCloud ${r.trcloudDocNo}` : "ส่ง TRCloud แล้ว"}
                      </span>
                    )}
                    {pushErr && (
                      <span
                        className="inline-flex items-center gap-0.5 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700"
                      >
                        <AlertTriangle className="size-3" /> ส่ง TRCloud พลาด
                      </span>
                    )}

                    {/* ยืนยันโดย — บัญชีรับรองแล้ว (confirmedBy present) */}
                    {confirmedByAcct && (
                      <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                        <CheckCircle2 className="size-3" /> ยืนยันแล้ว
                      </span>
                    )}

                    {/* D1 confirm-gate warning — สาขา/หมวด ยังไม่ครบ. ทำให้ "แตะแก้ได้เลย"
                        (เปิด dialog ตั้งสาขา/หมวด เฉพาะใบนี้) สำหรับคนที่มีสิทธิ์แก้ —
                        usability win ตามดีไซน์ (chip ที่กดได้ ไม่ใช่แค่ป้ายเตือน). */}
                    {!gate.ok &&
                      (() => {
                        const label =
                          gate.missing.includes("branch") && gate.missing.includes("category")
                            ? "ตั้งสาขา/หมวด"
                            : gate.missing.includes("branch")
                              ? "ตั้งสาขา"
                              : "ตั้งหมวด";
                        return selectable ? (
                          <button
                            type="button"
                            onClick={() => {
                              setMsg(null);
                              setChecked(new Set([r.id]));
                              setClassify({ branchId: "", categoryId: "" });
                              setClassifyOpen(true);
                            }}
                            className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 transition hover:bg-amber-200 active:scale-95"
                          >
                            <AlertTriangle className="size-3" />
                            {label} →
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                            <AlertTriangle className="size-3" />
                            {label}
                          </span>
                        );
                      })()}

                    {/* Inline TRCloud error — visible always (not just hover) */}
                    {pushErr && r.trcloudError && (
                      <span className="w-full text-[10px] text-rose-600 mt-0.5">
                        {r.trcloudError}
                      </span>
                    )}

                    {/* Category chip — links into the category-ledger drill.
                        Its own <Link>, kept OUTSIDE the row <Link> above. */}
                    {r.categoryId && r.categoryName && (
                      <Link
                        href={`/ledger/categories/${r.categoryId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 hover:bg-zinc-200"
                        title={`ดูบัญชีแยกประเภท: ${r.categoryName}`}
                      >
                        {r.categoryName}
                      </Link>
                    )}

                    {/* Per-row ขอโอน — appears on hover (desktop); mobile uses the
                        detail-pane button. Only when classifiable (gate.ok). */}
                    {payreqEnabled && gate.ok && (
                      <button
                        type="button"
                        onClick={() => openPayeeForRow(r)}
                        title="ขอโอนเงินใบนี้"
                        className="ml-auto hidden h-6 shrink-0 items-center gap-1 rounded-md border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] px-1.5 text-[10px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-100)] group-hover:inline-flex"
                      >
                        <Banknote className="size-3" /> ขอโอน
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
