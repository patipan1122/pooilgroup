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
import { BranchPicker, type BranchOption } from "@/components/users/branch-picker";
import { cn } from "@/lib/utils/cn";

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
  {
    value: "program_admin",
    label: "แอดมินโปรแกรม",
    desc: "เห็น + ดูแลเฉพาะโปรแกรมที่เลือกด้านล่าง",
  },
  { value: "staff", label: "Staff", desc: "พนักงาน · กรอกรายงาน" },
  { value: "driver", label: "Driver", desc: "คนขับ · FuelOS Driver App" },
  { value: "viewer", label: "Viewer", desc: "ดูได้อย่างเดียว" },
];

interface ProgramOption {
  slug: string;
  name: string;
  emoji: string;
}

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
  programs: ProgramOption[];
  initialModules: string[];
  initialAdminModules: string[];
  isSelf: boolean;
  // เฉพาะ super_admin เท่านั้นที่เลือกบทบาทระดับแอดมินได้ (CEO 2026-06-15)
  canAppointAdmins: boolean;
}

export function EditUserForm({
  userId,
  initial,
  initialBranchIds,
  branches,
  programs,
  initialModules,
  initialAdminModules,
  isSelf,
  canAppointAdmins,
}: Props) {
  // ซ่อนตัวเลือกบทบาทระดับแอดมินจาก non-super · แต่คงบทบาทปัจจุบันของผู้ใช้ไว้
  // เสมอ เพื่อให้ฟอร์มแสดงค่าที่ถูกต้องและแก้ผู้ใช้ทั่วไปได้ตามปกติ
  const visibleRoles = canAppointAdmins
    ? ROLES
    : ROLES.filter(
        (r) =>
          !["super_admin", "org_admin", "program_admin"].includes(r.value) ||
          r.value === initial.role,
      );
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initial.name);
  const [email, setEmail] = useState(initial.email ?? "");
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [role, setRole] = useState(initial.role);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initialBranchIds),
  );
  // โปรแกรมที่ผู้ใช้นี้เข้าถึงได้ + ชุดย่อยที่เป็น "แอดมินโปรแกรม"
  const [programSel, setProgramSel] = useState<Set<string>>(
    new Set(initialModules),
  );
  const [adminSel, setAdminSel] = useState<Set<string>>(
    new Set(initialAdminModules),
  );

  function toggleProgram(slug: string) {
    setProgramSel((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
        // เอาโปรแกรมออก = ถอดสิทธิ์แอดมินของโปรแกรมนั้นด้วย
        setAdminSel((a) => {
          const na = new Set(a);
          na.delete(slug);
          return na;
        });
      } else {
        next.add(slug);
        // โปรแกรมใหม่ default = แอดมิน (ผู้ใช้ตั้งใจให้เขาดูแลโปรแกรมนี้)
        setAdminSel((a) => new Set(a).add(slug));
      }
      return next;
    });
  }

  function setProgramRole(slug: string, isAdmin: boolean) {
    setAdminSel((prev) => {
      const next = new Set(prev);
      if (isAdmin) next.add(slug);
      else next.delete(slug);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("กรุณากรอกชื่อ");
      return;
    }
    if (role === "program_admin" && programSel.size === 0) {
      toast.error("เลือกอย่างน้อย 1 โปรแกรมที่จะให้เข้าถึง");
      return;
    }

    startTransition(async () => {
      // 1) บันทึกข้อมูลผู้ใช้ + บทบาท
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

      // 2) ถ้าเป็นแอดมินโปรแกรม → บันทึกสิทธิ์โปรแกรม (แทนที่ชุดเดิมทั้งหมด)
      if (role === "program_admin") {
        const modRes = await fetch(`/api/admin/users/${userId}/modules`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modules: Array.from(programSel),
            adminModules: Array.from(adminSel),
          }),
        });
        const modJson = await modRes.json();
        if (!modRes.ok) {
          toast.error(
            modJson.error ||
              "บันทึกข้อมูลแล้ว แต่ตั้งสิทธิ์โปรแกรมไม่สำเร็จ — ลองอีกครั้ง",
          );
          return;
        }
      }

      toast.success("บันทึกการแก้ไขแล้ว");
      router.push(`/users/${userId}`);
      router.refresh();
    });
  }

  const showBranches = role === "branch_manager" || role === "staff";
  const showPrograms = role === "program_admin";

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
          {visibleRoles.map((r) => (
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

      {showPrograms && (
        <Card className="mt-4 animate-fade-up delay-200">
          <CardHeader>
            <CardTitle>โปรแกรมที่เข้าถึงได้</CardTitle>
            {programSel.size > 0 && (
              <Badge tone="brand">{programSel.size} โปรแกรม</Badge>
            )}
          </CardHeader>
          <CardBody className="!pt-0">
            <p className="text-xs text-zinc-500 mb-3">
              ติ๊กโปรแกรมที่จะให้ผู้ใช้นี้เห็น — เลือกได้ว่าเป็น{" "}
              <strong>แอดมิน</strong> (จัดการทีมในโปรแกรมได้) หรือ{" "}
              <strong>สมาชิก</strong> (เข้าดู/ใช้ได้แต่จัดการคนไม่ได้)
            </p>
            <div className="space-y-2">
              {programs.map((p) => {
                const on = programSel.has(p.slug);
                const isAdmin = adminSel.has(p.slug);
                return (
                  <div
                    key={p.slug}
                    className={cn(
                      "rounded-xl border-2 transition-colors",
                      on
                        ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
                        : "border-zinc-200",
                    )}
                  >
                    <label className="flex items-center gap-3 p-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleProgram(p.slug)}
                      />
                      <span className="text-xl">{p.emoji}</span>
                      <span className="font-semibold text-sm flex-1">
                        {p.name}
                      </span>
                    </label>
                    {on && (
                      <div className="flex gap-2 px-3 pb-3 pl-12">
                        <button
                          type="button"
                          onClick={() => setProgramRole(p.slug, true)}
                          className={cn(
                            "text-xs font-semibold rounded-lg px-3 py-1.5 border-2 transition-colors",
                            isAdmin
                              ? "border-[var(--color-brand-500)] bg-[var(--color-brand-600)] text-white"
                              : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
                          )}
                        >
                          แอดมิน
                        </button>
                        <button
                          type="button"
                          onClick={() => setProgramRole(p.slug, false)}
                          className={cn(
                            "text-xs font-semibold rounded-lg px-3 py-1.5 border-2 transition-colors",
                            !isAdmin
                              ? "border-zinc-400 bg-zinc-700 text-white"
                              : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
                          )}
                        >
                          สมาชิก
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>
      )}

      {showBranches && branches.length > 0 && (
        <Card className="mt-4 animate-fade-up delay-200">
          <CardHeader>
            <CardTitle>สาขาที่ดูแล</CardTitle>
          </CardHeader>
          <CardBody className="!pt-0">
            <p className="text-xs text-zinc-500 mb-3">
              เลือกสาขาที่ผู้ใช้นี้จะเข้าถึง
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
