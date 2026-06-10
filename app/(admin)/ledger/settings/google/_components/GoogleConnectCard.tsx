"use client";

// LedgerLine · "เชื่อมต่อ Google" — Drive + Gmail multi-mailbox per company.
// Email section gated by LEDGER_EMAIL_SCAN_V1. Filter panel per mailbox:
// (1) allow-list senders  (2) block-list senders  (3) Gmail label  (4) subject keywords.
// Default = all empty → scan everything (smart filter: no promos/social + has:attachment).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Mail,
  CloudUpload,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Plus,
  Unplug,
  ShieldCheck,
  RefreshCw,
  SlidersHorizontal,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  startLedgerGmailConnect,
  startLedgerDriveConnect,
  disconnectLedgerMailbox,
  scanMailboxNow,
  updateMailboxFilters,
} from "../_actions";
import type { LedgerMailbox } from "@/lib/ledger/gmail";

type Props = {
  companyId: string;
  companyName: string;
  driveConnected: boolean;
  driveEmail: string | null;
  mailboxes: LedgerMailbox[];
  emailScanEnabled: boolean;
};

type FilterDraft = {
  senders: string[];
  suppressed: string[];
  label: string;
  keywords: string[];
};

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">{children}</div>
  );
}

function ChipList({
  items,
  onRemove,
  emptyLabel,
  colorClass = "bg-white border border-zinc-200 text-zinc-800",
}: {
  items: string[];
  onRemove: (s: string) => void;
  emptyLabel: string;
  colorClass?: string;
}) {
  if (items.length === 0) {
    return <span className="text-xs italic text-zinc-400">{emptyLabel}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((s) => (
        <span
          key={s}
          className={cn(
            "inline-flex items-center gap-1 rounded-full pl-2.5 pr-1.5 py-1 text-xs font-medium",
            colorClass,
          )}
        >
          {s}
          <button
            type="button"
            onClick={() => onRemove(s)}
            title={`ลบ ${s}`}
            className="ml-0.5 grid size-4 place-items-center rounded-full bg-zinc-100 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800"
          >
            <X className="size-2.5" />
          </button>
        </span>
      ))}
    </div>
  );
}

function ChipInput({
  value,
  onChange,
  onAdd,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onAdd: () => void;
  placeholder: string;
}) {
  return (
    <div className="flex gap-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAdd(); } }}
        placeholder={placeholder}
        className="h-9 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-base sm:text-xs focus:border-[var(--color-brand-400)] focus:outline-none"
      />
      <button
        type="button"
        onClick={onAdd}
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
      >
        <Plus className="size-3.5" />
        เพิ่ม
      </button>
    </div>
  );
}

