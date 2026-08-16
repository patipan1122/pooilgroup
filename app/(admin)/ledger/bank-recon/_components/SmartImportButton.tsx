"use client";

// SmartImportButton — "นำเข้า statement" จากหน้ารวมบัญชี โดยไม่ต้องเลือกบัญชีก่อน.
// ลากไฟล์วาง → ระบบอ่าน "ธนาคาร + เลขบัญชี" จากตัวไฟล์ → จับคู่บัญชีจริงในระบบให้เอง
// → โชว์บัญชีที่ตรวจพบให้ยืนยัน → นำเข้า → ไปหน้ากระทบยอด.
//
// รองรับไฟล์ "หลายบัญชีในไฟล์เดียว" (เช่น TTB ACCHIST): แยกรายการตามเลขบัญชีราย-แถว
// → โชว์ทุกบัญชีที่พบ → นำเข้าแยกเป็นชุดต่อบัญชี (กันเงินปนข้ามบัญชี).
//
// กสิกร/SCB/TTB มีเลขบัญชีในไฟล์ → เดาบัญชีได้แม่น · กรุงเทพ/ไฟล์ตัวอย่างไม่มี → ให้เลือก.

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileText, AlertTriangle, CheckCircle, ChevronRight, Landmark, Check, Layers } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { smartImportDetectAction, commitImportAction, type SmartDetectResult, type SmartImportGroup } from "../_actions";

interface Props {
  companyId: string;
  period: string; // fallback period for redirect (YYYY-MM)
}

