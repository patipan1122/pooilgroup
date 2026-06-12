"use client";

// MatchPanel — the 2-panel reconcile view (PEAK Account parity).
// Left (40%): bank statement transactions sorted by variance / unmatched first
// Right (60%): selected bank txn detail + matching book entries + revenue entries
//
// 3-tab navigation:
//   Tab 1: รอกระทบยอด (unmatched)
//   Tab 2: รอยืนยัน (suggested — awaiting human confirm)
//   Tab 3: กระทบยอดแล้ว (confirmed)

import { useState, useTransition } from "react";
import { CheckCircle, X, ChevronRight, Lock, RefreshCw, TrendingUp, Link2, Ban, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfidencePill, MatchStatePill } from "./ConfidencePill";
import {
  confirmMatchAction, rejectMatchAction, lockPeriodAction, syncRevenueAction,
  createManualMatchAction, excludeTxnAction, unconfirmMatchAction,
} from "../_actions";
import { useRouter } from "next/navigation";

type Tab = "unmatched" | "suggested" | "confirmed";

interface BankTxnRow {
  id: string;
  txnDate: string;
  amountSatang: number;
  description: string | null;
  channel: string | null;
  ref1: string | null;
  matchState: string;
  matchId: string | null;
  matchConfidence: string | null;
  matchType: string | null;
  deltaSatang: number | null;
}

interface RevenueEntry {
  id: string;
  entryDate: string;
  amountSatang: number;
  sourceType: string;
  sourceRef: string | null;
  description: string | null;
  customerName: string | null;
  paymentChannel: string | null;
  matchState: string;
}

interface Props {
  batchId: string;
  unmatched: BankTxnRow[];
  suggested: BankTxnRow[];
  confirmed: BankTxnRow[];
  revenueEntries: RevenueEntry[];
  isLocked: boolean;
  canLock: boolean;
}

function formatSatang(satang: number): string {
  return (satang / 100).toLocaleString("th-TH", { minimumFractionDigits: 2 });
}