export function GoogleConnectCard({
  companyId,
  companyName,
  driveConnected,
  driveEmail,
  mailboxes,
  emailScanEnabled,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  // filter panel state
  const [filterOpen, setFilterOpen] = useState<string | null>(null);
  const [filterDraft, setFilterDraft] = useState<FilterDraft>({
    senders: [], suppressed: [], label: "", keywords: [],
  });
  const [inputs, setInputs] = useState({ sender: "", suppressed: "", keyword: "" });
  const [labelGuideOpen, setLabelGuideOpen] = useState(false);
  const [filterSaving, setFilterSaving] = useState(false);

  function go(key: string, fn: () => Promise<{ ok: true; url: string } | { ok: false; error: string }>) {
    setError(null);
    setBusyKey(key);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) window.location.href = res.url;
      else { setError(res.error); setBusyKey(null); }
    });
  }

  function disconnect(id: string) {
    setError(null);
    setBusyKey(`disc:${id}`);
    startTransition(async () => {
      const res = await disconnectLedgerMailbox(id);
      if (!res.ok) setError(res.error);
      setBusyKey(null);
      router.refresh();
    });
  }

  function scanNow(id: string) {
    setError(null);
    setScanMsg(null);
    setBusyKey(`scan:${id}`);
    startTransition(async () => {
      const res = await scanMailboxNow(id);
      if (res.ok) {
        const total = res.imported + res.needsManual;
        setScanMsg(
          total > 0
            ? `สแกนเสร็จ — เจอ ${total} ใบ${res.needsManual ? ` (${res.needsManual} ใบต้องกรอกเอง)` : ""} เข้าไปรอตรวจแล้ว`
            : "สแกนเสร็จ — ยังไม่เจอใบเสร็จใหม่",
        );
      } else {
        setError(res.error);
      }
      setBusyKey(null);
      router.refresh();
    });
  }

  function openFilter(m: LedgerMailbox) {
    setFilterOpen(m.id);
    setFilterDraft({
      senders: [...m.filterSenders],
      suppressed: [...m.suppressedSenders],
      label: m.gmailLabel ?? "",
      keywords: [...m.filterKeywords],
    });
    setInputs({ sender: "", suppressed: "", keyword: "" });
    setLabelGuideOpen(false);
    setError(null);
  }

  function addItem(field: keyof FilterDraft, val: string) {
    const v = val.trim().toLowerCase();
    if (!v) return;
    setFilterDraft((d) => ({
      ...d,
      [field]: (d[field] as string[]).includes(v) ? d[field] : [...(d[field] as string[]), v],
    }));
    setInputs((i) => ({ ...i, [field === "senders" ? "sender" : field === "suppressed" ? "suppressed" : "keyword"]: "" }));
  }

  function removeItem(field: keyof FilterDraft, val: string) {
    setFilterDraft((d) => ({ ...d, [field]: (d[field] as string[]).filter((x) => x !== val) }));
  }

  async function saveFilter(connectionId: string) {
    setFilterSaving(true);
    const res = await updateMailboxFilters(connectionId, {
      filterSenders: filterDraft.senders,
      suppressedSenders: filterDraft.suppressed,
      gmailLabel: filterDraft.label.trim() || null,
      filterKeywords: filterDraft.keywords,
    });
    setFilterSaving(false);
    if (!res.ok) { setError(res.error); return; }
    setFilterOpen(null);
    router.refresh();
  }

  const filterSectionClass = "pt-2.5 space-y-2";
  const sectionLabelClass = "text-xs font-semibold text-zinc-600";
  const sectionHintClass = "text-xs text-zinc-400 leading-relaxed";

  return (
    <div className="space-y-4">
      {/* privacy note */}
      <div className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        <p>
          เชื่อมแบบ <b>อ่านอย่างเดียว</b> — ดึงเฉพาะใบเสร็จตามตัวกรอง ไม่ลบ ไม่แก้ ไม่ส่งเมล
          · ยกเลิกได้ทุกเมื่อ (อาจเจอหน้าเตือน "ยังไม่ยืนยันแอป" — กด "ดำเนินการต่อ" ได้เลย)
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl bg-rose-50 px-3.5 py-3 text-sm text-rose-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {scanMsg && (
        <div className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>{scanMsg}</span>
        </div>
      )}

      {/* Google Drive */}
      <Card>
        <div className="mb-1 flex items-center gap-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-600">
            <CloudUpload className="size-5" />
          </span>
          <div>
            <h2 className="text-sm font-bold text-zinc-800">Google Drive — เก็บไฟล์ใบเสร็จ</h2>
            <p className="text-xs text-zinc-500">สำรองรูป/ไฟล์ใบเสร็จเข้าไดรฟ์อัตโนมัติ (ใช้ร่วมทั้งองค์กร)</p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          {driveConnected ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
              <CheckCircle2 className="size-4" />
              เชื่อมแล้ว{driveEmail ? ` · ${driveEmail}` : ""}
            </span>
          ) : (
            <span className="text-sm text-zinc-500">ยังไม่เชื่อม</span>
          )}
          <button
            type="button"
            onClick={() => go("drive", () => startLedgerDriveConnect(companyId))}
            disabled={pending}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition disabled:opacity-50",
              driveConnected ? "border border-zinc-200 text-zinc-700 hover:bg-zinc-50" : "bg-zinc-900 text-white hover:bg-zinc-800",
            )}
          >
            {busyKey === "drive" ? <Loader2 className="size-4 animate-spin" /> : <CloudUpload className="size-4" />}
            {driveConnected ? "เชื่อมใหม่" : "เชื่อมต่อ Drive"}
          </button>
        </div>
      </Card>

      {/* Gmail mailboxes */}
      <Card>
        <div className="mb-1 flex items-center gap-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--color-brand-50)] text-[var(--color-brand-600)]">
            <Mail className="size-5" />
          </span>
          <div>
            <h2 className="text-sm font-bold text-zinc-800">Gmail — ดึงค่าใช้จ่ายจากอีเมล</h2>
            <p className="text-xs text-zinc-500">เชื่อมตู้เมลการเงินของ {companyName} · เพิ่มได้หลายเมล</p>
          </div>
        </div>

        {!emailScanEnabled ? (
          <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-700">
            ฟีเจอร์ดึงค่าใช้จ่ายจากอีเมลกำลังพัฒนา
          </p>
        ) : (
          <>
            {mailboxes.length > 0 ? (
              <ul className="mt-3 divide-y divide-zinc-100">
                {mailboxes.map((m) => {
                  const filterCount =
                    m.filterSenders.length + m.suppressedSenders.length +
                    (m.gmailLabel ? 1 : 0) + m.filterKeywords.length;
                  return (
                    <li key={m.id} className="py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-zinc-800">{m.gmailEmail}</p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                            {m.active ? (
                              <span className="inline-flex items-center gap-1 text-emerald-600">
                                <CheckCircle2 className="size-3" /> เชื่อมอยู่
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-rose-600">
                                <AlertTriangle className="size-3" /> ต้องเชื่อมใหม่
                              </span>
                            )}
                            {filterCount > 0 ? (
                              <span>{filterCount} ตัวกรอง</span>
                            ) : (
                              <span className="text-zinc-400">ไม่มีตัวกรอง — สแกนทุกเมลใบเสร็จ</span>
                            )}
                            {m.lastSyncAt && (
                              <span>สแกนล่าสุด {new Date(m.lastSyncAt).toLocaleDateString("th-TH")}</span>
                            )}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => filterOpen === m.id ? setFilterOpen(null) : openFilter(m)}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
                              filterOpen === m.id
                                ? "border-[var(--color-brand-300)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
                                : "border-zinc-200 text-zinc-600 hover:bg-zinc-50",
                            )}
                          >
                            <SlidersHorizontal className="size-3.5" />
                            ตัวกรอง
                          </button>
                          <button
                            type="button"
                            onClick={() => scanNow(m.id)}
                            disabled={pending}
                            className="inline-flex items-center gap-1 rounded-lg bg-[var(--color-brand-600)] px-2.5 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                          >
                            {busyKey === `scan:${m.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                            สแกนเลย
                          </button>
                          <button
                            type="button"
                            onClick={() => disconnect(m.id)}
                            disabled={pending}
                            className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-50"
                          >
                            {busyKey === `disc:${m.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <Unplug className="size-3.5" />}
                            ยกเลิก
                          </button>
                        </div>
                      </div>

                      {/* expandable filter panel */}
                      {filterOpen === m.id && (
                        <div className="mt-2.5 rounded-xl border border-zinc-200 bg-zinc-50 p-3.5 space-y-3">
                          <p className={sectionHintClass}>
                            <b className="text-zinc-700">ค่าเริ่มต้น = ว่างเปล่า</b> — ระบบสแกนทุกเมลใบเสร็จ (ยกเว้นโฆษณา/โซเชียล)
                            ตั้งค่าเพิ่มตามต้องการ หรือปล่อยว่างแล้วดูผลก่อน
                          </p>

                          {/* ── SECTION 1: allow-list senders ── */}
                          <div className={filterSectionClass}>
                            <p className={sectionLabelClass}>เฉพาะผู้ส่ง (allow-list)</p>
                            <p className={sectionHintClass}>ถ้าระบุ — ดึงเฉพาะจาก sender เหล่านี้ · ว่าง = ดึงทุก sender</p>
                            <ChipList
                              items={filterDraft.senders}
                              onRemove={(s) => removeItem("senders", s)}
                              emptyLabel="ยังไม่มี — ดึงทุก sender"
                            />
                            <ChipInput
                              value={inputs.sender}
                              onChange={(v) => setInputs((i) => ({ ...i, sender: v }))}
                              onAdd={() => addItem("senders", inputs.sender)}
                              placeholder="receipt@lazada.co.th"
                            />
                          </div>

                          {/* ── SECTION 2: block-list senders ── */}
                          <div className={filterSectionClass}>
                            <p className={sectionLabelClass}>บล็อกผู้ส่ง (suppress)</p>
                            <p className={sectionHintClass}>เมลจาก sender เหล่านี้จะถูกข้ามเสมอ (เช่น เมลแจ้งเตือนธนาคาร)</p>
                            <ChipList
                              items={filterDraft.suppressed}
                              onRemove={(s) => removeItem("suppressed", s)}
                              emptyLabel="ยังไม่มี"
                              colorClass="bg-rose-50 border border-rose-200 text-rose-800"
                            />
                            <ChipInput
                              value={inputs.suppressed}
                              onChange={(v) => setInputs((i) => ({ ...i, suppressed: v }))}
                              onAdd={() => addItem("suppressed", inputs.suppressed)}
                              placeholder="alert@kasikornbank.com"
                            />
                          </div>

                          {/* ── SECTION 3: Gmail label ── */}
                          <div className={filterSectionClass}>
                            <p className={sectionLabelClass}>Gmail Label</p>
                            <p className={sectionHintClass}>
                              สแกนเฉพาะเมลที่ติด label นี้ใน Gmail · ว่าง = ไม่กรองด้วย label
                            </p>
                            <input
                              value={filterDraft.label}
                              onChange={(e) => setFilterDraft((d) => ({ ...d, label: e.target.value }))}
                              placeholder="เช่น Receipts หรือ ใบเสร็จ-ระบบ"
                              className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-base sm:text-xs focus:border-[var(--color-brand-400)] focus:outline-none"
                            />
                            {filterDraft.label.trim() && (
                              <p className="text-xs text-amber-600">
                                ⚠️ ชื่อต้องตรงกับ Label ใน Gmail เป๊ะ (รวมตัวพิมพ์เล็ก/ใหญ่) — ถ้าผิดจะ scan ได้ 0 เมลโดยไม่แจ้งเตือน
                              </p>
                            )}
                            {/* collapsible setup guide */}
                            <button
                              type="button"
                              onClick={() => setLabelGuideOpen((v) => !v)}
                              className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800"
                            >
                              {labelGuideOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                              วิธีสร้าง Label ใน Gmail
                            </button>
                            {labelGuideOpen && (
                              <div className="rounded-lg bg-white border border-zinc-200 px-3 py-2.5 text-xs text-zinc-600 space-y-1">
                                <p>1. เปิด Gmail → ⚙️ Settings → "See all settings" → Filters and Blocked Addresses</p>
                                <p>2. กด "Create a new filter" → ใส่เงื่อนไข (เช่น from:shopee.co.th) → Next</p>
                                <p>3. เลือก "Apply the label" → สร้าง label ใหม่ ตั้งชื่อ (เช่น ใบเสร็จ-ระบบ)</p>
                                <p>4. เลือก "Also apply to matching conversations" แล้วกด Create filter</p>
                                <p className="text-zinc-400">จากนั้นนำชื่อ label มาใส่ช่องด้านบนได้เลย</p>
                              </div>
                            )}
                          </div>

                          {/* ── SECTION 4: subject keywords ── */}
                          <div className={filterSectionClass}>
                            <p className={sectionLabelClass}>หัวข้อเมล (keywords)</p>
                            <p className={sectionHintClass}>
                              ถ้าระบุ — ดึงเฉพาะเมลที่หัวข้อมีคำใดคำหนึ่ง · ว่าง = ไม่กรองด้วย keyword
                            </p>
                            <ChipList
                              items={filterDraft.keywords}
                              onRemove={(s) => removeItem("keywords", s)}
                              emptyLabel="ยังไม่มี — ดึงทุกเมลใบเสร็จ"
                              colorClass="bg-sky-50 border border-sky-200 text-sky-800"
                            />
                            <ChipInput
                              value={inputs.keyword}
                              onChange={(v) => setInputs((i) => ({ ...i, keyword: v }))}
                              onAdd={() => addItem("keywords", inputs.keyword)}
                              placeholder="เช่น ใบเสร็จ, receipt, invoice"
                            />
                            <p className={sectionHintClass}>
                              เพิ่ม keyword ได้ทั้งไทยและอังกฤษ · ระบบดึงเมลที่มีคำใดคำหนึ่ง (OR)
                            </p>
                          </div>

                          {/* actions */}
                          <div className="flex items-center justify-end gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setFilterOpen(null)}
                              className="text-xs text-zinc-500 hover:text-zinc-800"
                            >
                              ยกเลิก
                            </button>
                            <button
                              type="button"
                              onClick={() => saveFilter(m.id)}
                              disabled={filterSaving}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-50"
                            >
                              {filterSaving && <Loader2 className="size-3 animate-spin" />}
                              บันทึกตัวกรอง
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-zinc-500">ยังไม่ได้เชื่อมตู้เมล</p>
            )}

            <button
              type="button"
              onClick={() => go("gmail", () => startLedgerGmailConnect(companyId))}
              disabled={pending}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-50"
            >
              {busyKey === "gmail" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              เพิ่มเมล
            </button>
          </>
        )}
      </Card>
    </div>
  );
}
