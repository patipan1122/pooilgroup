"use client";

// โยกเงิน (ระหว่างบัญชี) — pair a withdrawal leg (เงินออก) in one account with a
// matching deposit leg (เงินเข้า) in another. Amounts must be equal; the two
// must be different accounts. A transfer is NOT income/expense — it nets to zero.
//
// Flow:
//   1. pick บัญชีต้นทาง (เงินออก) + บัญชีปลายทาง (เงินเข้า)
//   2. load each account's unmatched movements (listUnmatchedMovementsAction)
//   3. pick the OUT leg (negative) from source + IN leg (positive) from target
//   4. confirm amounts match → "บันทึกการโยกเงิน" (createBankTransferAction)
//   5. history of past transfers below

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  Info,
  Loader2,
  History,
} from "lucide-react";
import type { AccountOption, TransferRecord } from "@/lib/ledger/recon-controls";
import type { BankMovement } from "@/lib/ledger/bank-reconcile-board";
import {
  listUnmatchedMovementsAction,
  createBankTransferAction,
} from "../_recon-controls-actions";
import { Money, baht, thDate, StatusBadge, FeedbackBar } from "../_components/recon-controls-ui";

interface Props {
  accounts: AccountOption[];
  transfers: TransferRecord[];
  companyId: string;
}

type LoadState = {
  loading: boolean;
  movements: BankMovement[];
  error: string | null;
};

const EMPTY: LoadState = { loading: false, movements: [], error: null };

