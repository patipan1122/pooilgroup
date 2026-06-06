"use client";

// LedgerLine · "เชื่อมต่อ Google" — one place to connect Drive (archive receipts)
// + Gmail mailboxes (auto-pull expenses, multi-mailbox per company). The hard
// part (the Google OAuth app) is already set up & live for the org; this is the
// one-tap connect surface. Email section is gated by LEDGER_EMAIL_SCAN_V1.

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

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">{children}</div>
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

  // per-mailbox filter editing state
  const [filterOpen, setFilterOpen] = useState<string | null>(null);
  const [filterDraft, setFilterDraft] = useState<string[]>([]);
  const [filterInput, setFilterInput] = useState("");
  const [filterSaving, setFilterSaving] = useState(false);

  function go(key: string, fn: () => Promise<{ ok: true; url: string } | { ok: false; error: string }>) {
    setError(null);
    setBusyKey(key);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        window.location.href = res.url;
      } else {
        setError(res.error);
        setBusyKey(null);
      }
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
    setFilterDraft([...m.filterSenders]);
    setFilterInput("");
    setError(null);
  }

  function addSender() {
    const v = filterInput.trim().toLowerCase();
    if (!v) return;
    if (!filterDraft.includes(v)) setFilterDraft((d) => [...d, v]);
    setFilterInput("");
  }

  function removeSender(s: string) {
    setFilterDraft((d) => d.filter((x) => x !== s));
  }

  async function saveFilter(connectionId: string) {
    setFilterSaving(true);
    const res = await updateMailboxFilters(connectionId, filterDraft);
    setFilterSaving(false);
    if (!res.ok) { setError(res.error); return; }
    setFilterOpen(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* trust / privacy note */}
      <div className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        <p>
          เชื่อมแบบ <b>อ่านอย่างเดียว</b> — ระบบดึงเฉพาะใบเสร็จตามตัวกรองที่ตั้งไว้
          ไม่ลบ ไม่แก้ ไม่ส่งเมล · ยกเลิกการเชื่อมได้ทุกเมื่อ
          {" "}(อาจเจอหน้าเตือน "ยังไม่ยืนยันแอป" ของ Google — กด "ดำเนินการต่อ" ได้เลย เป็นแอปของเราเอง)
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
              driveConnected
                ? "border border-zinc-200 text-zinc-700 hover:bg-zinc-50"
                : "bg-zinc-900 text-white hover:bg-zinc-800",
            )}
          >
            {busyKey === "drive" ? <Loader2 className="size-4 animate-spin" /> : <CloudUpload className="size-4" />}
            {driveConnected ? "เชื่อมใหม่" : "เชื่อมต่อ Drive"}
          </button>
        </div>
      </Card>

      {/* Gmail mailboxes (multi-mailbox) */}
      <Card>
        <div className="mb-1 flex items-center gap-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--color-brand-50)] text-[var(--color-brand-600)]">
            <Mail className="size-5" />
          </span>
          <div>
            <h2 className="text-sm font-bold text-zinc-800">Gmail — ดึงค่าใช้จ่ายจากอีเมล</h2>
            <p className="text-xs text-zinc-500">
              เชื่อมตู้เมลการเงินของ {companyName} · เพิ่มได้หลายเมล · ระบบหาใบเสร็จมาทำเป็นใบร่างให้
            </p>
          </div>
        </div>

        {!emailScanEnabled ? (
          <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-700">
            ฟีเจอร์ดึงค่าใช้จ่ายจากอีเมลกำลังพัฒนา — จะเปิดให้เชื่อมเมื่อพร้อม
          </p>
        ) : (
          <>
            {mailboxes.length > 0 ? (
              <ul className="mt-3 divide-y divide-zinc-100">
                {mailboxes.map((m) => (
                  <li key={m.id} className="py-2.5">
                    {/* mailbox row */}
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
                          {m.filterSenders.length > 0 ? (
                            <span className="text-zinc-500">
                              ตัวกรอง {m.filterSenders.length} ผู้ส่ง
                            </span>
                          ) : (
                            <span className="text-amber-600">ยังไม่ตั้งตัวกรอง</span>
                          )}
                          {m.lastSyncAt && (
                            <span>
                              สแกนล่าสุด {new Date(m.lastSyncAt).toLocaleDateString("th-TH")}
                            </span>
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
                          {busyKey === `scan:${m.id}` ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="size-3.5" />
                          )}
                          สแกนเลย
                        </button>
                        <button
                          type="button"
                          onClick={() => disconnect(m.id)}
                          disabled={pending}
                          className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-50"
                        >
                          {busyKey === `disc:${m.id}` ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Unplug className="size-3.5" />
                          )}
                          ยกเลิก
                        </button>
                      </div>
                    </div>

                    {/* expandable filter panel */}
                    {filterOpen === m.id && (
                      <div className="mt-2.5 rounded-xl border border-zinc-200 bg-zinc-50 p-3.5 space-y-3">
                        <p className="text-xs text-zinc-500 leading-relaxed">
                          <b className="text-zinc-700">ระบุ email ผู้ส่ง</b> ที่ต้องการให้ดึงใบเสร็จ
                          (เช่น <span className="font-mono">receipt@lazada.co.th</span>)
                          — ถ้าตั้งไว้จะดึงเฉพาะจาก sender เหล่านี้เท่านั้น ประหยัด token มาก
                          ถ้าเว้นว่าง = ดึงทุกเมลใบเสร็จอัตโนมัติ (ยกเว้นโฆษณา/โซเชียล)
                        </p>

                        {/* sender chips */}
                        <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                          {filterDraft.length === 0 ? (
                            <span className="text-xs text-zinc-400 italic">ยังไม่มี — สแกนทุกเมลใบเสร็จ (smart filter)</span>
                          ) : (
                            filterDraft.map((s) => (
                              <span
                                key={s}
                                className="inline-flex items-center gap-1 rounded-full bg-white border border-zinc-200 pl-2.5 pr-1.5 py-1 text-xs font-medium text-zinc-800"
                              >
                                {s}
                                <button
                                  type="button"
                                  onClick={() => removeSender(s)}
                                  className="ml-0.5 grid size-4 place-items-center rounded-full bg-zinc-100 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800"
                                >
                                  <X className="size-2.5" />
                                </button>
                              </span>
                            ))
                          )}
                        </div>

                        {/* add input */}
                        <div className="flex gap-2">
                          <input
                            value={filterInput}
                            onChange={(e) => setFilterInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSender(); } }}
                            placeholder="receipt@example.co.th"
                            className="h-9 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-xs focus:border-[var(--color-brand-400)] focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={addSender}
                            className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                          >
                            <Plus className="size-3.5" />
                            เพิ่ม
                          </button>
                        </div>

                        {/* actions */}
                        <div className="flex items-center justify-end gap-2">
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
                ))}
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
