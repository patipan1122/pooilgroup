"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  User as UserIcon,
  Phone,
  Mail,
  MessageSquare,
  CheckCircle2,
  Building2,
  IdCard,
} from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { cn } from "@/lib/utils/cn";

interface BranchOption {
  id: string;
  code: string;
  name: string;
  business_type: string;
}

const ROLES = [
  {
    value: "branch_manager",
    label: "ผู้จัดการสาขา",
    desc: "ดูแลสาขาเดียว · กรอก/อนุมัติรายงาน",
  },
  {
    value: "area_manager",
    label: "ผู้จัดการเขต",
    desc: "ดูแลหลายสาขา · อนุมัติรายงานข้ามสาขาในเขต",
  },
  { value: "staff", label: "พนักงาน", desc: "กรอกรายงานสาขา" },
  {
    value: "driver",
    label: "คนขับ",
    desc: "ขับรถส่งน้ำมัน · FuelOS Driver App",
  },
  {
    value: "viewer",
    label: "ผู้ดู (Read-only)",
    desc: "ดูข้อมูลได้อย่างเดียว · บัญชี/HR",
  },
];

export function JoinForm({ branches }: { branches: BranchOption[] }) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("branch_manager");
  const [branchId, setBranchId] = useState("");
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim() || !employeeCode.trim()) {
      toast.error("กรุณากรอกชื่อ เบอร์ และรหัสพนักงาน");
      return;
    }

    startTransition(async () => {
      const res = await fetch("/api/auth/register-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          employeeCode: employeeCode.trim().toUpperCase(),
          phone: phone.trim(),
          email: email.trim() || undefined,
          requestedRole: role,
          branchId: branchId || null,
          notes: notes.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || "ส่งคำขอไม่สำเร็จ");
        return;
      }
      setSubmitted(true);
      toast.success("ส่งคำขอแล้ว · รอ Admin ติดต่อกลับ");
    });
  }

  if (submitted) {
    return (
      <Card className="animate-fade-up">
        <CardBody className="text-center py-10 space-y-3">
          <div className="size-14 rounded-2xl bg-green-100 text-green-600 flex items-center justify-center mx-auto">
            <CheckCircle2 className="size-7" />
          </div>
          <h3 className="text-xl font-bold font-display">ส่งคำขอเรียบร้อย</h3>
          <p className="text-sm text-zinc-600 max-w-sm mx-auto">
            Admin จะติดต่อกลับทาง LINE หรือเบอร์โทรที่ให้ไว้ภายใน 1-2 วันทำการ
          </p>
          <p className="text-xs text-zinc-400">
            ถ้าด่วน ติดต่อเจ้าของระบบโดยตรง
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card className="animate-fade-up delay-100">
        <CardHeader>
          <CardTitle>ข้อมูลของคุณ</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <Field label="ชื่อ-นามสกุล" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น สมชาย ใจดี"
              prefixSlot={<UserIcon className="size-4" />}
              required
            />
          </Field>
          <Field
            label="รหัสพนักงาน"
            required
            hint="รหัสจาก Humansoft (ตัวอักษรพิมพ์ใหญ่ + ตัวเลข)"
          >
            <Input
              value={employeeCode}
              onChange={(e) => setEmployeeCode(e.target.value.toUpperCase())}
              placeholder="เช่น EMP-1024"
              prefixSlot={<IdCard className="size-4" />}
              required
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
          </Field>
          <Field label="เบอร์โทร" required hint="ใช้สำหรับติดต่อกลับ + Telegram">
            <Input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="เช่น 081-234-5678"
              prefixSlot={<Phone className="size-4" />}
              required
            />
          </Field>
          <Field label="อีเมล" optional>
            <Input
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="เช่น staff@pooilgroup.com"
              prefixSlot={<Mail className="size-4" />}
            />
          </Field>
        </CardBody>
      </Card>

      <Card className="mt-4 animate-fade-up delay-150">
        <CardHeader>
          <CardTitle>คุณจะมาทำหน้าที่อะไร?</CardTitle>
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

      {(role === "staff" || role === "branch_manager") && branches.length > 0 && (
        <Card className="mt-4 animate-fade-up delay-200">
          <CardHeader>
            <CardTitle>สาขาที่จะดูแล</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-xs text-zinc-500 mb-3">
              เลือกสาขาหลักที่คุณจะทำงาน · Admin อาจปรับให้ภายหลัง
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-auto">
              <label
                className={cn(
                  "flex items-center gap-2.5 p-2.5 rounded-xl border-2 cursor-pointer transition-colors",
                  !branchId
                    ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
                    : "border-zinc-200 hover:bg-zinc-50",
                )}
              >
                <input
                  type="radio"
                  name="branch"
                  value=""
                  checked={!branchId}
                  onChange={() => setBranchId("")}
                />
                <Building2 className="size-4 text-zinc-400" />
                <span className="text-sm">ยังไม่เลือก / ไม่แน่ใจ</span>
              </label>
              {branches.map((b) => {
                const cfg = BUSINESS_TYPES[b.business_type];
                return (
                  <label
                    key={b.id}
                    className={cn(
                      "flex items-center gap-2.5 p-2.5 rounded-xl border-2 cursor-pointer transition-colors",
                      branchId === b.id
                        ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
                        : "border-zinc-200 hover:bg-zinc-50",
                    )}
                  >
                    <input
                      type="radio"
                      name="branch"
                      value={b.id}
                      checked={branchId === b.id}
                      onChange={() => setBranchId(b.id)}
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

      <Card className="mt-4 animate-fade-up delay-250">
        <CardHeader>
          <CardTitle>หมายเหตุ (ถ้ามี)</CardTitle>
        </CardHeader>
        <CardBody>
          <Field
            label="หมายเหตุถึง Admin"
            optional
            hint="เช่น ผู้แนะนำ · วันเริ่มงาน · ข้อมูลอื่น ๆ"
          >
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="เช่น สมัครจาก ผจก. ใจดี · เริ่มงาน 5 พ.ค."
              rows={3}
              maxLength={500}
              className="w-full rounded-xl border-2 border-zinc-200 bg-white p-3.5 text-base focus:border-[var(--color-brand-500)] focus:outline-none transition-colors resize-none"
            />
          </Field>
          <p className="text-[11px] text-zinc-400 flex items-center gap-1 mt-2">
            <MessageSquare className="size-3" />
            Admin จะติดต่อกลับภายใน 1-2 วัน
          </p>
        </CardBody>
      </Card>

      <Button
        type="submit"
        size="lg"
        fullWidth
        className="mt-6 animate-fade-up delay-300"
        loading={pending}
        disabled={!name.trim() || !phone.trim() || !employeeCode.trim()}
      >
        {pending ? "กำลังส่ง..." : "ส่งคำขอเข้าใช้งาน"}
      </Button>
    </form>
  );
}
