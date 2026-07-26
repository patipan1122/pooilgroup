"use client";

// Left pane of the รายจ่าย workspace: status/category/TRCloud/search filters, a
// scrollable receipt list, and a context-aware bulk bar (ยืนยันร่าง · ส่งเข้า TRCloud).
// All filters are URL-driven (GET form / router.push) so the server page re-reads
// scope on every change.
import { useState, useTransition, useEffect } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Loader2, CheckCircle2, AlertTriangle, Send, CloudCheck, Trash2, Banknote, Tags, Upload, QrCode, FolderOpen, ExternalLink, FileCheck2 } from "lucide-react";
import { StatusBadge } from "@/components/ledger/_kit/StatusBadge";
import { CompletenessDot } from "@/components/ledger/_kit/CompletenessDot";
import { DocTag, PaymentTag } from "@/components/ledger/_kit/StatusTags";
import { LedgerEmptyState } from "@/components/ledger/Brand";
import { SearchableSelect } from "@/components/ledger/SearchableSelect";
import { expenseConfirmability } from "@/lib/ledger/confirmability";
import { trcloudState } from "@/lib/ledger/trcloud-state";
import { trcloudDocUrl } from "@/lib/ledger/trcloud-url";
import {
  bulkConfirm,
  bulkVoid,
  cancelTransfersForExpensesAction,
  sendExpensesToTrcloud,
  convertExpenseToAp,
  convertExpensesToAp,
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
import { ExpenseStatusTabs } from "./ExpenseStatusTabs";
import type { ExpenseRow, LedgerStatusValue } from "@/components/ledger/_kit/types";

// PRIMARY status strip (รอตรวจ/รอยืนยัน/ยืนยันแล้ว/ขอโอน/รอโอน/โอนแล้ว/ทั้งหมด) moved to
// ./ExpenseStatusTabs (CEO 2026-06-09: บนจอคอม = แถบเต็มกว้างด้านบน · มือถือ = ในคอลัมน์นี้
// lg:hidden). The component drives ?status=/?nr=/?pay= exactly as before.

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
  projectId,
  projects,
  tr,
  cc,
  q,
  draftIds,
  sendableIds,
  convertibleIds,
  companyId,
  tab,
  sort,
  nr,
  pay,
  ap,
  pv,
  statusCounts,
  listActions,
  scopePicker,
  payreqEnabled,
  branches,
  isSuperAdmin,
}: {
  rows: ExpenseRow[];
  categories: Array<{ id: string; name: string; color: string | null; sort: number; active?: boolean }>;
  /** สาขา (for the quick-classify dialog — audit P0). */
  branches?: Array<{ id: string; name: string; code?: string | null }>;
  selectedId?: string;
  baseParams: string;
  status?: LedgerStatusValue;
  categoryId?: string;
  /** โครงการที่กรองอยู่ (?project=) — ในตัวกรอง (progressive disclosure). */
  projectId?: string;
  /** ตัวเลือกโครงการ active สำหรับ dropdown ในตัวกรอง. */
  projects?: Array<{ value: string; label: string }>;
  tr?: "sent" | "unsent";
  /** ภาษีซื้อ color filter (?cc=) — green/yellow/red. */
  cc?: "green" | "yellow" | "red";
  q?: string;
  draftIds: string[];
  /** Confirmed/locked rows not yet pushed to TRCloud — eligible for bulk send. */
  sendableIds: string[];
  /** ส่ง PO แล้ว + ยังไม่เป็น AP + มีสาขา/หมวด — เลือกได้เพื่อ "แปลง AP" (bulk). */
  convertibleIds: string[];
  /** Active company scope — passed to bulk actions so they can't cross companies. */
  companyId: string;
  /** D4 source tab (?tab=) — all | line | web | mine (now lives inside ตัวกรอง). */
  tab: ExpenseTab;
  /** เรียงลำดับปัจจุบัน (?sort=) — undefined = "อัจฉริยะ" (งานค้างลอยบนสุด · ค่าเริ่มต้น). */
  sort?: "date-desc" | "date-asc" | "amount-desc" | "amount-asc" | "created-desc";
  /** needsReview filter (?nr=) — true=รอตรวจ · false=รอยืนยัน · undefined=ไม่กรอง. */
  nr?: boolean;
  /** payment-flow tab (?pay=) — eligible=ขอโอนได้ · requested=รอโอน · paid=โอนแล้ว. */
  pay?: "eligible" | "requested" | "paid";
  /** แท็บ "AP แล้ว" active (?ap=1). */
  ap?: boolean;
  /** แท็บ "PV แล้ว" active (?pv=1). */
  pv?: boolean;
  /** Counts for the PRIMARY tabs. status counts = DB; pay counts = list-window. */
  statusCounts: {
    all: number; review: number; draft: number; confirmed: number; sent: number; unsent: number; ap: number;
    eligible: number; requested: number; paid: number; pv: number;
  };
  /** Shortcut actions (ไม่มีใบเสร็จ · สลิปรอจับคู่) — rendered inside the mobile
   *  ตัวกรอง sheet so they're off the page header. */
  listActions?: React.ReactNode;
  /** LeanUX (CEO 2026-06-08): บริษัท/สาขา picker folded into the ตัวกรอง sheet (mobile). */
  scopePicker?: React.ReactNode;
  /** LEDGER_PAYREQ_V1 — show the "ขอโอนเงิน" bulk action (request a transfer). */
  payreqEnabled?: boolean;
  /** Pool super_admin — may delete/cancel money-touched bills (ขอโอนอยู่/โอนแล้ว). */
  isSuperAdmin?: boolean;
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
  const convertibleSet = new Set(convertibleIds);
  const selDrafts = [...checked].filter((id) => draftSet.has(id));
  const selSendable = [...checked].filter((id) => sendableSet.has(id));
  const selConvertible = [...checked].filter((id) => convertibleSet.has(id));
  // draft / sendable(ยังไม่ส่ง) / convertible(ส่ง PO แล้ว ยังไม่ AP) แยกกัน ไม่ทับกัน (สถานะคนละช่วง).
  const actionableIds = [...draftIds, ...sendableIds, ...convertibleIds];

  // Request-transfer selection guards: bills must share ONE vendor (the payee is
  // a single account). The list is already company-scoped, so cross-company can't
  // happen here; the server re-validates company + vendor anyway.
  const checkedRows = rows.filter((r) => checked.has(r.id));
  // CEO 2026-07-26 — ใบที่ "มีเรื่องเงิน" (ขอโอนอยู่ / โอนแล้ว) ลบได้เฉพาะ superadmin.
  // requested = มีคำขอโอนค้าง (ต้องยกเลิกก่อนลบ) · paid = โอนแล้ว (ลบทีละใบ).
  const checkedRequested = checkedRows.filter((r) => r.payState === "requested");
  const checkedPaid = checkedRows.filter((r) => r.payState === "paid");
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
  // ขอโอนต้องมี "ปลายทางเงิน" อย่างน้อย 1 อย่าง (เลขบัญชี / พร้อมเพย์ / รูป QR) — กันขอโอนลอย
  // ที่ผู้บริหารได้การ์ดแต่ไม่รู้จะโอนเข้าไหน (D-2026-07-09 CEO report).
  const payeeHasAccount =
    payee.acctNo.trim().length > 0 || payee.promptpay.trim().length > 0 || Boolean(payee.qrImageUrl);

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
    sp.delete("ap");
    sp.delete("pv");
    sp.delete("cc");
    sp.delete("category");
    sp.delete("project");
    sp.delete("tab");
    sp.delete("nr");
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
        if (res.quotationsSent) parts.push(`รวมใบเสนอราคา ${res.quotationsSent} (ขอคืน VAT ไม่ได้)`);
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

  // แปลง PO → AP หลายใบ (ปุ่มรวมด้านบน) — ใช้ action ที่วน runApConversion (idempotent + guard หมวด).
  function runBulkConvert() {
    if (selConvertible.length === 0) return;
    setMsg(null);
    startTransition(async () => {
      const res = await convertExpensesToAp(selConvertible, companyId);
      if (res.ok) {
        const parts = [`แปลงเป็น AP ${res.converted ?? 0} ใบ`];
        if (res.skipped) parts.push(`ข้าม ${res.skipped}`);
        if (res.failed) parts.push(`พลาด ${res.failed}`);
        setMsg({ kind: res.failed ? "err" : "ok", text: parts.join(" · ") });
        setChecked(new Set());
        router.refresh();
      } else {
        setMsg({ kind: "err", text: res.error ?? "แปลงเป็น AP ไม่สำเร็จ" });
      }
    });
  }

  // แปลง PO → AP ใบเดียว (ปุ่มลัดในแถว ข้างปุ่มขอโอน).
  function runRowConvert(id: string) {
    setMsg(null);
    startTransition(async () => {
      const res = await convertExpenseToAp(id);
      if (res.ok) {
        setMsg({
          kind: "ok",
          text: res.alreadyAp
            ? "ใบนี้เป็น AP อยู่แล้ว"
            : `แปลงเป็น AP แล้ว${res.apDocNo ? ` · ${res.apDocNo}` : ""}`,
        });
        router.refresh();
      } else {
        setMsg({ kind: "err", text: res.error ?? "แปลงเป็น AP ไม่สำเร็จ" });
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
        setMsg({ kind: "ok", text: `ตั้งสาขา/หมวดให้ ${res.updated ?? 0} ใบแล้ว ขอโอนต่อได้เลย` });
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
      setMsg({ kind: "err", text: "อัปโหลด QR ไม่สำเร็จ ลองใหม่อีกครั้ง" });
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

  // CEO 2026-07-26 — superadmin ปลดล็อกใบที่ "ขอโอนอยู่" (ยกเลิกคำขอโอน) เพื่อให้ลบต่อได้.
  function runCancelTransfers() {
    const ids = checkedRequested.map((r) => r.id);
    if (ids.length === 0) return;
    setMsg(null);
    startTransition(async () => {
      const res = await cancelTransfersForExpensesAction(ids, companyId);
      if (res.ok) {
        setMsg({ kind: "ok", text: `ยกเลิกคำขอโอน ${res.cancelled ?? 0} คำขอแล้ว — กด "ลบ" ต่อได้เลย` });
        router.refresh();
      } else {
        setMsg({ kind: "err", text: res.error ?? "ยกเลิกไม่สำเร็จ" });
      }
    });
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white">
      {/* Sticky filter header */}
      <div className="sticky top-14 z-20 space-y-2 rounded-t-2xl border-b border-zinc-200 bg-white p-3 sm:top-16">
        {/* LeanUX (CEO 2026-06-08 "filter ควร ~10% ของจอ"): แท็บสถานะ (เลื่อนแนวนอน) +
            ปุ่ม "ตัวกรอง" อยู่แถวเดียว. ค้นหา=ข้างหัว(header) · เรียงลำดับ+source/VAT/หมวด=ในตัวกรอง. */}
        <div className="flex items-center gap-2">
          {/* Desktop: these tabs live in the full-width bar above the grid (page.tsx).
              Mobile: keep them here in the list column. */}
          <ExpenseStatusTabs
            baseParams={baseParams}
            status={status}
            tr={tr}
            ap={ap}
            pv={pv}
            nr={nr}
            pay={pay}
            payreqEnabled={payreqEnabled}
            statusCounts={statusCounts}
            selectedId={selectedId}
            className="flex-1 lg:hidden"
          />
          <div className="shrink-0">
            <FilterSheet
              status={status}
              tr={tr}
              cc={cc}
              categoryId={categoryId}
              categories={categories}
              projectId={projectId}
              projects={projects}
              tab={tab}
              sort={sort}
              onSet={setParam}
              onClear={clearFilters}
              extraActions={listActions}
              scopePicker={scopePicker}
            />
          </div>
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
                  className="press inline-flex h-7 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
                >
                  {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <CheckCircle2 className="size-3.5" aria-hidden />}
                  ยืนยัน ({selDrafts.length})
                </button>
              )}
              {selSendable.length > 0 && (
                <button
                  onClick={runBulkSend}
                  disabled={pending}
                  className="press inline-flex h-7 items-center gap-1 rounded-lg bg-blue-600 px-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
                >
                  {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
                  ส่งเข้า TRCloud ({selSendable.length})
                </button>
              )}
              {selConvertible.length > 0 && (
                <button
                  onClick={runBulkConvert}
                  disabled={pending}
                  title="แปลงใบสั่งซื้อ (PO) ที่เลือกเป็นใบกำกับภาษีซื้อ (AP) — ลงบัญชีอัตโนมัติ ให้บัญชี approve"
                  className="press inline-flex h-7 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
                >
                  {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FileCheck2 className="size-3.5" aria-hidden />}
                  แปลง AP ({selConvertible.length})
                </button>
              )}
              {isSuperAdmin && checkedRequested.length > 0 && (
                <button
                  type="button"
                  onClick={runCancelTransfers}
                  disabled={pending}
                  title="ยกเลิกคำขอโอนของใบที่เลือก เพื่อปลดล็อกให้ลบได้"
                  className="press inline-flex h-7 items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                >
                  {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Banknote className="size-3.5" aria-hidden />}
                  ยกเลิกคำขอโอน ({checkedRequested.length})
                </button>
              )}
              {checked.size > 0 && (
                <button
                  type="button"
                  onClick={() => { setDeleteText(""); setConfirmDelete(true); }}
                  disabled={pending}
                  className="press inline-flex h-7 items-center gap-1 rounded-lg border border-rose-200 bg-white px-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  ลบ ({checked.size})
                </button>
              )}
              {payreqEnabled && checked.size > 0 && (
                <button
                  type="button"
                  onClick={openPayeeDialog}
                  disabled={pending || multiVendor}
                  title={multiVendor ? "เลือกบิลผู้ขายเดียวกันเท่านั้น" : undefined}
                  className="press inline-flex h-7 items-center gap-1 rounded-lg bg-[var(--color-brand-600)] px-2.5 text-xs font-semibold text-white hover:bg-[var(--color-brand-700)] disabled:cursor-not-allowed disabled:bg-zinc-300"
                >
                  <Banknote className="size-3.5" aria-hidden />
                  ขอโอนเงิน ({checked.size})
                </button>
              )}
              {payreqEnabled && checkedNeedFix.length > 0 && branches && branches.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setMsg(null); setClassifyOpen(true); }}
                  disabled={pending}
                  className="press inline-flex h-7 items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                >
                  <Tags className="size-3.5" aria-hidden />
                  ตั้งสาขา/หมวด ({checkedNeedFix.length})
                </button>
              )}
            </div>
          </div>
        )}
        {payreqEnabled && multiVendor && checked.size > 0 && (
          <p className="px-2 text-[11px] font-medium text-amber-700">
            * ขอโอนได้ทีละผู้ขาย (ตอนนี้เลือกหลายผู้ขายอยู่ {checkedVendors.length} ราย)
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
            {(checkedRequested.length > 0 || checkedPaid.length > 0) && (
              <p className="mt-1 text-[11px] font-medium text-amber-700">
                {checkedRequested.length > 0 &&
                  `· ${checkedRequested.length} ใบมีคำขอโอนค้าง — ${isSuperAdmin ? "กด “ยกเลิกคำขอโอน” ก่อน" : "ต้องให้ superadmin ลบ"} (จะถูกข้าม)`}
                {checkedPaid.length > 0 && ` · ${checkedPaid.length} ใบโอนแล้ว — ลบทีละใบ (เฉพาะ superadmin)`}
              </p>
            )}
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
                className="press inline-flex h-8 items-center gap-1 rounded-lg bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
              >
                {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Trash2 className="size-3.5" aria-hidden />}
                ยืนยันลบ
              </button>
              <button
                type="button"
                onClick={() => { setConfirmDelete(false); setDeleteText(""); }}
                disabled={pending}
                className="press inline-flex h-8 items-center rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        )}
        {msg && (
          <p
            className={
              "rounded-lg px-2.5 py-1.5 text-xs font-medium animate-fade-in " +
              (msg.kind === "ok"
                ? "bg-emerald-50 text-emerald-700"
                : "bg-rose-50 text-rose-700")
            }
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
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 animate-fade-in sm:items-center sm:p-4"
          onClick={() => { if (!pending) setPayeeOpen(false); }}
        >
          <div
            className="w-full max-w-md rounded-t-2xl bg-white p-4 shadow-xl animate-slide-up-soft sm:rounded-2xl sm:animate-scale-in"
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
                ⚠️ มี {checkedNeedFix.length} ใบยังไม่ได้ระบุ <b>สาขา/หมวด</b> (ขอโอนได้เฉพาะใบที่ระบุครบ)
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
                placeholder="พร้อมเพย์ (ถ้ามี · เบอร์/เลขภาษี)"
                inputMode="numeric"
                className="h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm outline-none focus:ring-2 focus:ring-violet-200"
              />
              <p className="text-[11px] leading-snug text-zinc-500">
                💡 ใส่พร้อมเพย์ (เบอร์/บัตรปชช) เพื่อให้ผู้บริหารสแกน QR จ่ายได้เลย · เลขบัญชีเฉย ๆ จะมีปุ่มคัดลอกให้แทน
              </p>
              {/* แนบรูป QR (พร้อมเพย์/ธนาคาร) — โชว์บนการ์ด LINE ให้ผู้บริหารสแกนจ่าย */}
              <div>
                <p className="mb-1 inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500">
                  <QrCode className="size-3" aria-hidden /> รูป QR (ถ้ามี) ผู้บริหารสแกนจ่ายจากการ์ดได้เลย
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
                  <label className="press inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
                    {qrUploading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Upload className="size-3.5" aria-hidden />}
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
                className="press inline-flex h-9 items-center rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={runRequestTransfer}
                disabled={pending || !canRequest || !payeeHasAccount}
                title={
                  !canRequest
                    ? "ต้องระบุสาขา+หมวดทุกใบ + ผู้ขายเดียวกัน ก่อนขอโอน"
                    : !payeeHasAccount
                      ? "ต้องใส่เลขบัญชี / พร้อมเพย์ หรือแนบ QR ผู้รับ ก่อนขอโอน"
                      : undefined
                }
                className="press inline-flex h-9 items-center gap-1 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
              >
                {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Banknote className="size-3.5" aria-hidden />}
                ส่งคำขอโอน
              </button>
            </div>
          </div>
        </div>
      )}

      {/* #1 quick-classify dialog — set สาขา/หมวด for the ticked bills in one place */}
      {classifyOpen && branches && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 animate-fade-in sm:items-center sm:p-4"
          onClick={() => { if (!pending) setClassifyOpen(false); }}
        >
          <div
            className="w-full max-w-md rounded-t-2xl bg-white p-4 shadow-xl animate-slide-up-soft sm:rounded-2xl sm:animate-scale-in"
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
            <div className="mt-3 space-y-3">
              <SearchableSelect
                options={(branches ?? []).map((b) => ({
                  id: b.id,
                  name: b.code ? `${b.code} · ${b.name}` : b.name,
                }))}
                value={classify.branchId}
                onChange={(id) => setClassify((c) => ({ ...c, branchId: id }))}
                placeholder="— เลือกสาขา —"
                searchPlaceholder="ค้นหาสาขา..."
                selectClassName="focus:ring-amber-200"
              />
              <SearchableSelect
                options={categories.filter((c) => c.active !== false)}
                value={classify.categoryId}
                onChange={(id) => setClassify((c) => ({ ...c, categoryId: id }))}
                placeholder="— เลือกหมวด —"
                searchPlaceholder="ค้นหาหมวด..."
                selectClassName="focus:ring-amber-200"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setClassifyOpen(false)}
                disabled={pending}
                className="press inline-flex h-9 items-center rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={runBulkClassify}
                disabled={pending || (!classify.branchId && !classify.categoryId)}
                className="press inline-flex h-9 items-center gap-1 rounded-lg bg-amber-600 px-4 text-xs font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
              >
                {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Tags className="size-3.5" aria-hidden />}
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
            const isConvertible = convertibleSet.has(r.id);
            const selectable = isDraft || isSendable || isConvertible;
            // TRCloud state from the shared classifier — "error" is a FAILED push,
            // NOT sent (the old `!!trcloudDocId` lit the blue "ส่งแล้ว" chip on failures).
            const trState = trcloudState(r.trcloudDocId);
            const isPending = trState === "pending";
            const pushed = trState === "sent";
            const pushErr = trState === "error";
            // เปิดใน TRCloud — ลิงก์ตรงไป AP (ถ้าแปลงแล้ว) ไม่งั้น PO ที่ push. null = ไม่มี id ตัวเลข.
            const trcloudUrl = pushed
              ? trcloudDocUrl({ apDocId: r.trcloudApDocId, poDocId: r.trcloudDocId })
              : null;
            // D1 surfacing — show legacy/incomplete rows missing สาขา/หมวด so they
            // can be remediated (some were confirmed before the gate existed).
            const gate = expenseConfirmability({
              branchId: r.branchId,
              categoryId: r.categoryId,
            });
            return (
              <li
                key={r.id}
                className={
                  "group flex items-stretch overflow-hidden rounded-xl border bg-white transition animate-fade-in " +
                  (active
                    ? "border-[var(--color-brand-300)] shadow-sm ring-1 ring-[var(--color-brand-200)]"
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
                      <div className="flex items-center gap-1.5 truncate text-xs text-zinc-500">
                        {/* ชื่อเรียกใบที่ผู้ใช้ตั้งเอง โชว์แทนรหัส (มี=ชื่อธรรมดา · ไม่มี=รหัส font-mono) */}
                        <span className={r.title ? "truncate font-medium text-zinc-600" : "font-mono tabular-nums"}>
                          {r.title || r.docCode}
                        </span>
                        {r.docDate && (
                          <span className="shrink-0 tabular-nums">· {r.docDate.slice(5)}</span>
                        )}
                      </div>
                      {/* มีชื่อเรียกแล้ว → ยังโชว์รหัสใบตัวเล็กไว้ให้ตามเอกสารเจอ. */}
                      {r.title ? (
                        <div className="truncate font-mono text-xs text-zinc-500">{r.docCode}</div>
                      ) : null}
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
                    {/* ซ่อน "ยังไม่จ่าย" เมื่อมีป้าย payState (ขอโอน/รอโอน/โอนแล้ว) อยู่แล้ว —
                        สื่อสถานะจ่ายซ้ำกัน (CEO 2026-06-10 ลด chip ล้น). */}
                    {r.paymentStatus &&
                      r.paymentStatus !== "paid" &&
                      !(payreqEnabled && r.payState != null) && (
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
                      <>
                        <span
                          className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700"
                          title={
                            r.trcloudApDocId
                              ? `AP: ${r.trcloudApDocNo ?? "แปลงแล้ว"}`
                              : r.trcloudDocNo
                                ? `TRCloud: ${r.trcloudDocNo}`
                                : "ส่งเข้า TRCloud แล้ว"
                          }
                        >
                          <CloudCheck className="size-3" />
                          {r.trcloudApDocId
                            ? r.trcloudApDocNo
                              ? `AP ${r.trcloudApDocNo}`
                              : "AP แล้ว"
                            : r.trcloudDocNo
                              ? `TRCloud ${r.trcloudDocNo}`
                              : "ส่ง TRCloud แล้ว"}
                        </span>
                        {trcloudUrl && (
                          <a
                            href={trcloudUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title="เปิดเอกสารใน TRCloud"
                            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-100"
                          >
                            <ExternalLink className="size-3" /> เปิดใน TRCloud
                          </a>
                        )}
                      </>
                    )}
                    {pushErr && (
                      <span
                        className="inline-flex items-center gap-0.5 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700"
                      >
                        <AlertTriangle className="size-3" /> ส่ง TRCloud พลาด
                      </span>
                    )}

                    {/* "ยืนยันแล้ว" ลบจาก rail — StatusBadge มุมขวาบนของการ์ดโชว์สถานะนี้แล้ว
                        (CEO 2026-06-10 ลด chip ซ้ำ). */}

                    {/* D1 confirm-gate warning — สาขา/หมวด ยังไม่ครบ. ทำให้ "แตะแก้ได้เลย"
                        (เปิด dialog ตั้งสาขา/หมวด เฉพาะใบนี้) สำหรับคนที่มีสิทธิ์แก้ —
                        usability win ตามดีไซน์ (chip ที่กดได้ ไม่ใช่แค่ป้ายเตือน). */}
                    {!gate.ok &&
                      r.payState == null &&
                      (() => {
                        const fix =
                          gate.missing.includes("branch") && gate.missing.includes("category")
                            ? "ตั้งสาขา/หมวด"
                            : gate.missing.includes("branch")
                              ? "ตั้งสาขา"
                              : "ตั้งหมวด";
                        // payreq ON → ป้ายแดง "ขอโอนไม่ได้" (CEO: ขอไม่ได้=แดง) ที่กดแล้วไปตั้งให้ครบ.
                        const label = payreqEnabled ? `ขอโอนไม่ได้ · ${fix}` : fix;
                        const tone = payreqEnabled
                          ? "bg-rose-100 text-rose-700 hover:bg-rose-200"
                          : "bg-amber-100 text-amber-800 hover:bg-amber-200";
                        return selectable ? (
                          <button
                            type="button"
                            onClick={() => {
                              setMsg(null);
                              setChecked(new Set([r.id]));
                              setClassify({ branchId: "", categoryId: "" });
                              setClassifyOpen(true);
                            }}
                            className={
                              "ml-auto inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold transition active:scale-95 " +
                              tone
                            }
                          >
                            <AlertTriangle className="size-3" />
                            {label} →
                          </button>
                        ) : (
                          <span
                            className={
                              "ml-auto inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold " +
                              (payreqEnabled ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800")
                            }
                          >
                            <AlertTriangle className="size-3" />
                            {label}
                          </span>
                        );
                      })()}

                    {/* Inline TRCloud error — visible always (not just hover) */}
                    {pushErr && r.trcloudError && (
                      <span className="mt-0.5 w-full text-[10px] font-medium text-rose-700">
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

                    {/* โครงการ chip — read-only tag (brand-blue). โชว์เมื่อบิลผูกโครงการ. */}
                    {r.projectId && r.projectName && (
                      <span
                        className="inline-flex items-center gap-0.5 rounded bg-[var(--color-brand-50)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-brand-700)]"
                        title={`โครงการ: ${r.projectName}`}
                      >
                        <FolderOpen className="size-2.5" aria-hidden />
                        {r.projectName}
                      </span>
                    )}

                    {/* actions ฝั่งขวา (ชิดขวา · กลุ่มเดียว): แปลง AP (ลงบัญชี) + ขอโอน (จ่ายเงิน) —
                        CEO 2026-07-22 ปุ่มลัดแปลง AP ข้างปุ่มขอโอน. โอนแล้ว(เขียวเข้ม)/รอโอน(ฟ้า)/
                        ขอโอน(เขียว=ขอได้). ขอไม่ได้(แดง=ขาดสาขา/หมวด)=ป้าย classify ด้านบนแยกไว้แล้ว. */}
                    {(() => {
                      const showConvert = isConvertible;
                      const showPay =
                        payreqEnabled &&
                        (r.payState === "paid" || r.payState === "requested" || gate.ok);
                      if (!showConvert && !showPay) return null;
                      return (
                        <div className="ml-auto flex shrink-0 items-center gap-1">
                          {showConvert && (
                            <button
                              type="button"
                              onClick={() => runRowConvert(r.id)}
                              disabled={pending}
                              title="แปลงใบสั่งซื้อ (PO) นี้เป็นใบกำกับภาษีซื้อ (AP) — ลงบัญชีอัตโนมัติ ให้บัญชี approve"
                              className="press inline-flex h-6 items-center gap-1 rounded-md bg-emerald-600 px-1.5 text-[10px] font-bold text-white hover:bg-emerald-700 disabled:bg-zinc-300"
                            >
                              {pending ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <FileCheck2 className="size-3" aria-hidden />} แปลง AP
                            </button>
                          )}
                          {payreqEnabled &&
                            (r.payState === "paid" ? (
                              <span className="inline-flex h-6 items-center gap-1 rounded-md bg-emerald-100 px-1.5 text-[10px] font-bold text-emerald-700">
                                <CheckCircle2 className="size-3" /> โอนแล้ว
                              </span>
                            ) : r.payState === "requested" ? (
                              <span className="inline-flex h-6 items-center gap-1 rounded-md bg-blue-100 px-1.5 text-[10px] font-bold text-blue-700">
                                <Banknote className="size-3" /> รอโอน
                              </span>
                            ) : gate.ok ? (
                              <button
                                type="button"
                                onClick={() => openPayeeForRow(r)}
                                title="ขอโอนเงินใบนี้"
                                className="press inline-flex h-6 items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-1.5 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100"
                              >
                                <Banknote className="size-3" aria-hidden /> ขอโอน
                              </button>
                            ) : null)}
                        </div>
                      );
                    })()}
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
