"use client";

// หลายกลุ่ม LINE → หลายสาขา (B3). One LINE OA can serve many branch groups, each
// pinned to its own branch. Rows self-register when an admin types
// "/setting สาขา <สาขา>" inside a branch group; here an admin can view, re-point,
// or pause those bindings from the web. The webhook auto-tags each group's
// receipts with the branch shown here (paused/empty → the channel's default branch).

import { useState, useTransition } from "react";
import { Network, Loader2, Power, Banknote, Users, ArrowRight, Building2 } from "lucide-react";
import {
  setLedgerGroupBranch,
  toggleLedgerGroup,
  toggleLedgerGroupSlipIntake,
} from "../../_actions";
import type { LedgerGroupRow } from "../../_data";

type BranchOpt = { id: string; code: string; name: string };

const inputCls =
  "h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]";

/** Readable label for a LINE group: its set label, else a clear id tail with a
 *  prefix so "which group" is recognisable even when no label was set. */
function groupTitle(row: LedgerGroupRow): string {
  const label = row.label?.trim();
  if (label) return label;
  const id = row.groupId;
  return id.length > 8 ? `กลุ่ม ${id.slice(-8)}` : `กลุ่ม ${id}`;
}

function GroupRow({ row, branches }: { row: LedgerGroupRow; branches: BranchOpt[] }) {
  const [branchId, setBranchId] = useState(row.branchId ?? "");
  const [slipIntake, setSlipIntake] = useState(row.isSlipIntake);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function changeBranch(next: string) {
    setBranchId(next);
    setErr(null);
    start(async () => {
      const res = await setLedgerGroupBranch(row.id, next);
      if (!res.ok) setErr(res.error ?? "บันทึกไม่สำเร็จ");
    });
  }
  function toggleActive() {
    setErr(null);
    start(async () => {
      const res = await toggleLedgerGroup(row.id, !row.active);
      if (!res.ok) setErr(res.error ?? "ทำรายการไม่สำเร็จ");
    });
  }
  function toggleSlip() {
    const next = !slipIntake;
    setSlipIntake(next);
    setErr(null);
    start(async () => {
      const res = await toggleLedgerGroupSlipIntake(row.id, next);
      if (!res.ok) {
        setSlipIntake(!next); // revert on failure
        setErr(res.error ?? "ทำรายการไม่สำเร็จ");
      }
    });
  }

  // Resolve the bound branch from the live select value → full code + name; falls
  // back to the server-resolved branchName when the option isn't in the list.
  const bound = branches.find((b) => b.id === branchId);
  const boundLabel = bound
    ? `${bound.code} · ${bound.name}`
    : branchId
      ? row.branchName ?? "สาขาที่ผูกไว้"
      : null;

  return (
    <li className={"rounded-xl border p-3 " + (row.active ? "border-zinc-200 bg-white" : "border-zinc-100 bg-zinc-50 opacity-70")}>
      {/* Readable join: which LINE group → which branch */}
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--color-brand-50)] text-[var(--color-brand-600,#2563EB)]">
          <Users className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-800">{groupTitle(row)}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
            {typeof row.memberCount === "number" && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-600">
                <Users className="size-3" aria-hidden />
                {row.memberCount} คน
              </span>
            )}
            {row.label?.trim() && (
              <span className="truncate font-mono text-zinc-400">id …{row.groupId.slice(-8)}</span>
            )}
          </p>
          <div className="mt-1.5 flex items-center gap-1.5 text-xs">
            <ArrowRight className="size-3.5 shrink-0 text-zinc-300" aria-hidden />
            <Building2 className="size-3.5 shrink-0 text-zinc-400" aria-hidden />
            {boundLabel ? (
              <span className="truncate font-medium text-zinc-700">{boundLabel}</span>
            ) : (
              <span className="text-zinc-400">ใช้สาขาเริ่มต้น (ตามช่องทางหลัก)</span>
            )}
            {!row.active && (
              <span className="ml-1 shrink-0 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
                พักอยู่
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={toggleActive}
          disabled={pending}
          aria-label={row.active ? "พักการผูก" : "ใช้งานการผูก"}
          title={row.active ? "พักการผูก" : "ใช้งานการผูก"}
          className={"grid size-9 shrink-0 place-items-center rounded-lg border " +
            (row.active
              ? "border-zinc-200 text-zinc-400 hover:bg-zinc-50"
              : "border-emerald-200 text-emerald-600 hover:bg-emerald-50")}
        >
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Power className="size-4" aria-hidden />}
        </button>
      </div>

      {/* Edit binding */}
      <label className="mt-2.5 block">
        <span className="mb-1 block text-[11px] font-medium text-zinc-500">ผูกกลุ่มนี้กับสาขา</span>
        <select
          value={branchId}
          onChange={(e) => changeBranch(e.target.value)}
          disabled={pending}
          aria-label="สาขาของกลุ่มนี้"
          className={inputCls}
        >
          <option value="">— ใช้สาขาเริ่มต้น —</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.code} · {b.name}</option>
          ))}
        </select>
      </label>

      {/* PR4/D4 — ตั้งกลุ่มนี้เป็น "กลุ่มส่งสลิป" (รูป = สลิปจ่ายเงิน) */}
      <button
        type="button"
        onClick={toggleSlip}
        disabled={pending}
        aria-pressed={slipIntake}
        className={
          "mt-2 inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium " +
          (slipIntake
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50")
        }
      >
        <Banknote className="size-3.5" aria-hidden />
        {slipIntake ? "กลุ่มส่งสลิป · เปิดอยู่" : "ตั้งเป็นกลุ่มส่งสลิป"}
      </button>
      {slipIntake && (
        <p className="mt-1 text-[11px] text-emerald-700">
          รูปทุกใบในกลุ่มนี้ = สลิปจ่ายเงิน — อ่าน QR กันจ่ายซ้ำ + AI อ่านยอด แล้วจับคู่บิลให้
        </p>
      )}
      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
    </li>
  );
}

