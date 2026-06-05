"use client";

// หลายกลุ่ม LINE → หลายสาขา (B3). One LINE OA can serve many branch groups, each
// pinned to its own branch. Rows self-register when an admin types
// "/setting สาขา <สาขา>" inside a branch group; here an admin can view, re-point,
// or pause those bindings from the web. The webhook auto-tags each group's
// receipts with the branch shown here (paused/empty → the channel's default branch).

import { useState, useTransition } from "react";
import { Network, Loader2, Power } from "lucide-react";
import { setLedgerGroupBranch, toggleLedgerGroup } from "../../_actions";
import type { LedgerGroupRow } from "../../_data";

type BranchOpt = { id: string; code: string; name: string };

const inputCls =
  "h-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]";

/** Show a friendly short tail of the LINE group id (full ids are opaque C-strings). */
function shortGroup(id: string): string {
  return id.length > 10 ? `…${id.slice(-8)}` : id;
}

function GroupRow({ row, branches }: { row: LedgerGroupRow; branches: BranchOpt[] }) {
  const [branchId, setBranchId] = useState(row.branchId ?? "");
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

  return (
    <li className={"rounded-xl border p-3 " + (row.active ? "border-zinc-200 bg-white" : "border-zinc-100 bg-zinc-50 opacity-70")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-800">
            {row.label?.trim() || "กลุ่ม LINE"}
          </p>
          <p className="font-mono text-[11px] text-zinc-400">{shortGroup(row.groupId)}</p>
        </div>
        <div className="flex items-center gap-1.5">
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
          <button
            type="button"
            onClick={toggleActive}
            disabled={pending}
            aria-label={row.active ? "พักการผูก" : "ใช้งานการผูก"}
            title={row.active ? "พักการผูก" : "ใช้งานการผูก"}
            className={"grid size-9 place-items-center rounded-lg border " +
              (row.active
                ? "border-zinc-200 text-zinc-400 hover:bg-zinc-50"
                : "border-emerald-200 text-emerald-600 hover:bg-emerald-50")}
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Power className="size-4" aria-hidden />}
          </button>
        </div>
      </div>
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
    <div className="rounded-2xl border border-zinc-100 bg-white p-4 lg:col-span-2">
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
      </p>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-6 text-center text-xs text-zinc-500">
          ยังไม่มีกลุ่มที่ผูกแยกสาขา — ตอนนี้ทุกกลุ่มลงสาขาเริ่มต้น (การ์ด “กลุ่ม LINE” ด้านบน) ·
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