export function TransfersClient({ accounts, transfers, companyId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [srcAcct, setSrcAcct] = useState<string>("");
  const [dstAcct, setDstAcct] = useState<string>("");
  const [srcLoad, setSrcLoad] = useState<LoadState>(EMPTY);
  const [dstLoad, setDstLoad] = useState<LoadState>(EMPTY);
  const [outLeg, setOutLeg] = useState<string>(""); // bank txn id (negative)
  const [inLeg, setInLeg] = useState<string>(""); // bank txn id (positive)
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; message: string } | null>(null);

  async function loadMovements(
    accountId: string,
    set: (s: LoadState) => void,
  ) {
    if (!accountId) {
      set(EMPTY);
      return;
    }
    set({ loading: true, movements: [], error: null });
    const res = await listUnmatchedMovementsAction({ bankAccountId: accountId, companyId });
    if (res.ok) set({ loading: false, movements: res.movements, error: null });
    else set({ loading: false, movements: [], error: res.error ?? "โหลดรายการไม่สำเร็จ" });
  }

  function onPickSrc(id: string) {
    setSrcAcct(id);
    setOutLeg("");
    void loadMovements(id, setSrcLoad);
  }
  function onPickDst(id: string) {
    setDstAcct(id);
    setInLeg("");
    void loadMovements(id, setDstLoad);
  }

  const outMovements = srcLoad.movements.filter((m) => m.amountSatang < 0);
  const inMovements = dstLoad.movements.filter((m) => m.amountSatang > 0);
  const outAmt = outMovements.find((m) => m.id === outLeg)?.amountSatang ?? 0;
  const inAmt = inMovements.find((m) => m.id === inLeg)?.amountSatang ?? 0;
  const amountsMatch = outLeg !== "" && inLeg !== "" && Math.abs(outAmt) === Math.abs(inAmt);
  const sameAccount = srcAcct !== "" && srcAcct === dstAcct;
  const canSave = !!outLeg && !!inLeg && amountsMatch && !sameAccount && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setFeedback(null);
    const res = await createBankTransferAction({ txnIdA: outLeg, txnIdB: inLeg, note: note.trim() || undefined });
    setSaving(false);
    if (res.ok) {
      setFeedback({ kind: "ok", message: "บันทึกการโยกเงินแล้ว — ทั้ง 2 ขาถูกจับคู่ (ไม่นับเป็นรายรับ/รายจ่าย)" });
      // reset selection + reload both sides
      setOutLeg("");
      setInLeg("");
      setNote("");
      void loadMovements(srcAcct, setSrcLoad);
      void loadMovements(dstAcct, setDstLoad);
      startTransition(() => router.refresh());
    } else {
      setFeedback({ kind: "error", message: res.error ?? "บันทึกไม่สำเร็จ" });
    }
  }

  const acctLabelOf = (id: string) => accounts.find((a) => a.id === id)?.label ?? "—";

  return (
    <div className="space-y-6">
      {/* explainer */}
      <div className="flex items-start gap-2 rounded-xl border border-violet-100 bg-violet-50/60 px-4 py-2.5 text-xs text-violet-800">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          โยกเงินคือการ <strong>ย้ายเงินระหว่างบัญชีของเราเอง</strong> — จับคู่เงินออกจากบัญชีหนึ่งกับเงินเข้าอีกบัญชี
          ยอดต้องเท่ากัน · <strong>ไม่นับเป็นรายรับหรือรายจ่าย</strong> (สุทธิเป็นศูนย์)
        </span>
      </div>

      {feedback && (
        <FeedbackBar kind={feedback.kind} message={feedback.message} onDismiss={() => setFeedback(null)} />
      )}

      {/* creator */}
      <section className="rounded-2xl border border-zinc-100 bg-white p-4 shadow-soft">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-700">
          <ArrowLeftRight size={16} className="text-brand-600" />
          สร้างรายการโยกเงิน
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* SOURCE (เงินออก) */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-zinc-500">
              บัญชีต้นทาง (เงินออก)
            </label>
            <AccountSelect
              accounts={accounts}
              value={srcAcct}
              onChange={onPickSrc}
              excludeId={dstAcct}
              label="บัญชีต้นทาง (เงินออก)"
            />
            <LegPicker
              kind="out"
              load={srcLoad}
              movements={outMovements}
              selected={outLeg}
              onSelect={setOutLeg}
              emptyText="บัญชีนี้ไม่มีรายการเงินออกที่ค้าง"
              placeholder="เลือกบัญชีต้นทางก่อน"
              hasAccount={!!srcAcct}
            />
          </div>

          {/* TARGET (เงินเข้า) */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-zinc-500">
              บัญชีปลายทาง (เงินเข้า)
            </label>
            <AccountSelect
              accounts={accounts}
              value={dstAcct}
              onChange={onPickDst}
              excludeId={srcAcct}
              label="บัญชีปลายทาง (เงินเข้า)"
            />
            <LegPicker
              kind="in"
              load={dstLoad}
              movements={inMovements}
              selected={inLeg}
              onSelect={setInLeg}
              emptyText="บัญชีนี้ไม่มีรายการเงินเข้าที่ค้าง"
              placeholder="เลือกบัญชีปลายทางก่อน"
              hasAccount={!!dstAcct}
            />
          </div>
        </div>

        {/* match summary */}
        {(outLeg || inLeg) && (
          <div
            className={`mt-4 flex flex-wrap items-center justify-center gap-3 rounded-xl border px-4 py-3 text-sm ${
              outLeg && inLeg
                ? amountsMatch
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-amber-200 bg-amber-50"
                : "border-zinc-200 bg-zinc-50"
            }`}
          >
            <span className="font-medium text-zinc-700">{acctLabelOf(srcAcct)}</span>
            <span className="tabular-num font-semibold text-rose-600">−฿{baht(outAmt)}</span>
            <ArrowRight size={16} className="text-zinc-400" />
            <span className="font-medium text-zinc-700">{acctLabelOf(dstAcct)}</span>
            <span className="tabular-num font-semibold text-emerald-600">+฿{baht(inAmt)}</span>
            {outLeg && inLeg && (
              <span
                className={`ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                  amountsMatch ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                }`}
              >
                {amountsMatch ? (
                  <>
                    <Check size={12} /> ยอดตรงกัน
                  </>
                ) : (
                  "ยอดไม่เท่ากัน"
                )}
              </span>
            )}
          </div>
        )}

        {sameAccount && (
          <p className="mt-2 text-center text-xs text-rose-600">ต้องเป็นคนละบัญชี (โยกเงินข้ามบัญชี)</p>
        )}

        {/* note + save */}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="หมายเหตุ (ไม่บังคับ) เช่น โอนเข้าบัญชีเงินเดือน"
            className="min-h-11 flex-1 rounded-xl border border-zinc-200 px-3 text-sm text-zinc-800 outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          />
          <button
            type="button"
            onClick={save}
            disabled={!canSave || pending}
            className="press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-300 disabled:opacity-50"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <ArrowLeftRight size={15} />}
            บันทึกการโยกเงิน
          </button>
        </div>
      </section>

      {/* history */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-700">
          <History size={15} className="text-zinc-400" />
          ประวัติการโยกเงิน
          <span className="rounded-full bg-zinc-100 px-2 text-xs text-zinc-400 tabular-num">{transfers.length}</span>
        </h2>
        {transfers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 py-8 text-center text-sm text-zinc-400">
            ยังไม่มีการโยกเงิน
          </div>
        ) : (
          <ul className="space-y-2.5">
            {transfers.map((t) => (
              <TransferHistoryCard key={t.id} transfer={t} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AccountSelect({
  accounts,
  value,
  onChange,
  excludeId,
  label,
}: {
  accounts: AccountOption[];
  value: string;
  onChange: (id: string) => void;
  excludeId?: string;
  label: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
    >
      <option value="">— เลือกบัญชี —</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id} disabled={a.id === excludeId}>
          {a.label}
        </option>
      ))}
    </select>
  );
}

function LegPicker({
  kind,
  load,
  movements,
  selected,
  onSelect,
  emptyText,
  placeholder,
  hasAccount,
}: {
  kind: "out" | "in";
  load: LoadState;
  movements: BankMovement[];
  selected: string;
  onSelect: (id: string) => void;
  emptyText: string;
  placeholder: string;
  hasAccount: boolean;
}) {
  if (!hasAccount) {
    return <p className="mt-2 rounded-xl bg-zinc-50 px-3 py-3 text-center text-xs text-zinc-400">{placeholder}</p>;
  }
  if (load.loading) {
    return (
      <div className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-zinc-50 px-3 py-4 text-xs text-zinc-400">
        <Loader2 size={14} className="animate-spin" /> กำลังโหลดรายการ...
      </div>
    );
  }
  if (load.error) {
    return <p className="mt-2 rounded-xl bg-rose-50 px-3 py-3 text-center text-xs text-rose-600">{load.error}</p>;
  }
  if (movements.length === 0) {
    return <p className="mt-2 rounded-xl bg-zinc-50 px-3 py-3 text-center text-xs text-zinc-400">{emptyText}</p>;
  }
  return (
    <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto pr-0.5">
      <p className="text-[11px] text-zinc-400">
        เลือก{kind === "out" ? "รายการเงินออก" : "รายการเงินเข้า"} ({movements.length})
      </p>
      {movements.map((m) => {
        const active = selected === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelect(active ? "" : m.id)}
            className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-brand-300 ${
              active ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-zinc-200 bg-white hover:bg-zinc-50"
            }`}
          >
            <span
              className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${
                active ? "border-brand-600 bg-brand-600" : "border-zinc-300"
              }`}
            >
              {active && <Check size={11} className="text-white" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-zinc-800">{m.description}</span>
              <span className="text-[11px] text-zinc-400">{thDate(m.date)}</span>
            </span>
            <Money satang={m.amountSatang} className="shrink-0 text-xs" />
          </button>
        );
      })}
    </div>
  );
}

