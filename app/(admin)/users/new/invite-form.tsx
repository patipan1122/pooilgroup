"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Copy,
  Check,
  User,
  Mail,
  Phone,
  Lock,
  Shuffle,
  Eye,
  EyeOff,
} from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BranchPicker, type BranchOption } from "@/components/users/branch-picker";
import { cn } from "@/lib/utils/cn";

const ROLES: { value: string; label: string; desc: string }[] = [
  { value: "program_admin", label: "แอดมินโปรแกรม", desc: "ดูแลเฉพาะโปรแกรมที่เลือก · เชิญทีมในโปรแกรมเองได้ · ไม่เห็นโปรแกรมอื่น" },
  { value: "branch_manager", label: "Branch Manager", desc: "ผู้จัดการสาขา · อนุมัติรายงานสาขาตัวเอง" },
  { value: "staff", label: "Staff", desc: "พนักงาน · กรอกรายงาน" },
  { value: "org_admin", label: "Admin (เห็นทุกโปรแกรม)", desc: "ผู้ดูแลระบบ · จัดการผู้ใช้/สาขาทั้งหมด" },
  { value: "viewer", label: "Viewer", desc: "ดูได้อย่างเดียว · ไม่แก้ไข" },
];

type Mode = "invite" | "direct";

type SuccessResult =
  | { mode: "invite"; inviteUrl: string }
  | { mode: "direct"; email: string; password: string };

