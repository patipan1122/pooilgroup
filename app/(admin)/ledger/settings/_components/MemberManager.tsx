"use client";

// Member ↔ branch back-office (GAP 4, CEO 2026-06-05) — "ใครดูแลสาขาไหน".
//
// Members land here two ways: auto-seeded when they drop a receipt / type "จด"
// in a bound LINE group, OR by accepting a scoped invite. The admin assigns the
// branch(es) each oversees (tap chips → บันทึก), sets their role, approves a
// member's self-requested branch (⏳ from /สาขา in LINE), or disables them.
// Mobile-first: each member is a stacked card, chips wrap, big tap targets.

import { useState, useTransition } from "react";
import {
  Users, Check, X, Loader2, Clock, MapPin, Power, Crown, Link2, Link2Off, ChevronDown,
} from "lucide-react";
import {
  updateMemberBranches,
  setMemberRole,
  toggleMemberActive,
  approveMemberPending,
  rejectMemberPending,
  linkLineMemberToMe,
  unlinkLineMember,
} from "../../_actions";
import type { LedgerMemberRow } from "../../_data";
import { LEDGER_ROLES, ROLE_LABEL } from "@/lib/ledger/permission-constants";

type BranchOpt = { id: string; code: string; name: string };

const inputCls =
  "h-9 rounded-lg border border-zinc-200 bg-white px-2 text-base sm:text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]";

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

