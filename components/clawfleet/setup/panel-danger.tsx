"use client";

// PanelDanger — destructive actions with typed-confirmation guard.
// Each action requires user to type the target string before the confirm
// button enables. Wraps existing <ConfirmDialog>.
//
// All actions are STUBS — wire to actions when ready.

import { useState, useTransition } from "react";
import {
  ShieldAlert,
  Power,
  Trash2,
  RefreshCcw,
  Eraser,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";

interface Branch {
  id: string;
  name: string;
  code: string;
}

export interface PanelDangerProps {
  branches: Branch[];
}

type Result = { kind: "idle" } | { kind: "ok"; msg: string } | { kind: "err"; msg: string };

export function PanelDanger({ branches }: PanelDangerProps) {
  return (
    <div className="space-y-4">
      {/* Warning banner */}
      <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-rose-600" />
        <div className="text-sm text-rose-900">
          <p className="font-semibold">Danger zone · กระทบทุกคนในระบบ</p>
          <p className="mt-1 text-rose-800">
            ทุกการกระทำที่นี่ถูก audit ทันที + แจ้ง CEO ผ่าน LINE ·
            ต้องพิมพ์ชื่อยืนยันก่อนกดได้
          </p>
        </div>
      </div>

      <DangerCard
        icon={<Power className="size-5" />}
        tone="amber"
        title="ปิด ClawFleet ชั่วคราว"
        description="ซ่อนเมนูจากทุกคน + บล็อค URL · ใช้ตอน maintenance หรือ data freeze"
        confirmTarget="clawfleet"
        confirmHint="พิมพ์ clawfleet เพื่อยืนยัน"
        actionLabel="ปิดโมดูล"
        action={async () => {
          // TODO[claude-design]: setEnv MODULES_DISABLED via disableModule('clawfleet')
          await new Promise((r) => setTimeout(r, 350));
          return {
            ok: true,
            msg: "ส่งคำขอ disable แล้ว · ต้อง redeploy Vercel · env: MODULES_DISABLED=clawfleet",
          };
        }}
      />

      <DangerCardWithSelect
        icon={<Trash2 className="size-5" />}
        tone="rose"
        title="ลบสาขาออกจาก ClawFleet"
        description="ลบ machine + group + session ทั้งหมดของสาขานี้ · audit-log ยังคงอยู่"
        branches={branches}
        actionLabel="ลบสาขา"
        action={async (branch) => {
          // TODO[claude-design]: removeBranchFromClawfleet({branchId})
          await new Promise((r) => setTimeout(r, 350));
          return {
            ok: true,
            msg: `ลบสาขา ${branch.name} แล้ว · audit log บันทึก`,
          };
        }}
      />

      <DangerCardWithSelect
        icon={<RefreshCcw className="size-5" />}
        tone="amber"
        title="Reset stock per สาขา"
        description="ตั้งสต๊อกทุก SKU ของสาขานี้กลับเป็น 0 · ใช้ตอน opening balance ผิด"
        branches={branches}
        actionLabel="Reset stock"
        action={async (branch) => {
          // TODO[claude-design]: resetStock({branchId})
          await new Promise((r) => setTimeout(r, 350));
          return {
            ok: true,
            msg: `Reset สต๊อก ${branch.name} แล้ว · ทุก SKU = 0`,
          };
        }}
      />

      <DangerCard
        icon={<Eraser className="size-5" />}
        tone="zinc"
        title="Clear cache ภาพรวม"
        description="ล้าง dashboard cache · ใช้ตอนกราฟไม่ refresh"
        confirmTarget="clear"
        confirmHint="พิมพ์ clear เพื่อยืนยัน"
        actionLabel="Clear cache"
        action={async () => {
          // TODO[claude-design]: clearDashboardCache()
          await new Promise((r) => setTimeout(r, 200));
          return { ok: true, msg: "ล้าง cache แล้ว · refresh dashboard เพื่อดูผล" };
        }}
      />
    </div>
  );
}

// ── Variant 1: typed-string confirmation ─────────────────────
interface DangerCardProps {
  icon: React.ReactNode;
  tone: "rose" | "amber" | "zinc";
  title: string;
  description: string;
  confirmTarget: string;
  confirmHint: string;
  actionLabel: string;
  action: () => Promise<{ ok: boolean; msg: string }>;
}

function DangerCard({
  icon,
  tone,
  title,
  description,
  confirmTarget,
  confirmHint,
  actionLabel,
  action,
}: DangerCardProps) {
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Result>({ kind: "idle" });

  const canConfirm = typed.trim() === confirmTarget && !pending;
  const accent = toneClasses(tone);

  async function handle() {
    return new Promise<void>((resolve) => {
      startTransition(async () => {
        try {
          const r = await action();
          setResult(
            r.ok
              ? { kind: "ok", msg: r.msg }
              : { kind: "err", msg: r.msg },
          );
          setTyped("");
        } catch (e) {
          setResult({ kind: "err", msg: (e as Error).message });
        } finally {
          resolve();
        }
      });
    });
  }

  return (
    <section className={`rounded-2xl border ${accent.border} bg-white p-6 shadow-sm`}>
      <header className="mb-4 flex items-start gap-3">
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${accent.iconBg} ${accent.iconText}`}
        >
          {icon}
        </span>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-zinc-900">{title}</h3>
          <p className="mt-0.5 text-sm text-zinc-500">{description}</p>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <Input
            placeholder={confirmHint}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
        <ConfirmDialog
          trigger={
            <Button variant="danger" disabled={!canConfirm}>
              {actionLabel}
            </Button>
          }
          title={`ยืนยัน · ${title}`}
          body={
            <div className="space-y-2">
              <p>{description}</p>
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                {confirmHint} = <code>{confirmTarget}</code>
              </p>
            </div>
          }
          confirmLabel={actionLabel}
          variant="danger"
          onConfirm={handle}
        />
      </div>

      {result.kind !== "idle" && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          {result.kind === "ok" ? (
            <StatusPill tone="success" dot>
              เสร็จ
            </StatusPill>
          ) : (
            <StatusPill tone="danger" dot>
              ล้มเหลว
            </StatusPill>
          )}
          <span className="text-zinc-700">{result.msg}</span>
        </div>
      )}
    </section>
  );
}

// ── Variant 2: branch picker + typed name ────────────────────
interface DangerCardWithSelectProps {
  icon: React.ReactNode;
  tone: "rose" | "amber" | "zinc";
  title: string;
  description: string;
  branches: Branch[];
  actionLabel: string;
  action: (b: Branch) => Promise<{ ok: boolean; msg: string }>;
}

function DangerCardWithSelect({
  icon,
  tone,
  title,
  description,
  branches,
  actionLabel,
  action,
}: DangerCardWithSelectProps) {
  const [branchId, setBranchId] = useState("");
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Result>({ kind: "idle" });

  const branch = branches.find((b) => b.id === branchId) ?? null;
  const canConfirm =
    branch !== null && typed.trim() === branch.name && !pending;
  const accent = toneClasses(tone);

  async function handle() {
    if (!branch) return;
    return new Promise<void>((resolve) => {
      startTransition(async () => {
        try {
          const r = await action(branch);
          setResult(
            r.ok
              ? { kind: "ok", msg: r.msg }
              : { kind: "err", msg: r.msg },
          );
          setTyped("");
          setBranchId("");
        } catch (e) {
          setResult({ kind: "err", msg: (e as Error).message });
        } finally {
          resolve();
        }
      });
    });
  }

  return (
    <section className={`rounded-2xl border ${accent.border} bg-white p-6 shadow-sm`}>
      <header className="mb-4 flex items-start gap-3">
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${accent.iconBg} ${accent.iconText}`}
        >
          {icon}
        </span>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-zinc-900">{title}</h3>
          <p className="mt-0.5 text-sm text-zinc-500">{description}</p>
        </div>
      </header>

      <div className="space-y-3">
        <select
          value={branchId}
          onChange={(e) => {
            setBranchId(e.target.value);
            setTyped("");
          }}
          className="h-12 w-full rounded-xl border border-zinc-200 bg-white px-4 text-base text-zinc-900 outline-none focus:border-indigo-500"
        >
          <option value="">เลือกสาขา…</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({b.code})
            </option>
          ))}
        </select>

        {branch && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <Input
                placeholder={`พิมพ์ "${branch.name}" เพื่อยืนยัน`}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
            </div>
            <ConfirmDialog
              trigger={
                <Button variant="danger" disabled={!canConfirm}>
                  {actionLabel}
                </Button>
              }
              title={`ยืนยัน · ${title}`}
              body={
                <div className="space-y-2">
                  <p>{description}</p>
                  <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                    สาขา: <code>{branch.name}</code>
                  </p>
                  <p className="text-xs text-zinc-500">
                    audit log จะบันทึก · ยกเลิกไม่ได้
                  </p>
                </div>
              }
              confirmLabel={actionLabel}
              variant="danger"
              onConfirm={handle}
            />
          </div>
        )}

        {!branch && (
          <p className="flex items-center gap-1.5 text-xs text-zinc-500">
            <AlertTriangle className="size-3.5 text-amber-500" />
            เลือกสาขาเพื่อปลดล็อคปุ่ม
          </p>
        )}
      </div>

      {result.kind !== "idle" && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          {result.kind === "ok" ? (
            <StatusPill tone="success" dot>
              เสร็จ
            </StatusPill>
          ) : (
            <StatusPill tone="danger" dot>
              ล้มเหลว
            </StatusPill>
          )}
          <span className="text-zinc-700">{result.msg}</span>
        </div>
      )}
    </section>
  );
}

function toneClasses(tone: "rose" | "amber" | "zinc") {
  switch (tone) {
    case "rose":
      return {
        border: "border-rose-200",
        iconBg: "bg-rose-50",
        iconText: "text-rose-600",
      };
    case "amber":
      return {
        border: "border-amber-200",
        iconBg: "bg-amber-50",
        iconText: "text-amber-600",
      };
    default:
      return {
        border: "border-zinc-200",
        iconBg: "bg-zinc-100",
        iconText: "text-zinc-700",
      };
  }
}