function TransferHistoryCard({ transfer: t }: { transfer: TransferRecord }) {
  // legs: typically [out (negative), in (positive)] — render จาก → เข้า
  const out = t.legs.find((l) => l.amountSatang < 0) ?? t.legs[0];
  const inn = t.legs.find((l) => l.amountSatang > 0) ?? t.legs[1];
  const amount = Math.abs(out?.amountSatang ?? inn?.amountSatang ?? 0);
  return (
    <li className="rounded-2xl border border-zinc-100 bg-white p-3 shadow-soft">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">โยกเงิน</span>
        {t.status !== "confirmed" && <StatusBadge status={t.status} />}
        <span className="ml-auto text-xs text-zinc-400">{thDate(t.createdAt)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        {out && (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-zinc-400">จาก</span>
            <span className="font-medium text-zinc-700">{out.accountLabel ?? "—"}</span>
          </span>
        )}
        <ArrowRight size={15} className="text-zinc-400" />
        {inn && (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-zinc-400">เข้า</span>
            <span className="font-medium text-zinc-700">{inn.accountLabel ?? "—"}</span>
          </span>
        )}
        <span className="ml-auto tabular-num font-semibold text-zinc-800">฿{baht(amount)}</span>
      </div>
      {t.note && <p className="mt-1 text-xs text-zinc-400">{t.note}</p>}
    </li>
  );
}
