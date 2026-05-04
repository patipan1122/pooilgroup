"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, Check, User, Mail, Phone } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { cn } from "@/lib/utils/cn";

interface BranchOption {
  id: string;
  code: string;
  name: string;
  business_type: string;
}

const ROLES: { value: string; label: string; desc: string }[] = [
  { value: "branch_manager", label: "Branch Manager", desc: "ผู้จัดการสาขา · อนุมัติรายงานสาขาตัวเอง" },
  { value: "staff", label: "Staff", desc: "พนักงาน · กรอกรายงาน" },
  { value: "org_admin", label: "Admin", desc: "ผู้ดูแลระบบ · จัดการผู้ใช้/สาขาทั้งหมด" },
  { value: "viewer", label: "Viewer", desc: "ดูได้อย่างเดียว · ไม่แก้ไข" },
];

export function InviteForm({ branches }: { branches: BranchOption[] }) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("staff");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function toggleBranch(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("กรุณากรอกชื่อ");
      return;
    }

    startTransition(async () => {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          role,
          branchIds: Array.from(selected),
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        toast.error(json.error || "สร้างคำเชิญไม่สำเร็จ");
        return;
      }

      setInviteUrl(json.inviteUrl);
      toast.success("สร้าง invite link สำเร็จ", {
        description: "Copy ส่งให้ผู้ใช้ใน LINE",
      });
    });
  }

  function copyLink() {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    toast.success("Copy แล้ว");
    setTimeout(() => setCopied(false), 2000);
  }

  if (inviteUrl) {
    return (
      <Card className="animate-fade-up">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Check className="size-5 text-green-600" />
            สร้างคำเชิญสำเร็จ
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="rounded-xl bg-[--color-brand-50] border-2 border-[--color-brand-200] p-4">
            <p className="text-xs text-[--color-brand-700] font-semibold uppercase tracking-widest mb-2">
              Invite Link · หมดอายุ 48 ชม.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono bg-white rounded-lg px-3 py-2 border border-[--color-brand-200] truncate">
                {inviteUrl}
              </code>
              <Button onClick={copyLink} size="md">
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "Copied" : "Copy"}
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
            <Button
              variant="outline"
              onClick={() => {
                setInviteUrl(null);
                setName("");
                setEmail("");
                setPhone("");
                setSelected(new Set());
              }}
              fullWidth
            >
              เชิญคนถัดไป
            </Button>
            <a href="/users" className="contents">
              <Button variant="ghost" fullWidth>
                เสร็จสิ้น
              </Button>
            </a>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card className="animate-fade-up delay-100">
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
          <Field label="อีเมล" optional hint="ใช้สำหรับเข้าสู่ระบบทาง Web">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="เช่น staff@poolgroup.com"
              prefixSlot={<Mail className="size-4" />}
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
                  ? "border-[--color-brand-500] bg-[--color-brand-50]"
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

      {(role === "branch_manager" || role === "staff") && branches.length > 0 && (
        <Card className="mt-4 animate-fade-up delay-200">
          <CardHeader>
            <CardTitle>สาขาที่ดูแล</CardTitle>
            <Badge tone="brand">{selected.size} เลือก</Badge>
          </CardHeader>
          <CardBody className="!pt-0">
            <p className="text-xs text-zinc-500 mb-3">
              เลือกสาขาที่ผู้ใช้นี้จะเข้าถึง — กรอก/อนุมัติได้เฉพาะสาขาเหล่านี้
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {branches.map((b) => {
                const cfg = BUSINESS_TYPES[b.business_type];
                return (
                  <label
                    key={b.id}
                    className={cn(
                      "flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-colors",
                      selected.has(b.id)
                        ? "border-[--color-brand-500] bg-[--color-brand-50]"
                        : "border-zinc-200 hover:bg-zinc-50",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(b.id)}
                      onChange={() => toggleBranch(b.id)}
                      className="size-4"
                    />
                    <span className="text-lg">{cfg?.emoji ?? "📋"}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {b.code}
                      </div>
                      <div className="text-xs text-zinc-500 truncate">
                        {b.name}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </CardBody>
        </Card>
      )}

      <div className="mt-6 flex gap-2 sm:justify-end animate-fade-up delay-300">
        <Button type="submit" size="lg" loading={pending} disabled={!name.trim()}>
          สร้าง Invite Link
        </Button>
      </div>
    </form>
  );
}