function MemberRow({
  member,
  branches,
  myUserId,
}: {
  member: LedgerMemberRow;
  branches: BranchOpt[];
  myUserId: string;
}) {
  const [scope, setScope] = useState<string[]>(member.scopeBranchIds);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  // Branch chips are collapsed by default — just a count — to keep each member
  // card short (CEO: บัตรเยอะไป). Tap to expand the editable chip grid.
  const [scopeOpen, setScopeOpen] = useState(false);
  const dirty = !sameSet(scope, member.scopeBranchIds);

  function toggle(id: string) {
    setScope((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }
  function saveBranches() {
    setErr(null);
    start(async () => {
      const res = await updateMemberBranches(member.id, scope);
      if (!res.ok) setErr(res.error ?? "บันทึกไม่สำเร็จ");
    });
  }
  function changeRole(role: string) {
    setErr(null);
    start(async () => {
      const res = await setMemberRole(member.id, role);
      if (!res.ok) setErr(res.error ?? "เปลี่ยนสิทธิ์ไม่สำเร็จ");
    });
  }
  function approve() {
    start(async () => {
      const res = await approveMemberPending(member.id);
      if (!res.ok) setErr(res.error ?? "อนุมัติไม่สำเร็จ");
    });
  }
  function reject() {
    start(async () => {
      await rejectMemberPending(member.id);
    });
  }
  function toggleActive() {
    start(async () => {
      const res = await toggleMemberActive(member.id, !member.active);
      if (!res.ok) setErr(res.error ?? "ทำรายการไม่สำเร็จ");
    });
  }
  function linkAsMe() {
    setErr(null);
    start(async () => {
      const res = await linkLineMemberToMe(member.id);
      if (!res.ok) setErr(res.error ?? "ผูกบัญชีไม่สำเร็จ");
    });
  }
  function unlink() {
    setErr(null);
    start(async () => {
      const res = await unlinkLineMember(member.id);
      if (!res.ok) setErr(res.error ?? "ยกเลิกไม่สำเร็จ");
    });
  }

  return (
    <li className={"rounded-xl border p-3 " + (member.active ? "border-zinc-200 bg-white" : "border-zinc-100 bg-zinc-50 opacity-70")}>
      {/* Header: name + role + active toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-zinc-100 text-zinc-500">
            <Users className="size-3.5" aria-hidden />
          </span>
          <span className="truncate text-sm font-semibold text-zinc-800">
            {member.displayName?.trim() || "(ยังไม่มีชื่อ)"}
          </span>
          {!member.active && (
            <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[11px] text-zinc-600">ปิดอยู่</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={member.role}
            onChange={(e) => changeRole(e.target.value)}
            disabled={pending}
            aria-label="สิทธิ์"
            className={inputCls}
          >
            {LEDGER_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={toggleActive}
            disabled={pending}
            aria-label={member.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
            title={member.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
            className={"grid size-9 place-items-center rounded-lg border " +
              (member.active
                ? "border-zinc-200 text-zinc-400 hover:bg-zinc-50"
                : "border-emerald-200 text-emerald-600 hover:bg-emerald-50")}
          >
            <Power className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      {/* LINE ↔ Pool admin link — bind this LINE identity to a Pool account so
          it can run admin commands in chat (the "เฉพาะแอดมิน..." unlock). */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {member.poolLinked ? (
          member.poolUserId === myUserId ? (
            <>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                <Crown className="size-3" aria-hidden /> นี่คือบัญชีของคุณ · สั่งงานในแชตได้
              </span>
              <button
                type="button"
                onClick={unlink}
                disabled={pending}
                className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-rose-600 disabled:opacity-50"
              >
                <Link2Off className="size-3" aria-hidden /> ยกเลิกการผูก
              </button>
            </>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
              <Link2 className="size-3" aria-hidden /> ผูกกับบัญชีแอดมินแล้ว
            </span>
          )
        ) : (
          <button
            type="button"
            onClick={linkAsMe}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Crown className="size-3.5" aria-hidden />}
            นี่คือ LINE ของฉัน → ตั้งเป็นแอดมิน
          </button>
        )}
      </div>

      {/* Pending self-request banner */}
      {member.pendingBranchId && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5">
          <span className="flex items-center gap-1.5 text-xs font-medium text-amber-800">
            <Clock className="size-3.5" aria-hidden />
            ขอดูแลสาขา: {member.pendingBranchName ?? "?"}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={approve}
              disabled={pending}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-600 px-2 text-xs font-medium text-white disabled:opacity-50"
            >
              <Check className="size-3.5" aria-hidden /> อนุมัติ
            </button>
            <button
              type="button"
              onClick={reject}
              disabled={pending}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 px-2 text-xs text-zinc-600 disabled:opacity-50"
            >
              <X className="size-3.5" aria-hidden /> ปฏิเสธ
            </button>
          </div>
        </div>
      )}

      {/* Branch scope — collapsed to a count by default; tap to expand+edit */}
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setScopeOpen((v) => !v)}
          aria-expanded={scopeOpen}
          className="flex w-full items-center gap-1 text-xs font-semibold text-zinc-600"
        >
          <MapPin className="size-3.5 shrink-0" aria-hidden />
          <span>
            ดูแลสาขา{" "}
            <span className="font-bold text-zinc-800">
              {scope.length > 0 ? `${scope.length} สาขา` : "ทุกสาขา"}
            </span>
          </span>
          {dirty && !scopeOpen && (
            <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              ยังไม่บันทึก
            </span>
          )}
          <ChevronDown
            className={"ml-auto size-4 shrink-0 text-zinc-400 transition-transform " + (scopeOpen ? "rotate-180" : "")}
            aria-hidden
          />
        </button>

        {scopeOpen && (
          <>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {branches.length === 0 && <span className="text-xs text-zinc-500">ยังไม่มีสาขา</span>}
              {branches.map((b) => {
                const on = scope.includes(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => toggle(b.id)}
                    disabled={pending}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
                      on
                        ? "bg-[var(--color-brand-600,#2563EB)] text-white ring-transparent"
                        : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50"
                    }`}
                  >
                    {b.code} · {b.name}
                  </button>
                );
              })}
            </div>
            {dirty && (
              <button
                type="button"
                onClick={saveBranches}
                disabled={pending}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-600,#2563EB)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
                บันทึกสาขา
              </button>
            )}
          </>
        )}
      </div>

      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
    </li>
  );
}

export function MemberManager({
  branches,
  members,
  myUserId,
  myLineLinked,
}: {
  companyId: string;
  branches: BranchOpt[];
  members: LedgerMemberRow[];
  myUserId: string;
  myLineLinked: boolean;
}) {
  const pendingCount = members.filter((m) => m.pendingBranchId).length;

  return (
    <div className="rounded-2xl border border-zinc-100 bg-white p-4">
      <div className="mb-1 flex items-center gap-2">
        <Users className="size-4 text-[var(--color-brand-600,#2563EB)]" aria-hidden />
        <h3 className="text-sm font-bold text-zinc-800">สมาชิก & สาขาที่ดูแล</h3>
        {pendingCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
            <Clock className="size-3" aria-hidden /> {pendingCount} คำขอ
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        คนที่ส่งใบเสร็จ/พิมพ์ในกลุ่ม LINE จะมาโผล่ที่นี่เอง · แตะชิปเลือกสาขาที่แต่ละคนดูแล แล้วกดบันทึก
      </p>

      {/* First-run nudge: bind YOUR LINE so admin commands work in chat. */}
      {!myLineLinked && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-xs text-amber-900">
          <p className="font-semibold">👑 อยากสั่งงานใน LINE ได้ไหม?</p>
          <p className="mt-0.5 leading-relaxed text-amber-800">
            พิมพ์อะไรก็ได้ในกลุ่ม LINE 1 ครั้ง (เช่น <span className="font-mono">/help</span>) →
            ชื่อ LINE ของคุณจะมาโผล่ในรายการด้านล่าง → กด{" "}
            <span className="font-semibold">“นี่คือ LINE ของฉัน → ตั้งเป็นแอดมิน”</span> ที่ชื่อคุณ ·
            จากนั้นคำสั่งแอดมินทั้งหมดในแชตจะใช้ได้
          </p>
        </div>
      )}

      {members.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-6 text-center text-xs text-zinc-500">
          ยังไม่มีสมาชิก — ให้พนักงานส่งใบเสร็จในกลุ่ม LINE สักใบ หรือเชิญผ่านลิงก์ด้านบน
          แล้วเขาจะมาแสดงที่นี่ให้กำหนดสาขาได้
        </div>
      ) : (
        <ul className="space-y-2">
          {members.map((m) => (
            <MemberRow key={m.id} member={m} branches={branches} myUserId={myUserId} />
          ))}
        </ul>
      )}
    </div>
  );
}