export function GroupBranchManager({
  groups,
  branches,
}: {
  companyId: string;
  groups: LedgerGroupRow[];
  branches: BranchOpt[];
}) {
  return (
    <div className="rounded-2xl border border-zinc-100 bg-white p-4">
      <div className="mb-1 flex items-center gap-2">
        <Network className="size-4 text-[var(--color-brand-600,#2563EB)]" aria-hidden />
        <h3 className="text-sm font-bold text-zinc-800">หลายกลุ่ม → หลายสาขา</h3>
        {groups.length > 0 && (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
            {groups.length} กลุ่ม
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        บอทตัวเดียวรับได้หลายกลุ่ม · แต่ละกลุ่มลงคนละสาขาได้ — เข้าไปในกลุ่มสาขานั้นแล้วพิมพ์{" "}
        <span className="font-mono">/setting สาขา &lt;ชื่อสาขา&gt;</span> · กลุ่มที่ผูกแล้วจะมาโผล่ที่นี่ให้ปรับ/พักได้
        <br />
        <span className="text-zinc-400">
          ตั้งกลุ่มส่งสลิปได้จากใน LINE เลย — พิมพ์{" "}
          <span className="font-mono">/setting สลิป</span> ในกลุ่มนั้น (หรือกดปุ่มด้านล่าง)
        </span>
      </p>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-6 text-center text-xs text-zinc-500">
          ยังไม่มีกลุ่มที่ผูกแยกสาขา — ตอนนี้ทุกกลุ่มลงสาขาเริ่มต้น (การ์ด “กลุ่ม LINE” ด้านล่าง) ·
          อยากแยกสาขา: เข้ากลุ่มนั้นแล้วพิมพ์ <span className="font-mono">/setting สาขา ...</span>
        </div>
      ) : (
        <ul className="space-y-2">
          {groups.map((g) => (
            <GroupRow key={g.id} row={g} branches={branches} />
          ))}
        </ul>
      )}
    </div>
  );
}
