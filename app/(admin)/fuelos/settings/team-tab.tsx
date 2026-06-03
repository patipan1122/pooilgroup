"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/fuelos/ui/button";
import { cn } from "@/lib/fuelos/utils/cn";
import { UserPlus, Power, Link2, ArrowRightLeft, X, Check } from "lucide-react";
import {
  createUser,
  setUserActive,
  setUserRole,
  setStaffLine,
  removeStaffLine,
  reassignAll,
} from "./actions";
import type { SettingsUser } from "@/lib/fuelos/settings-data";
import type { FuelUserRole } from "@/lib/generated/prisma/enums";

const ROLE_OPTIONS: { value: FuelUserRole; label: string }[] = [
  { value: "OWNER", label: "เจ้าของ" },
  { value: "ADMIN", label: "แอดมิน" },
  { value: "SALES_HEAD", label: "หัวหน้าขาย" },
  { value: "FINANCE", label: "การเงิน" },
  { value: "DISPATCH", label: "จัดส่ง" },
  { value: "SALES", label: "เซลล์" },
  { value: "DRIVER", label: "คนขับ" },
];

export function TeamTab({
  users,
  workload,
  selfId,
}: {
  users: SettingsUser[];
  workload: Record<string, { customers: number; conversations: number }>;
  selfId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [showHandover, setShowHandover] = useState(false);
  const [lineFor, setLineFor] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string, after?: () => void) {
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(okMsg);
        after?.();
        router.refresh();
      } else {
        toast.error(res.error ?? "ทำรายการไม่สำเร็จ");
      }
    });
  }

  function onCreate(formData: FormData) {
    start(async () => {
      const res = await createUser(formData);
      if (res.ok) {
        toast.success("เพิ่มพนักงานแล้ว");
        formRef.current?.reset();
        setShowAdd(false);
        router.refresh();
      } else {
        toast.error(res.error ?? "เพิ่มพนักงานไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold">พนักงาน <span className="text-zinc-400 font-normal">({users.length})</span></h2>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowHandover((v) => !v)}>
            <ArrowRightLeft className="size-4" /> โอนลูกค้าทั้งหมด
          </Button>
          <Button size="sm" onClick={() => setShowAdd((v) => !v)}>
            <UserPlus className="size-4" /> เพิ่มพนักงาน
          </Button>
        </div>
      </div>

      {/* F12 — โอนงาน */}
      {showHandover && (
        <HandoverCard
          users={users}
          workload={workload}
          pending={pending}
          onClose={() => setShowHandover(false)}
          onSubmit={(from, to) =>
            run(
              async () => {
                const res = await reassignAll(from, to);
                if (res.ok) toast.message(`โอนลูกค้า ${res.customers} ราย · แชท ${res.conversations} ห้อง`);
                return res;
              },
              "โอนงานสำเร็จ",
              () => setShowHandover(false),
            )
          }
        />
      )}

      {/* เพิ่มพนักงาน */}
      {showAdd && (
        <form ref={formRef} action={onCreate} className="rounded-2xl border border-border bg-surface p-4 grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-zinc-500">ชื่อ</label>
            <input name="name" required className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" placeholder="ชื่อ-นามสกุล" />
          </div>
          <div>
            <label className="text-xs text-zinc-500">อีเมล (ใช้ล็อกอิน)</label>
            <input name="email" type="email" required className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" placeholder="name@company.com" />
          </div>
          <div>
            <label className="text-xs text-zinc-500">รหัสผ่าน (อย่างน้อย 6 ตัว)</label>
            <input name="password" type="password" required minLength={6} className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" placeholder="••••••" />
          </div>
          <div>
            <label className="text-xs text-zinc-500">บทบาท</label>
            <select name="role" defaultValue="SALES" className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm">
              {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2 flex gap-2 justify-end">
            <Button type="button" variant="ghost" onClick={() => setShowAdd(false)}>ยกเลิก</Button>
            <Button type="submit" loading={pending}>บันทึกพนักงาน</Button>
          </div>
        </form>
      )}

      {/* รายชื่อ */}
      <div className="grid gap-2">
        {users.map((u) => {
          const w = workload[u.id] ?? { customers: 0, conversations: 0 };
          return (
            <div key={u.id} className={cn("rounded-2xl border border-border bg-surface p-3.5", !u.isActive && "opacity-60")}>
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-full bg-brand-100 text-brand-700 grid place-items-center font-bold shrink-0">{u.name.slice(0, 1)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold truncate">{u.name}</span>
                    {u.id === selfId && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-600/10 text-brand-700">คุณ</span>}
                    {!u.isActive && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-500/10 text-zinc-500">ปิดใช้งาน</span>}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5 truncate">
                    {u.email} · ลูกค้า {w.customers} · แชท {w.conversations}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <select
                    defaultValue={u.role}
                    disabled={pending}
                    onChange={(e) => run(() => setUserRole(u.id, e.target.value as FuelUserRole), "เปลี่ยนบทบาทแล้ว")}
                    className="h-8 rounded-lg border border-border bg-surface px-2 text-xs"
                  >
                    {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <button
                    title="ผูก LINE"
                    disabled={pending}
                    onClick={() => setLineFor(lineFor === u.id ? null : u.id)}
                    className={cn("size-8 grid place-items-center rounded-lg border border-border", u.lineUserIds.length ? "text-leaf-600 bg-leaf-50" : "text-zinc-400")}
                  >
                    <Link2 className="size-4" />
                  </button>
                  <button
                    title={u.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                    disabled={pending || u.id === selfId}
                    onClick={() => run(() => setUserActive(u.id, !u.isActive), u.isActive ? "ปิดใช้งานแล้ว" : "เปิดใช้งานแล้ว")}
                    className={cn(
                      "size-8 grid place-items-center rounded-lg border border-border disabled:opacity-40",
                      u.isActive ? "text-leaf-600" : "text-zinc-400",
                    )}
                  >
                    <Power className="size-4" />
                  </button>
                </div>
              </div>

              {/* แผง LINE identity */}
              {lineFor === u.id && (
                <LinePanel
                  userId={u.id}
                  lineUserIds={u.lineUserIds}
                  pending={pending}
                  onAdd={(line) => run(() => setStaffLine(u.id, line), "ผูก LINE แล้ว")}
                  onRemove={(line) => run(() => removeStaffLine(u.id, line), "ถอด LINE แล้ว")}
                />
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-zinc-400">
        บทบาท: เจ้าของ &gt; แอดมิน &gt; หัวหน้าขาย &gt; การเงิน &gt; จัดส่ง &gt; เซลล์ &gt; คนขับ — กำหนดสิทธิ์เข้าถึงแต่ละหน้า
      </p>
    </div>
  );
}

function LinePanel({
  userId,
  lineUserIds,
  pending,
  onAdd,
  onRemove,
}: {
  userId: string;
  lineUserIds: string[];
  pending: boolean;
  onAdd: (line: string) => void;
  onRemove: (line: string) => void;
}) {
  const [val, setVal] = useState("");
  return (
    <div className="mt-3 pt-3 border-t border-border">
      <div className="text-xs text-zinc-500 mb-2">LINE userId (รู้ว่าใครตอบในกลุ่ม)</div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {lineUserIds.length === 0 && <span className="text-xs text-zinc-400">ยังไม่ได้ผูก</span>}
        {lineUserIds.map((l) => (
          <span key={l} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-surface-2 border border-border font-[family-name:var(--font-plex-mono)]">
            {l}
            <button disabled={pending} onClick={() => onRemove(l)} className="text-zinc-400 hover:text-danger">
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="Uxxxxxxxxxxxxxxxx"
          className="h-9 flex-1 rounded-lg border border-border bg-surface px-3 text-sm font-[family-name:var(--font-plex-mono)]"
          data-user={userId}
        />
        <Button
          size="sm"
          loading={pending}
          disabled={!val.trim()}
          onClick={() => { onAdd(val.trim()); setVal(""); }}
        >
          <Check className="size-4" /> ผูก
        </Button>
      </div>
    </div>
  );
}

function HandoverCard({
  users,
  workload,
  pending,
  onClose,
  onSubmit,
}: {
  users: SettingsUser[];
  workload: Record<string, { customers: number; conversations: number }>;
  pending: boolean;
  onClose: () => void;
  onSubmit: (from: string, to: string) => void;
}) {
  const active = users.filter((u) => u.isActive);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const fromW = from ? workload[from] : undefined;

  return (
    <div className="rounded-2xl border border-warning/40 bg-warning/5 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <ArrowRightLeft className="size-4 text-warning" /> โอนลูกค้า + แชททั้งหมด (ส่งต่องาน)
        </div>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600"><X className="size-4" /></button>
      </div>
      <p className="text-xs text-zinc-500 mb-3">
        ใช้ตอนพนักงานลาออก/ย้ายงาน — ลูกค้าและห้องแชทที่พนักงานต้นทางดูแลทั้งหมดจะถูกย้ายไปคนปลายทางทันที
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-zinc-500">จากพนักงาน (ต้นทาง)</label>
          <select value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm">
            <option value="">— เลือก —</option>
            {active.map((u) => {
              const w = workload[u.id] ?? { customers: 0, conversations: 0 };
              return <option key={u.id} value={u.id}>{u.name} (ลูกค้า {w.customers} · แชท {w.conversations})</option>;
            })}
          </select>
        </div>
        <div>
          <label className="text-xs text-zinc-500">ไปยังพนักงาน (ปลายทาง)</label>
          <select value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm">
            <option value="">— เลือก —</option>
            {active.filter((u) => u.id !== from).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </div>
      {fromW && (fromW.customers + fromW.conversations) === 0 && from && (
        <p className="text-[11px] text-zinc-400 mt-2">พนักงานคนนี้ยังไม่มีลูกค้า/แชทให้โอน</p>
      )}
      <div className="flex justify-end mt-3">
        <Button variant="danger" loading={pending} disabled={!from || !to || from === to} onClick={() => onSubmit(from, to)}>
          ยืนยันโอนงาน
        </Button>
      </div>
    </div>
  );
}