function generatePassword(): string {
  // 12-char readable random password (no ambiguous chars)
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export function InviteForm({
  branches,
  programs,
}: {
  branches: BranchOption[];
  programs: { slug: string; name: string; emoji: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>("invite");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("staff");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Programs a "program_admin" will administer (slugs).
  const [programSel, setProgramSel] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<SuccessResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("กรุณากรอกชื่อ");
      return;
    }
    if (mode === "direct") {
      if (!email.trim()) {
        toast.error("ตั้งรหัสผ่านต้องระบุอีเมล");
        return;
      }
      if (password.length < 8) {
        toast.error("รหัสผ่านอย่างน้อย 8 ตัว");
        return;
      }
    }
    if (role === "program_admin" && programSel.size === 0) {
      toast.error("เลือกอย่างน้อย 1 โปรแกรมที่จะให้ดูแล");
      return;
    }

    // "แอดมินโปรแกรม" = org-role viewer (ลงหน้า /home แต่ไม่ใช่แอดมินรวม)
    // + ได้สิทธิ์แอดมินเฉพาะโปรแกรมที่เลือก
    const isProgramAdmin = role === "program_admin";
    const payloadRole = isProgramAdmin ? "viewer" : role;
    const adminModules = isProgramAdmin ? Array.from(programSel) : undefined;

    startTransition(async () => {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          role: payloadRole,
          adminModules,
          branchIds: Array.from(selected),
          password: mode === "direct" ? password : undefined,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        toast.error(json.error || "สร้างผู้ใช้ไม่สำเร็จ");
        return;
      }

      if (json.mode === "direct_password") {
        setResult({
          mode: "direct",
          email: json.email,
          password: json.password,
        });
        toast.success("สร้างบัญชีสำเร็จ — พร้อมใช้งาน");
      } else {
        setResult({ mode: "invite", inviteUrl: json.inviteUrl });
        toast.success("สร้าง invite link สำเร็จ");
      }
    });
  }

  function copy(value: string, key: string) {
    navigator.clipboard.writeText(value);
    setCopied(key);
    toast.success("Copy แล้ว");
    setTimeout(() => setCopied(null), 2000);
  }

  function reset() {
    setResult(null);
    setName("");
    setEmail("");
    setPhone("");
    setPassword("");
    setSelected(new Set());
    setProgramSel(new Set());
  }

  function toggleProgram(slug: string) {
    setProgramSel((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  if (result?.mode === "invite") {
    return (
      <Card className="animate-fade-up">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Check className="size-5 text-green-600" />
            สร้างคำเชิญสำเร็จ
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="rounded-xl bg-[var(--color-brand-50)] border-2 border-[var(--color-brand-200)] p-4">
            <p className="text-xs text-[var(--color-brand-700)] font-semibold mb-2">
              Invite Link · หมดอายุ 48 ชม.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono bg-white rounded-lg px-3 py-2 border border-[var(--color-brand-200)] truncate">
                {result.inviteUrl}
              </code>
              <Button onClick={() => copy(result.inviteUrl, "url")} size="md">
                {copied === "url" ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied === "url" ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
          <div className="text-sm text-zinc-600 space-y-2">
            <p>
              ✉️ <strong>ส่งลิงก์นี้</strong> ให้ผู้ใช้ใหม่ใน LINE หรือ
              email — เขาคลิกเข้าจะตั้ง password เอง
            </p>
            <p>
              ⏰ ลิงก์ใช้ได้ <strong>ครั้งเดียว</strong>{" "}
              และหมดอายุ 48 ชั่วโมง
            </p>
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={reset} fullWidth>
              เชิญคนถัดไป
            </Button>
            <Link href="/users" className="contents">
              <Button variant="ghost" fullWidth>
                เสร็จสิ้น
              </Button>
            </Link>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (result?.mode === "direct") {
    return (
      <Card className="animate-fade-up">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Check className="size-5 text-green-600" />
            สร้างบัญชีสำเร็จ — พร้อมใช้งานทันที
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="rounded-xl bg-[var(--color-brand-50)] border-2 border-[var(--color-brand-200)] p-4 space-y-3">
            <div>
              <p className="text-xs text-[var(--color-brand-700)] font-semibold mb-1">
                อีเมล
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm font-mono bg-white rounded-lg px-3 py-2 border border-[var(--color-brand-200)] truncate">
                  {result.email}
                </code>
                <Button onClick={() => copy(result.email, "email")} size="md" variant="outline">
                  {copied === "email" ? <Check className="size-4" /> : <Copy className="size-4" />}
                </Button>
              </div>
            </div>
            <div>
              <p className="text-xs text-[var(--color-brand-700)] font-semibold mb-1">
                รหัสผ่าน
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm font-mono bg-white rounded-lg px-3 py-2 border border-[var(--color-brand-200)] truncate">
                  {result.password}
                </code>
                <Button onClick={() => copy(result.password, "pwd")} size="md">
                  {copied === "pwd" ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {copied === "pwd" ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          </div>
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900 space-y-1">
            <p>⚠️ <strong>โชว์ครั้งเดียว</strong> — ระบบไม่เก็บรหัสไว้ Copy ส่งให้ผู้ใช้ก่อนปิดหน้า</p>
            <p>🔐 ผู้ใช้จะถูกบังคับให้ <strong>เปลี่ยนรหัสครั้งแรกที่ login</strong></p>
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={reset} fullWidth>
              สร้างคนถัดไป
            </Button>
            <Link href="/users" className="contents">
              <Button variant="ghost" fullWidth>
                เสร็จสิ้น
              </Button>
            </Link>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* Mode selector */}
      <Card className="animate-fade-up">
        <CardHeader>
          <CardTitle>วิธีให้สิทธิ์</CardTitle>
        </CardHeader>
        <CardBody className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label
            className={cn(
              "flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors",
              mode === "invite"
                ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
                : "border-zinc-200 hover:bg-zinc-50",
            )}
          >
            <input
              type="radio"
              name="mode"
              checked={mode === "invite"}
              onChange={() => setMode("invite")}
              className="mt-1"
            />
            <div>
              <div className="font-semibold text-sm">ส่ง Invite Link</div>
              <div className="text-xs text-zinc-500">
                ผู้ใช้ตั้งรหัสเอง · หมดอายุ 48 ชม.
              </div>
            </div>
          </label>
          <label
            className={cn(
              "flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors",
              mode === "direct"
                ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
                : "border-zinc-200 hover:bg-zinc-50",
            )}
          >
            <input
              type="radio"
              name="mode"
              checked={mode === "direct"}
              onChange={() => setMode("direct")}
              className="mt-1"
            />
            <div>
              <div className="font-semibold text-sm">ตั้งรหัสผ่านเอง</div>
              <div className="text-xs text-zinc-500">
                บัญชีพร้อมใช้ทันที · ส่งให้ผู้ใช้ทาง chat
              </div>
            </div>
          </label>
        </CardBody>
      </Card>

      <Card className="mt-4 animate-fade-up delay-100">
        <CardHeader>
          <CardTitle>ข้อมูลผู้ใช้</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <Field label="ชื่อ-นามสกุล" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น สมชาย ใจดี"
              prefixSlot={<User className="size-4" />}
              required
            />
          </Field>
          <Field
            label="อีเมล"
            required={mode === "direct"}
            optional={mode === "invite"}
            hint={mode === "direct" ? "ใช้ login" : "ใช้สำหรับเข้าสู่ระบบทาง Web"}
          >
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="เช่น staff@pooilgroup.com"
              prefixSlot={<Mail className="size-4" />}
              required={mode === "direct"}
            />
          </Field>
          <Field label="เบอร์โทร" optional hint="ใช้สำหรับ Telegram bot">
            <Input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="เช่น 081-234-5678"
              prefixSlot={<Phone className="size-4" />}
            />
          </Field>

          {mode === "direct" && (
            <Field label="รหัสผ่าน" required hint="อย่างน้อย 8 ตัว — ผู้ใช้จะต้องเปลี่ยนเองเมื่อ login">
              <div className="flex items-center gap-2">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  prefixSlot={<Lock className="size-4" />}
                  minLength={8}
                  required
                  autoComplete="new-password"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  onClick={() => setShowPassword((s) => !s)}
                  title={showPassword ? "ซ่อน" : "แสดง"}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  onClick={() => {
                    setPassword(generatePassword());
                    setShowPassword(true);
                  }}
                  title="สุ่มรหัส"
                >
                  <Shuffle className="size-4" />
                  สุ่ม
                </Button>
              </div>
            </Field>
          )}
        </CardBody>
      </Card>

      <Card className="mt-4 animate-fade-up delay-150">
        <CardHeader>
          <CardTitle>บทบาท</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          {ROLES.map((r) => (
            <label
              key={r.value}
              className={cn(
                "flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors",
                role === r.value
                  ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
                  : "border-zinc-200 hover:bg-zinc-50",
              )}
            >
              <input
                type="radio"
                name="role"
                value={r.value}
                checked={role === r.value}
                onChange={() => setRole(r.value)}
                className="mt-1"
              />
              <div>
                <div className="font-semibold text-sm">{r.label}</div>
                <div className="text-xs text-zinc-500">{r.desc}</div>
              </div>
            </label>
          ))}
        </CardBody>
      </Card>

      {role === "program_admin" && (
        <Card className="mt-4 animate-fade-up delay-200">
          <CardHeader>
            <CardTitle>โปรแกรมที่ให้ดูแล</CardTitle>
          </CardHeader>
          <CardBody className="!pt-0">
            <p className="text-xs text-zinc-500 mb-3">
              ผู้ใช้นี้จะเป็น <strong>แอดมิน</strong> เฉพาะโปรแกรมที่ติ๊ก —
              เห็นเฉพาะโปรแกรมเหล่านี้ในหน้ารวม และเชิญทีมในโปรแกรมเองได้
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {programs.map((p) => {
                const on = programSel.has(p.slug);
                return (
                  <label
                    key={p.slug}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors",
                      on
                        ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
                        : "border-zinc-200 hover:bg-zinc-50",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleProgram(p.slug)}
                    />
                    <span className="text-xl">{p.emoji}</span>
                    <span className="font-semibold text-sm">{p.name}</span>
                  </label>
                );
              })}
            </div>
            {programSel.size > 0 && (
              <p className="text-xs text-[var(--color-brand-700)] font-semibold mt-3">
                เลือกแล้ว {programSel.size} โปรแกรม
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {(role === "branch_manager" || role === "staff") && branches.length > 0 && (
        <Card className="mt-4 animate-fade-up delay-200">
          <CardHeader>
            <CardTitle>สาขาที่ดูแล</CardTitle>
          </CardHeader>
          <CardBody className="!pt-0">
            <p className="text-xs text-zinc-500 mb-3">
              เลือกสาขาที่ผู้ใช้นี้จะเข้าถึง — กรอก/อนุมัติได้เฉพาะสาขาเหล่านี้
            </p>
            <BranchPicker
              branches={branches}
              selected={selected}
              onChange={setSelected}
            />
          </CardBody>
        </Card>
      )}

      <div className="mt-6 flex gap-2 sm:justify-end animate-fade-up delay-300">
        <Button type="submit" size="lg" loading={pending} disabled={!name.trim()}>
          {mode === "direct" ? "สร้างบัญชี" : "สร้าง Invite Link"}
        </Button>
      </div>
    </form>
  );
}
