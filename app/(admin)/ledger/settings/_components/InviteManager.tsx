"use client";

// Scoped LINE invites (M7) — admin creates a link that pins which branches a
// person oversees; opening it (in the LedgerLine LIFF) makes them a scoped
// member. Create → copy link → share. Revoke unused links anytime.

import { useState, useTransition } from "react";
import {
  UserPlus, Link2, Copy, Check, Trash2, Loader2, ShieldCheck,
} from "lucide-react";
import { createLedgerInvite, revokeLedgerInvite } from "../../_actions";
import type { InviteRow } from "../../_data";
import { LEDGER_ROLES, ROLE_LABEL, ROLE_HINT, type LedgerRole } from "@/lib/ledger/permission-constants";

type BranchOpt = { id: string; code: string; name: string };
type Role = LedgerRole;

export function InviteManager({
  companyId,
  branches,
  invites,
}: {
  companyId: string;
  branches: BranchOpt[];
  invites: InviteRow[];
}) {
  const [role, setRole] = useState<Role>("staff");
  const [scope, setScope] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<number | "">(30);
  const [created, setCreated] = useState<{ url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggleBranch(id: string) {
    setScope((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  function create() {
    setErr(null);
    // Footgun guard: an empty branch scope = the person sees EVERY branch. For a
    // non-staff role that's broad — make the operator confirm it's intentional.
    if (scope.length === 0 && role !== "staff") {
      if (!confirm(`ลิงก์นี้ไม่ได้จำกัดสาขา — ผู้รับ (สิทธิ์ "${ROLE_LABEL[role]}") จะเห็น/ดูแลทุกสาขา ยืนยันไหม?`)) {
        return;
      }
    }
    setCreated(null);
    setCopied(false);
    start(async () => {
      const res = await createLedgerInvite({
        companyId,
        role,
        scopeBranchIds: scope,
        note: note.trim() || undefined,
        expiresInDays: expiresInDays === "" ? undefined : expiresInDays,
      });
      if (res.ok && res.url) {
        setCreated({ url: res.url });
        setNote("");
      } else {
        setErr(res.error ?? "สร้างลิงก์ไม่สำเร็จ");
      }
    });
  }

  function revoke(id: string) {
    if (!confirm("ลบลิงก์เชิญนี้?")) return;
    start(async () => {
      await revokeLedgerInvite(id);
    });
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard may be blocked — the URL is still visible to copy by hand */
    }
  }

  const inputCls =
    "h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]";

  return (
    <div className="rounded-2xl border border-zinc-100 bg-white p-4 lg:col-span-2">
      <div className="mb-1 flex items-center gap-2">
        <UserPlus className="size-4 text-[var(--color-brand-600,#2563EB)]" aria-hidden />
        <h3 className="text-sm font-bold text-zinc-800">เชิญพนักงานเข้าระบบ (ลิงก์กำหนดสิทธิ์)</h3>
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        สร้างลิงก์เชิญที่ระบุได้ว่าคนนี้ดูแลสาขาไหน · ส่งให้พนักงานเปิดใน LINE แล้วเข้าร่วมได้เลย
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-zinc-600">สิทธิ์</label>
          <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="สิทธิ์">
            {LEDGER_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]} — {ROLE_HINT[r]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-zinc-600">หมดอายุใน (วัน)</label>
          <input
            className={inputCls}
            type="number"
            min={1}
            max={365}
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="เว้นว่าง = ไม่หมดอายุ"
            aria-label="หมดอายุใน (วัน)"
          />
        </div>
      </div>

      <div className="mt-3">
        <label className="mb-1 block text-xs font-semibold text-zinc-600">
          ดูแลสาขา {scope.length > 0 ? `(${scope.length})` : "(ว่าง = ทุกสาขา)"}
        </label>
        <div className="flex max-h-32 flex-wrap gap-1.5 overflow-auto rounded-lg border border-zinc-100 p-2">
          {branches.length === 0 && <span className="text-xs text-zinc-400">ยังไม่มีสาขา</span>}
          {branches.map((b) => {
            const on = scope.includes(b.id);
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => toggleBranch(b.id)}
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
      </div>

      <div className="mt-3">
        <label className="mb-1 block text-xs font-semibold text-zinc-600">โน้ต (ใคร/ทำไม)</label>
        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น คุณเอ สาขาชุมพวง" />
      </div>

      <button
        type="button"
        onClick={create}
        disabled={pending}
        className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-brand-600,#2563EB)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
        {scope.length === 0 ? "สร้างลิงก์เชิญ (ทุกสาขา)" : `สร้างลิงก์เชิญ (${scope.length} สาขา)`}
      </button>
      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}

      {created && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-emerald-800">
            <ShieldCheck className="size-3.5" aria-hidden /> ลิงก์พร้อมแล้ว — ส่งให้พนักงาน
          </p>
          <div className="flex items-center gap-2">
            <input readOnly value={created.url} className="h-8 flex-1 rounded-lg border border-emerald-200 bg-white px-2 text-xs" aria-label="ลิงก์เชิญ" />
            <button
              type="button"
              onClick={() => copy(created.url)}
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-xs font-medium text-white"
            >
              {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
              {copied ? "คัดลอกแล้ว" : "คัดลอก"}
            </button>
          </div>
        </div>
      )}

      {invites.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-semibold text-zinc-600">ลิงก์ที่สร้างไว้</p>
          <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-100">
            {invites.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                <div className="min-w-0">
                  <span className="font-medium text-zinc-700">{ROLE_LABEL[(inv.role as Role)] ?? inv.role}</span>
                  <span className="text-zinc-400">
                    {" · "}
                    {inv.branchCount > 0 ? `${inv.branchCount} สาขา` : "ทุกสาขา"}
                    {inv.note ? ` · ${inv.note}` : ""}
                  </span>
                  <span className={`ml-1 rounded px-1.5 py-0.5 text-[10px] ${inv.used ? "bg-zinc-100 text-zinc-500" : "bg-amber-50 text-amber-700"}`}>
                    {inv.used ? "ใช้แล้ว" : "รอใช้"}
                  </span>
                </div>
                {!inv.used && (
                  <button
                    type="button"
                    onClick={() => revoke(inv.id)}
                    disabled={pending}
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-rose-500 hover:bg-rose-50"
                    aria-label="ลบลิงก์"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