function TxnCard({
  txn,
  selected,
  onClick,
}: {
  txn: BankTxnRow;
  selected: boolean;
  onClick: () => void;
}) {
  const isCredit = txn.amountSatang > 0;
  const delta = txn.deltaSatang ?? null;
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-xl border p-3 text-left transition-colors ${
        selected
          ? "border-blue-300 bg-blue-50"
          : "border-zinc-100 bg-white hover:border-zinc-200 hover:bg-zinc-50"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-zinc-400">{txn.txnDate}</p>
          <p className="truncate text-sm text-zinc-700">{txn.description || txn.channel || "—"}</p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-sm font-semibold ${isCredit ? "text-emerald-600" : "text-red-600"}`}>
            {isCredit ? "+" : ""}฿{formatSatang(Math.abs(txn.amountSatang))}
          </p>
          {delta !== null && Math.abs(delta) > 0 && (
            <p className="text-xs text-amber-600">
              Δ ฿{formatSatang(Math.abs(delta))}
            </p>
          )}
        </div>
      </div>
      <div className="mt-1 flex items-center gap-1">
        {txn.matchConfidence && (
          <ConfidencePill confidence={txn.matchConfidence as "high" | "medium" | "low"} />
        )}
        <MatchStatePill state={txn.matchState} />
      </div>
    </button>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  TRCLOUD_IV: "TRCloud IV",
  CHAIROPS:   "ChairOps",
  CLAWFLEET:  "ClawFleet",
  FUELOS:     "FuelOS",
  WEBHOOK:    "Webhook",
  MANUAL:     "บันทึกเอง",
};

export function MatchPanel({
  batchId,
  unmatched,
  suggested,
  confirmed,
  revenueEntries,
  isLocked,
  canLock,
}: Props) {
  const [tab, setTab] = useState<Tab>("unmatched");
  const [selected, setSelected] = useState<BankTxnRow | null>(null);
  const [isPending, startTransition] = useTransition();
  const [lockResult, setLockResult] = useState<{ fingerprint?: string; error?: string } | null>(null);
  const [syncResult, setSyncResult] = useState<{ inserted?: number; error?: string } | null>(null);
  const router = useRouter();

  const tabData: Record<Tab, BankTxnRow[]> = { unmatched, suggested, confirmed };
  const rows = tabData[tab];

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: "unmatched", label: "รอกระทบยอด",    count: unmatched.length },
    { key: "suggested", label: "รอยืนยัน",      count: suggested.length },
    { key: "confirmed", label: "กระทบยอดแล้ว",  count: confirmed.length },
  ];

  const handleConfirm = (matchId: string) => {
    startTransition(async () => {
      await confirmMatchAction(matchId);
      router.refresh();
    });
  };

  const handleReject = (matchId: string) => {
    startTransition(async () => {
      await rejectMatchAction(matchId);
      router.refresh();
    });
  };

  const [actionError, setActionError] = useState<string | null>(null);

  // Manual match: link the selected (unmatched) bank txn to a revenue entry.
  const handleManualMatchRevenue = (revenueId: string) => {
    if (!selected) return;
    setActionError(null);
    startTransition(async () => {
      const res = await createManualMatchAction({
        bankTxnId: selected.id, bookType: "revenue", bookId: revenueId,
      });
      if (res.ok) { setSelected(null); router.refresh(); }
      else setActionError(res.error ?? "จับคู่ไม่สำเร็จ");
    });
  };

  // Exclude: mark a txn as "no book counterpart" (bank fee / interest / owner transfer).
  const handleExclude = () => {
    if (!selected) return;
    const reason = window.prompt("เหตุผลที่ข้ามรายการนี้ (เช่น ค่าธรรมเนียมธนาคาร / ดอกเบี้ย / โอนภายใน):");
    if (!reason?.trim()) return;
    setActionError(null);
    startTransition(async () => {
      const res = await excludeTxnAction({ bankTxnId: selected.id, reason: reason.trim() });
      if (res.ok) { setSelected(null); router.refresh(); }
      else setActionError(res.error ?? "ข้ามรายการไม่สำเร็จ");
    });
  };

  const handleUnconfirm = (matchId: string) => {
    setActionError(null);
    startTransition(async () => {
      const res = await unconfirmMatchAction(matchId);
      if (res.ok) { setSelected(null); router.refresh(); }
      else setActionError(res.error ?? "ยกเลิกการยืนยันไม่สำเร็จ");
    });
  };

  const handleSync = () => {
    startTransition(async () => {
      const result = await syncRevenueAction(batchId);
      setSyncResult(result.ok
        ? { inserted: result.inserted }
        : { error: result.error }
      );
      if (result.ok && (result.inserted ?? 0) > 0) router.refresh();
    });
  };

  const handleLock = () => {
    startTransition(async () => {
      const result = await lockPeriodAction(batchId);
      setLockResult(result);
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-0">
      {/* Left panel — transaction list */}
      <div className="lg:w-[40%] lg:border-r lg:border-zinc-100 lg:pr-4">
        {/* Tabs */}
        <div className="mb-3 flex gap-1 rounded-xl bg-zinc-100 p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setSelected(null); }}
              className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
                tab === t.key
                  ? "bg-white text-zinc-900 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              {t.label}
              {t.count > 0 && (
                <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] ${
                  t.key === "unmatched" ? "bg-red-100 text-red-600" :
                  t.key === "suggested" ? "bg-amber-100 text-amber-600" :
                  "bg-emerald-100 text-emerald-600"
                }`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="space-y-2 overflow-y-auto" style={{ maxHeight: "60vh" }}>
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-400">
              {tab === "confirmed" ? "ยังไม่มีรายการที่กระทบยอดแล้ว" :
               tab === "suggested" ? "ไม่มีรายการรอยืนยัน" :
               "รายการทั้งหมดได้รับการกระทบยอดแล้ว"}
            </p>
          ) : (
            rows.map((txn) => (
              <TxnCard
                key={txn.id}
                txn={txn}
                selected={selected?.id === txn.id}
                onClick={() => setSelected(txn)}
              />
            ))
          )}
        </div>

        {/* Lock button */}
        {canLock && !isLocked && tab === "confirmed" && (
          <div className="mt-4 border-t border-zinc-100 pt-4">
            {lockResult?.error && (
              <p className="mb-2 text-xs text-red-600">{lockResult.error}</p>
            )}
            {lockResult?.fingerprint && (
              <p className="mb-2 text-xs text-emerald-600">ล็อคสำเร็จ — fingerprint: {lockResult.fingerprint.slice(0, 16)}...</p>
            )}
            <Button
              variant="outline"
              className="w-full border-violet-200 text-violet-700 hover:bg-violet-50"
              onClick={handleLock}
              disabled={isPending || unmatched.length > 0 || suggested.length > 0}
            >
              <Lock size={14} className="mr-1" />
              ล็อคงวดบัญชี
            </Button>
            {(unmatched.length > 0 || suggested.length > 0) && (
              <p className="mt-1 text-center text-xs text-zinc-400">
                ต้องยืนยัน/ข้ามให้ครบก่อนล็อค (เหลือ {unmatched.length + suggested.length} รายการ)
              </p>
            )}
          </div>
        )}
      </div>

      {/* Right panel — transaction detail + revenue entries */}
      <div className="flex flex-col gap-4 lg:w-[60%] lg:pl-4">
        {/* Transaction detail card */}
        {!selected ? (
          <div className="flex min-h-[200px] items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50">
            <div className="text-center">
              <ChevronRight size={24} className="mx-auto mb-2 text-zinc-300" />
              <p className="text-sm text-zinc-400">เลือกรายการจากด้านซ้ายเพื่อดูรายละเอียด</p>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-100 bg-white p-4">
            <div className="mb-4 border-b border-zinc-50 pb-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-zinc-400">{selected.txnDate}</p>
                  <p className="text-base font-semibold text-zinc-800">
                    {selected.description || selected.channel || "รายการธนาคาร"}
                  </p>
                  {selected.ref1 && (
                    <p className="text-xs text-zinc-400">ref: {selected.ref1}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className={`text-xl font-bold ${selected.amountSatang > 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {selected.amountSatang > 0 ? "+" : ""}฿{formatSatang(Math.abs(selected.amountSatang))}
                  </p>
                  <MatchStatePill state={selected.matchState} />
                </div>
              </div>
            </div>

            {/* Suggested match actions */}
            {selected.matchState === "suggested" && selected.matchId && !isLocked && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-zinc-700">รายการที่ระบบแนะนำ</p>
                <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-1">
                      <ConfidencePill confidence={selected.matchConfidence as "high" | "medium" | "low"} />
                      <span className="text-xs text-amber-700">{selected.matchType?.replace(/_/g, " ")}</span>
                    </div>
                    {selected.deltaSatang !== null && Math.abs(selected.deltaSatang) > 0 && (
                      <p className="mt-1 text-xs text-amber-600">
                        ผลต่าง ฿{formatSatang(Math.abs(selected.deltaSatang))}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => handleConfirm(selected.matchId!)}
                      disabled={isPending}
                    >
                      <CheckCircle size={12} className="mr-1" />
                      ยืนยัน
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-red-200 text-red-600 hover:bg-red-50"
                      onClick={() => handleReject(selected.matchId!)}
                      disabled={isPending}
                    >
                      <X size={12} />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {(selected.matchState === "confirmed" || selected.matchState === "excluded") && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <CheckCircle size={14} className="text-emerald-600" />
                  <span className="text-sm text-emerald-700">
                    {selected.matchState === "excluded" ? "ข้ามรายการ (ไม่มีคู่ในบัญชี)" : "กระทบยอดแล้ว"}
                  </span>
                  {selected.deltaSatang !== null && Math.abs(selected.deltaSatang) > 0 && (
                    <span className="ml-auto text-xs text-amber-600">
                      Δ ฿{formatSatang(Math.abs(selected.deltaSatang))}
                    </span>
                  )}
                </div>
                {!isLocked && selected.matchId && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                    onClick={() => handleUnconfirm(selected.matchId!)}
                    disabled={isPending}
                  >
                    <Undo2 size={12} className="mr-1" />
                    ยกเลิกการยืนยัน
                  </Button>
                )}
              </div>
            )}

            {selected.matchState === "unmatched" && !isLocked && (
              <div className="space-y-3">
                <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-3 text-center">
                  <p className="text-sm text-zinc-500">ยังไม่มีรายการในบัญชีที่ตรงกัน</p>
                  <p className="mt-1 text-xs text-zinc-400">
                    {selected.amountSatang > 0
                      ? "เลือกรายได้ด้านล่าง เพื่อจับคู่ด้วยตนเอง"
                      : "รายการเงินออก · จับคู่กับใบจ่าย หรือกด “ข้าม” ถ้าไม่มีคู่"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full border-amber-200 text-amber-700 hover:bg-amber-50"
                  onClick={handleExclude}
                  disabled={isPending}
                >
                  <Ban size={12} className="mr-1" />
                  ข้าม / ไม่มีคู่ในบัญชี (ค่าธรรมเนียม·ดอกเบี้ย·โอนภายใน)
                </Button>
              </div>
            )}

            {actionError && (
              <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{actionError}</p>
            )}
          </div>
        )}

        {/* Revenue entries panel (book side — money expected to come IN) */}
        <div className="rounded-2xl border border-zinc-100 bg-white">
          <div className="flex items-center justify-between border-b border-zinc-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <TrendingUp size={14} className="text-emerald-600" />
              <span className="text-sm font-semibold text-zinc-700">รายได้ตามบัญชี</span>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">
                {revenueEntries.length} รายการ
              </span>
            </div>
            {!isLocked && (
              <div className="flex items-center gap-2">
                {syncResult?.error && (
                  <span className="text-xs text-red-500">{syncResult.error}</span>
                )}
                {syncResult?.inserted !== undefined && (
                  <span className="text-xs text-emerald-600">+{syncResult.inserted} รายการใหม่</span>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="border-blue-200 text-blue-600 hover:bg-blue-50"
                  onClick={handleSync}
                  disabled={isPending}
                >
                  <RefreshCw size={12} className={`mr-1 ${isPending ? "animate-spin" : ""}`} />
                  ดึงจาก TRCloud
                </Button>
              </div>
            )}
          </div>

          <div className="divide-y divide-zinc-50 overflow-y-auto" style={{ maxHeight: "40vh" }}>
            {revenueEntries.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-zinc-400">
                ยังไม่มีรายได้ — กด "ดึงจาก TRCloud" หรือรอ webhook
              </p>
            ) : (
              revenueEntries.map((r) => {
                // Clickable to manual-match when a credit (money-in) txn is selected & unmatched.
                const canLink =
                  !isLocked && !!selected &&
                  selected.matchState === "unmatched" &&
                  selected.amountSatang > 0 &&
                  r.matchState !== "matched";
                return (
                  <div
                    key={r.id}
                    onClick={canLink ? () => handleManualMatchRevenue(r.id) : undefined}
                    role={canLink ? "button" : undefined}
                    className={`flex items-center justify-between px-4 py-2.5 ${
                      r.matchState === "matched" ? "bg-emerald-50/50" : ""
                    } ${canLink ? "cursor-pointer hover:bg-blue-50" : ""}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {canLink && <Link2 size={12} className="text-blue-500" />}
                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
                          {SOURCE_LABEL[r.sourceType] ?? r.sourceType}
                        </span>
                        {r.sourceRef && (
                          <span className="truncate text-xs text-zinc-400">{r.sourceRef}</span>
                        )}
                      </div>
                      <p className="truncate text-xs text-zinc-600">
                        {r.description ?? r.customerName ?? r.entryDate}
                      </p>
                    </div>
                    <div className="ml-3 shrink-0 text-right">
                      <p className="text-sm font-semibold text-emerald-600">
                        +฿{formatSatang(r.amountSatang)}
                      </p>
                      {r.matchState === "matched" && (
                        <CheckCircle size={10} className="ml-auto text-emerald-500" />
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
