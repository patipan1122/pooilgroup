"use client";

// Security policy form — session timeout, lockout, password complexity.
// PATCHes /api/admin/settings/security.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock, Clock, ShieldAlert, KeyRound } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";

export interface SecurityConfig {
  sessionIdleMinutes: number;
  accessTokenHours: number;
  lockAfterFailedAttempts: number;
  lockDurationMinutes: number;
  password: {
    minLength: number;
    requireSymbol: boolean;
    requireNumber: boolean;
    requireUpper: boolean;
    forceChangeOnFirstLogin: boolean;
  };
}

interface Props {
  initial: SecurityConfig;
}

export function SecurityForm({ initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [sessionIdle, setSessionIdle] = useState(
    String(initial.sessionIdleMinutes),
  );
  const [tokenHours, setTokenHours] = useState(String(initial.accessTokenHours));
  const [lockAfter, setLockAfter] = useState(
    String(initial.lockAfterFailedAttempts),
  );
  const [lockMinutes, setLockMinutes] = useState(
    String(initial.lockDurationMinutes),
  );
  const [minLen, setMinLen] = useState(String(initial.password.minLength));
  const [reqSym, setReqSym] = useState(initial.password.requireSymbol);
  const [reqNum, setReqNum] = useState(initial.password.requireNumber);
  const [reqUpper, setReqUpper] = useState(initial.password.requireUpper);
  const [forceChange, setForceChange] = useState(
    initial.password.forceChangeOnFirstLogin,
  );

  function save() {
    const sessionIdleNum = Number(sessionIdle);
    const tokenHoursNum = Number(tokenHours);
    const lockAfterNum = Number(lockAfter);
    const lockMinutesNum = Number(lockMinutes);
    const minLenNum = Number(minLen);

    if (
      !Number.isFinite(sessionIdleNum) ||
      !Number.isFinite(tokenHoursNum) ||
      !Number.isFinite(lockAfterNum) ||
      !Number.isFinite(lockMinutesNum) ||
      !Number.isFinite(minLenNum)
    ) {
      toast.error("กรุณากรอกตัวเลขให้ครบทุกช่อง");
      return;
    }
    if (sessionIdleNum < 5 || sessionIdleNum > 720) {
      toast.error("Session Timeout ต้องอยู่ระหว่าง 5–720 นาที");
      return;
    }
    if (tokenHoursNum < 1 || tokenHoursNum > 72) {
      toast.error("Access Token ต้องอยู่ระหว่าง 1–72 ชั่วโมง");
      return;
    }
    if (lockAfterNum < 3 || lockAfterNum > 20) {
      toast.error("Failed login ก่อน Lock ต้องอยู่ระหว่าง 3–20 ครั้ง");
      return;
    }
    if (lockMinutesNum < 5 || lockMinutesNum > 180) {
      toast.error("Lock Duration ต้องอยู่ระหว่าง 5–180 นาที");
      return;
    }
    if (minLenNum < 6 || minLenNum > 64) {
      toast.error("Password ขั้นต่ำต้องอยู่ระหว่าง 6–64 ตัวอักษร");
      return;
    }

    startTransition(async () => {
      const res = await fetch("/api/admin/settings/security", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionIdleMinutes: sessionIdleNum,
          accessTokenHours: tokenHoursNum,
          lockAfterFailedAttempts: lockAfterNum,
          lockDurationMinutes: lockMinutesNum,
          password: {
            minLength: minLenNum,
            requireSymbol: reqSym,
            requireNumber: reqNum,
            requireUpper: reqUpper,
            forceChangeOnFirstLogin: forceChange,
          },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(json.error || "บันทึกไม่สำเร็จ");
        return;
      }
      toast.success("บันทึกค่าความปลอดภัยแล้ว");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* Session */}
      <Card className="animate-fade-up">
        <CardHeader>
          <CardTitle>Session & Token</CardTitle>
          <Badge tone="brand">นาที / ชั่วโมง</Badge>
        </CardHeader>
        <CardBody className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="Session Timeout (idle)"
            required
            hint="ไม่กดอะไรเกินกี่นาที → ออกจากระบบ · ค่าเริ่มต้น 60 นาที"
          >
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={sessionIdle}
              onChange={(e) => setSessionIdle(e.target.value.replace(/\D/g, ""))}
              placeholder="เช่น 60"
              prefixSlot={<Clock className="size-4" />}
              suffixSlot={<span className="text-sm">นาที</span>}
            />
          </Field>
          <Field
            label="Access Token TTL"
            required
            hint="JWT Access Token หมดอายุกี่ชั่วโมง · ค่าเริ่มต้น 8 ชม."
          >
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={tokenHours}
              onChange={(e) => setTokenHours(e.target.value.replace(/\D/g, ""))}
              placeholder="เช่น 8"
              prefixSlot={<Clock className="size-4" />}
              suffixSlot={<span className="text-sm">ชม.</span>}
            />
          </Field>
        </CardBody>
      </Card>

      {/* Lockout */}
      <Card className="animate-fade-up delay-75">
        <CardHeader>
          <CardTitle>Failed Login Lockout</CardTitle>
        </CardHeader>
        <CardBody className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="Lock หลัง Login ผิด"
            required
            hint="ผิดเกินจำนวนนี้ → Lock ทันที · ค่าเริ่มต้น 5 ครั้ง"
          >
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={lockAfter}
              onChange={(e) => setLockAfter(e.target.value.replace(/\D/g, ""))}
              placeholder="เช่น 5"
              prefixSlot={<ShieldAlert className="size-4" />}
              suffixSlot={<span className="text-sm">ครั้ง</span>}
            />
          </Field>
          <Field
            label="Lock Duration"
            required
            hint="ติดล็อกนานเท่าไร · ค่าเริ่มต้น 15 นาที"
          >
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={lockMinutes}
              onChange={(e) =>
                setLockMinutes(e.target.value.replace(/\D/g, ""))
              }
              placeholder="เช่น 15"
              prefixSlot={<Lock className="size-4" />}
              suffixSlot={<span className="text-sm">นาที</span>}
            />
          </Field>
        </CardBody>
      </Card>

      {/* Password Policy */}
      <Card className="animate-fade-up delay-100">
        <CardHeader>
          <CardTitle>Password Policy</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <Field
            label="ความยาวขั้นต่ำ"
            required
            hint="แนะนำ 8 ตัวอักษรขึ้นไป"
          >
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={minLen}
              onChange={(e) => setMinLen(e.target.value.replace(/\D/g, ""))}
              placeholder="เช่น 8"
              prefixSlot={<KeyRound className="size-4" />}
              suffixSlot={<span className="text-sm">ตัวอักษร</span>}
            />
          </Field>

          <div className="space-y-2">
            <CheckRow
              label="ต้องมีตัวเลข"
              hint="เช่น p@ss1234"
              active={reqNum}
              onToggle={() => setReqNum((v) => !v)}
            />
            <CheckRow
              label="ต้องมีตัวพิมพ์ใหญ่"
              hint="เช่น Password1"
              active={reqUpper}
              onToggle={() => setReqUpper((v) => !v)}
            />
            <CheckRow
              label="ต้องมีอักขระพิเศษ"
              hint="เช่น @#$! · เพิ่มความปลอดภัย"
              active={reqSym}
              onToggle={() => setReqSym((v) => !v)}
            />
            <CheckRow
              label="บังคับเปลี่ยน Password ครั้งแรกที่ Login"
              hint="ผู้ใช้ใหม่ต้องตั้งใหม่เอง · แนะนำเปิด"
              active={forceChange}
              onToggle={() => setForceChange((v) => !v)}
            />
          </div>
        </CardBody>
      </Card>

      {/* Sticky save */}
      <div className="sticky bottom-4 z-10 mt-6">
        <div className="rounded-2xl border-2 border-zinc-200 bg-white/95 backdrop-blur shadow-pop p-3 flex items-center justify-between gap-3">
          <p className="text-xs text-zinc-500">บันทึกการแก้ไขใน Audit Log</p>
          <Button onClick={save} loading={pending}>
            บันทึก
          </Button>
        </div>
      </div>
    </div>
  );
}

function CheckRow({
  label,
  hint,
  active,
  onToggle,
}: {
  label: string;
  hint: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "w-full text-left flex items-start gap-3 rounded-xl border-2 p-3 transition-colors",
        active
          ? "border-[var(--color-brand-200)] bg-[var(--color-brand-50)]/40"
          : "border-zinc-200 bg-white hover:border-zinc-300",
      )}
    >
      <span
        className={cn(
          "mt-0.5 size-5 rounded-md border-2 shrink-0 flex items-center justify-center transition-colors",
          active
            ? "border-[var(--color-brand-600)] bg-[var(--color-brand-600)]"
            : "border-zinc-300 bg-white",
        )}
      >
        {active && (
          <svg
            viewBox="0 0 16 16"
            className="size-3 text-white"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          >
            <path d="M3 8l3 3 7-7" />
          </svg>
        )}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-zinc-900">{label}</div>
        <div className="text-xs text-zinc-500 mt-0.5">{hint}</div>
      </div>
    </button>
  );
}
