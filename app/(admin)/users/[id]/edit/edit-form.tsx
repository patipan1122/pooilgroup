"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { User, Mail, Phone } from "lucide-react";
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
  {
    value: "super_admin",
    label: "Super Admin",
    desc: "สูงสุด · ทุกสิทธิ์ · เห็นทุกองค์กร",
  },
  {
    value: "org_admin",
    label: "Admin",
    desc: "ผู้ดูแลระบบ · จัดการผู้ใช้/สาขา",
  },
  {
    value: "branch_manager",
    label: "Branch Manager",
    desc: "ผู้จัดการสาขา · อนุมัติรายงาน",
  },
  { value: "staff", label: "Staff", desc: "พนักงาน · กรอกรายงาน" },
  { value: "driver", label: "Driver", desc: "คนขับ · FuelOS Driver App" },
  { value: "viewer", label: "Viewer", desc: "ดูได้อย่างเดียว" },
];

interface Props {
  userId: string;
  initial: {
    name: string;
    email: string | null;
    phone: string | null;
    role: string;
  };
  initialBranchIds: string[];
  branches: BranchOption[];
  isSelf: boolean;
}

export function EditUserForm({
  userId,
  initial,
  initialBranchIds,
  branches,
  isSelf,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initial.name);
  const [email, setEmail] = useState(initial.email ?? "");
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [role, setRole] = useState(initial.role);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initialBranchIds),
  );

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
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim() || null,
          phone: phone.trim() || null,
          role,
          branchIds: Array.from(selected),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "บันทึกไม่สำเร็จ");
        return;
      }
      toast.success("บันทึกการแก้ไขแล้ว");
      router.push(`/users/${userId}`);
      router.refresh();
    });
  }

  const showBranches = role === "branch_manager" || role === "staff";

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
              prefixSlot={<User className="size-4" />}
              required
            />
          </Field>
          <Field label="อีเมล" optional>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="เช่น staff@pooilgroup.com"
              prefixSlot={<Mail className="size-4" />}
            />
          </Field>
          <Field label="เบอร์โทร" optional hint="ใช้สำหรับ Telegram">
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
          {isSelf && <Badge tone="warning">บัญชีตัวเอง</Badge>}
        </CardHeader>
        <CardBody className="space-y-2">
          {isSelf && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
              ⚠️ ระวัง: เปลี่ยนบทบาทตัวเองอาจเสียสิทธิ์เข้าหน้านี้ได้
            </p>
          )}
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

      {showBranches && branches.length > 0 && (
        <Card className="mt-4 animate-fade-up delay-200">
          <CardHeader>
            <CardTitle>สาขาที่ดูแล</CardTitle>
            <Badge tone="brand">{selected.size} เลือก</Badge>
          </CardHeader>
          <CardBody className="!pt-0">
            <p className="text-xs text-zinc-500 mb-3">
              เลือกสาขาที่ผู้ใช้นี้จะเข้าถึง
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
                        ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
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
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push(`/users/${userId}`)}
          disabled={pending}
        >
          ยกเลิก
        </Button>
        <Button
          type="submit"
          size="lg"
          loading={pending}
          disabled={!name.trim()}
        >
          บันทึกการแก้ไข
        </Button>
      </div>
    </form>
  );
}