const baht = (s: number) =>
  (s / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const periodOf = (iso: string) => iso.slice(0, 7); // "2026-06-14" → "2026-06"

export function SmartImportButton({ companyId, period }: Props) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [detect, setDetect] = useState<SmartDetectResult | null>(null);
  // selected target account per file-account-group (keyed by group.fileAccountNo)
  const [selected, setSelected] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [duplicateTotal, setDuplicateTotal] = useState(0);
  const [duplicateCleanupHref, setDuplicateCleanupHref] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingRedirect = useRef<(() => void) | null>(null);
  const router = useRouter();

  function reset() {
    setFile(null); setDetect(null); setSelected({});
    setError(null); setLoading(false); setCommitting(false); setDone(false); setIsDragging(false);
    setDuplicateTotal(0); setDuplicateCleanupHref("");
  }
  function close() { setOpen(false); setTimeout(reset, 200); }

  async function handleFile(f: File) {
    setFile(f); setError(null); setDetect(null); setSelected({}); setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await smartImportDetectAction(companyId, fd);
      setDetect(res);
      if (res.ok) {
        const init: Record<string, string | null> = {};
        res.groups.forEach((g) => { init[g.fileAccountNo] = g.autoSelectedId; });
        setSelected(init);
      }
    } catch {
      setError("อ่านไฟล์ไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setLoading(false);
    }
  }

  async function handleCommit() {
    if (!file || !detect || !detect.ok) return;
    setCommitting(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      let okCount = 0;
      let firstAccountId: string | null = null;
      let firstPeriodEnd = "";
      let dupTotal = 0;
      const errs: string[] = [];
      // import each detected account-group into its chosen target account
      for (const g of detect.groups) {
        const targetId = selected[g.fileAccountNo];
        if (!targetId) continue; // skip unmatched groups (e.g. account not in system)
        const res = await commitImportAction(targetId, fd, g.fileAccountNo);
        if (res.ok) {
          okCount++;
          dupTotal += res.possibleDuplicateCount;
          if (!firstAccountId) { firstAccountId = targetId; firstPeriodEnd = g.periodEnd; }
        } else {
          errs.push(`${g.fileLast4 ? `****${g.fileLast4}` : "ไฟล์"}: ${res.error}`);
        }
      }
      if (okCount === 0) {
        setError(errs.join(" · ") || "นำเข้าไม่สำเร็จ");
        return;
      }
      setDone(true);
      setDuplicateTotal(dupTotal);
      const multi = detect.groups.filter((g) => selected[g.fileAccountNo]).length > 1;
      setDuplicateCleanupHref(
        !multi && firstAccountId
          ? `/ledger/bank-recon/${firstAccountId}?company=${companyId}`
          : `/ledger/bank-recon?company=${companyId}&period=${period}`,
      );
      const redirect = () => {
        if (!multi && firstAccountId) {
          router.push(`/ledger/bank-recon/${firstAccountId}/reconcile?company=${companyId}&period=${periodOf(firstPeriodEnd) || period}`);
        } else {
          // several accounts imported → back to the hub so the CEO sees them all
          router.push(`/ledger/bank-recon?company=${companyId}&period=${period}`);
        }
      };
      // Auto re-check found leftover duplicates (usually from before the fix that added
      // balance to the dedup key) → stay on the success screen so the CEO can actually
      // read that instead of auto-navigating it away in 1.1s.
      if (dupTotal === 0) {
        setTimeout(redirect, 1100);
      } else {
        pendingRedirect.current = redirect;
      }
    } catch {
      setError("นำเข้าไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setCommitting(false);
    }
  }

  const anySelected = detect?.ok ? detect.groups.some((g) => selected[g.fileAccountNo]) : false;
  const skipCount = detect?.ok ? detect.groups.filter((g) => !selected[g.fileAccountNo]).length : 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
      >
        <Upload size={14} />
        นำเข้า statement
      </button>

      <Dialog open={open} onClose={close} title="นำเข้า statement" className="sm:max-w-lg">
        {/* Success */}
        {done ? (
          duplicateTotal > 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <CheckCircle className="text-emerald-500" size={40} />
              <p className="text-lg font-semibold text-zinc-800">นำเข้าสำเร็จ</p>
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-800">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span>
                  ตรวจซ้ำอัตโนมัติพบ <strong>{duplicateTotal} รายการ</strong> ที่หน้าตาเหมือนนำเข้าซ้ำ
                  (มักมาจากไฟล์เก่าก่อนหน้านี้) — ยังไม่ได้ลบอะไร แนะนำให้ไปตรวจสอบก่อน
                </span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { close(); pendingRedirect.current?.(); }}>
                  ไปหน้ากระทบยอด
                </Button>
                <Button onClick={() => { close(); router.push(duplicateCleanupHref); }}>
                  ไปตรวจรายการซ้ำ
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <CheckCircle className="text-emerald-500" size={44} />
              <p className="text-lg font-semibold text-zinc-800">นำเข้าสำเร็จ!</p>
              <p className="text-sm text-zinc-500">กำลังไปหน้ากระทบยอด...</p>
            </div>
          )
        ) : !detect ? (
          /* Step 1 — drop file */
          <div className="space-y-3">
            <div
              className={`relative flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-6 transition-colors ${
                isDragging ? "border-blue-400 bg-blue-50" : "border-zinc-200 bg-zinc-50 hover:border-zinc-300 hover:bg-zinc-100"
              }`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
              onClick={() => inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.CSV,.xlsx,.xls"
                className="sr-only"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              {loading ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                  <p className="text-sm text-zinc-500">กำลังอ่านไฟล์ + หาบัญชี...</p>
                </div>
              ) : (
                <>
                  <Upload size={30} className="text-zinc-400" />
                  <p className="text-sm font-medium text-zinc-700">ลากวางไฟล์ statement หรือคลิกเพื่อเลือก</p>
                  <p className="text-center text-xs text-zinc-400">
                    ระบบจะอ่านเองว่าเป็น<strong>ธนาคารไหน บัญชีไหน</strong> (ไฟล์เดียวมีหลายบัญชีก็แยกให้)<br />
                    รองรับ KBank · SCB · TTB · กรุงเทพ · ไฟล์ตัวอย่าง Excel
                  </p>
                </>
              )}
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        ) : !detect.ok ? (
          /* Detection failed */
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{detect.error}</span>
            </div>
            <Button variant="outline" onClick={reset}>เลือกไฟล์ใหม่</Button>
          </div>
        ) : (
          /* Step 2 — detection result(s) + account picker(s) + preview */
          <div className="space-y-4">
            {/* What we detected */}
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <FileText size={16} className="shrink-0 text-emerald-600" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-emerald-800">ตรวจพบ: {detect.bankLabel}</p>
                <p className="truncate text-xs text-emerald-600">{file?.name}</p>
              </div>
            </div>

            {/* Multi-account banner */}
            {detect.groups.length > 1 && (
              <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800">
                <Layers size={16} className="shrink-0" />
                <span>ไฟล์นี้มี <strong>{detect.groups.length} บัญชี</strong> — จะแยกนำเข้าให้แต่ละบัญชี</span>
              </div>
            )}

            {/* One block per detected account-group */}
            <div className="space-y-3">
              {detect.groups.map((g) => (
                <GroupBlock
                  key={g.fileAccountNo}
                  group={g}
                  multi={detect.groups.length > 1}
                  bankLabel={detect.bankLabel}
                  selectedId={selected[g.fileAccountNo] ?? null}
                  onSelect={(id) => setSelected((s) => ({ ...s, [g.fileAccountNo]: id }))}
                  companyId={companyId}
                />
              ))}
            </div>

            {detect.warnings.length > 0 && (
              <div className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-700">คำเตือน</p>
                {detect.warnings.map((w, i) => <p key={i} className="text-xs text-amber-600">• {w}</p>)}
              </div>
            )}

            {skipCount > 0 && anySelected && (
              <p className="text-xs text-amber-600">* {skipCount} บัญชีที่ยังไม่ได้เลือกปลายทางจะถูกข้าม</p>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-2">
              <Button variant="outline" onClick={reset}>เลือกไฟล์ใหม่</Button>
              <Button onClick={handleCommit} disabled={!anySelected || committing} className="flex flex-1 items-center justify-center gap-1">
                {committing ? "กำลังนำเข้า..." : detect.groups.length > 1 ? "ยืนยันนำเข้าทุกบัญชี" : "ยืนยันนำเข้า"}
                <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

// One detected account-group: file account header + target picker + mini preview.
function GroupBlock({
  group, multi, bankLabel, selectedId, onSelect, companyId,
}: {
  group: SmartImportGroup;
  multi: boolean;
  bankLabel: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  companyId: string;
}) {
  return (
    <div className={multi ? "rounded-2xl border border-zinc-200 p-3" : ""}>
      {/* file account header (only labelled when several accounts share the file) */}
      {multi && (
        <p className="mb-2 text-sm font-semibold text-zinc-700">
          {group.fileLast4 ? <>บัญชีในไฟล์ <span className="font-mono">****{group.fileLast4}</span></> : "บัญชีในไฟล์"}
          <span className="ml-1 font-normal text-zinc-400">· {group.rowCount} รายการ</span>
        </p>
      )}

      {/* target account selection */}
      {group.candidates.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {group.unknownAccount
            ? <>บัญชี <strong>{bankLabel}{group.fileLast4 ? ` ****${group.fileLast4}` : ""}</strong> ยังไม่มีในระบบ — จะข้ามบัญชีนี้</>
            : <>ยังไม่มีบัญชีที่นำเข้าได้สำหรับธนาคารนี้</>}
          <Link
            href={`/ledger/bank-recon/accounts?company=${companyId}`}
            className="mt-2 inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
          >
            <Landmark size={12} /> ไปเพิ่มบัญชีธนาคาร
          </Link>
        </div>
      ) : (
        <div className="space-y-1.5">
          {!multi && <p className="text-xs font-semibold text-zinc-500">นำเข้าไปยังบัญชี</p>}
          {group.unknownAccount && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              เลขบัญชีในไฟล์ (****{group.fileLast4}) ไม่ตรงกับบัญชีที่มี — เลือกบัญชีที่ถูกต้องด้านล่าง
            </p>
          )}
          {group.candidates.map((c) => {
            const active = selectedId === c.accountId;
            const flagged = (c.continuity && !c.continuity.ok) || c.unusualRows.length > 0;
            return (
              <button
                key={c.accountId}
                type="button"
                onClick={() => onSelect(c.accountId)}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  active ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500" : "border-zinc-200 bg-white hover:bg-zinc-50"
                }`}
              >
                <span className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${active ? "border-blue-600 bg-blue-600" : "border-zinc-300"}`}>
                  {active && <Check size={13} className="text-white" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-800">{c.accountName}</span>
                  <span className="font-mono text-xs text-zinc-400">{c.accountNoMasked}</span>
                </span>
                {c.exact && (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">เลขตรง</span>
                )}
                {flagged && (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                    <AlertTriangle size={10} /> ยอดไม่ต่อเนื่อง
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* continuity / unusual-amount detail for the account currently selected — only
          when something actually looks off (silent otherwise, no noise on the normal path) */}
      {(() => {
        const active = group.candidates.find((c) => c.accountId === selectedId);
        if (!active) return null;
        const cont = active.continuity;
        const unusual = active.unusualRows;
        if ((!cont || cont.ok) && unusual.length === 0) return null;
        return (
          <div className="mt-2 space-y-1.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            {cont && !cont.ok && (
              <p className="flex items-start gap-1.5">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>
                  ยอดคงเหลือไม่ต่อเนื่อง — บัญชีนี้ล่าสุดมียอด <strong>฿{baht(cont.lastBalanceSatang)}</strong> (ณ {cont.lastTxnDate})
                  แต่ไฟล์นี้เริ่มต้นที่ <strong>฿{baht(cont.fileOpeningBalanceSatang ?? 0)}</strong> ต่างกัน{" "}
                  <strong>฿{baht(Math.abs(cont.diffSatang ?? 0))}</strong> — อาจเลือกบัญชีผิด หรือมีรายการที่ยังไม่ได้นำเข้าในช่วงก่อนหน้า
                </span>
              </p>
            )}
            {unusual.length > 0 && (
              <p className="flex items-start gap-1.5">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>
                  พบ {unusual.length} รายการที่ยอดสูงผิดปกติเทียบกับรายการทั่วไปของบัญชีนี้ — ควรตรวจสอบ:{" "}
                  {unusual.slice(0, 3).map((r, i) => (
                    <span key={i}>
                      {i > 0 && " · "}
                      {r.txnDate} {r.amountSatang > 0 ? "เข้า" : "ออก"} ฿{baht(Math.abs(r.amountSatang))} ({r.multiple.toFixed(1)}× ปกติ)
                    </span>
                  ))}
                  {unusual.length > 3 && ` และอีก ${unusual.length - 3} รายการ`}
                </span>
              </p>
            )}
          </div>
        );
      })()}

      {/* mini preview for this group */}
      <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl border border-zinc-100 bg-zinc-50 p-2.5 text-sm sm:grid-cols-4">
        <div><p className="text-[11px] text-zinc-400">รายการ</p><p className="font-semibold text-zinc-800 tabular-num">{group.rowCount}</p></div>
        <div><p className="text-[11px] text-zinc-400">ช่วงวันที่</p><p className="text-xs font-semibold text-zinc-800 tabular-num">{group.periodStart} → {group.periodEnd}</p></div>
        <div><p className="text-[11px] text-emerald-600">รับเข้า</p><p className="font-semibold text-emerald-700 tabular-num">฿{baht(group.totalCreditSatang)}</p></div>
        <div><p className="text-[11px] text-rose-600">จ่ายออก</p><p className="font-semibold text-rose-700 tabular-num">฿{baht(group.totalDebitSatang)}</p></div>
      </div>
    </div>
  );
}
