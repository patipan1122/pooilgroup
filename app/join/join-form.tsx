"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import {
  User as UserIcon,
  Phone,
  Mail,
  MessageSquare,
  CheckCircle2,
  Building2,
  IdCard,
  Search,
  ChevronDown,
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
    desc: "ขับรถส่งน้ำมัน · FuelOS Driver App (ใช้ Telegram)",
  },
  {
    value: "viewer",
    label: "ผู้ดู (Read-only)",
    desc: "ดูข้อมูลได้อย่างเดียว · บัญชี/HR",
  },
] as const;

type RoleValue = (typeof ROLES)[number]["value"];

// Client-side Zod schema — mirrors server but with Thai-friendly messages
// that tell the user how to fix the error, not just that something is wrong.
const FormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "กรอกชื่อ-นามสกุลให้ครบ (อย่างน้อย 2 ตัวอักษร)")
    .max(120, "ชื่อยาวเกินไป (เกิน 120 ตัวอักษร) — พิมพ์ย่อได้"),
  employeeCode: z
    .string()
    .trim()
    .min(2, "ใส่รหัสพนักงานจาก Humansoft (เช่น EMP-1024)")
    .max(50, "รหัสพนักงานยาวเกินไป")
    .regex(/^[A-Za-z0-9-]+$/, "ใช้ได้เฉพาะตัวอักษร A–Z ตัวเลข 0–9 และเครื่องหมายขีด —"),
  phone: z
    .string()
    .trim()
    .regex(
      /^[0-9-+\s]{9,20}$/,
      "เบอร์โทรไม่ถูกต้อง — ใส่เลข 9-20 หลัก (เช่น 081-234-5678)",
    ),
  email: z
    .string()
    .trim()
    .email("รูปแบบอีเมลไม่ถูกต้อง (เช่น somchai@gmail.com)")
    .optional()
    .or(z.literal("")),
  requestedRole: z.enum([
    "staff",
    "branch_manager",
    "area_manager",
    "driver",
    "viewer",
  ]),
  businessType: z.string().optional().or(z.literal("")),
  branchId: zUUID().nullable().optional(),
  notes: z.string().max(500, "หมายเหตุยาวเกิน 500 ตัวอักษร").optional().or(z.literal("")),
});

type FormErrors = Partial<Record<keyof z.infer<typeof FormSchema>, string>>;

const ROLES_REQUIRING_BRANCH: RoleValue[] = ["staff", "branch_manager"];

export function JoinForm({ branches }: { branches: BranchOption[] }) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<RoleValue>("branch_manager");
  const [businessType, setBusinessType] = useState<string>("");
  const [branchId, setBranchId] = useState("");
  const [branchSearch, setBranchSearch] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitted, setSubmitted] = useState(false);

  // Distinct business types present in branch list (only those with branches)
  const availableBizTypes = useMemo(() => {
    const set = new Set<string>();
    for (const b of branches) set.add(b.business_type);
    return Array.from(set)
      .map((key) => ({
        key,
        cfg: BUSINESS_TYPES[key],
      }))
      .filter((x) => x.cfg)
      .sort((a, b) => (a.cfg!.label > b.cfg!.label ? 1 : -1));
  }, [branches]);

  // Branches narrowed by selected biztype + free-text search (code or name)
  const filteredBranches = useMemo(() => {
    const q = branchSearch.trim().toLowerCase();
    return branches.filter((b) => {
      if (businessType && b.business_type !== businessType) return false;
      if (!q) return true;
      return (
        b.code.toLowerCase().includes(q) ||
        b.name.toLowerCase().includes(q)
      );
    });
  }, [branches, businessType, branchSearch]);

  const showsBranchPicker = ROLES_REQUIRING_BRANCH.includes(role);

  function validate(): { ok: true; data: z.infer<typeof FormSchema> } | { ok: false } {
    const result = FormSchema.safeParse({
      name,
      employeeCode,
      phone,
      email,
      requestedRole: role,
      businessType,
      branchId: branchId || undefined,
      notes,
    });

    if (!result.success) {
      const next: FormErrors = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof FormErrors | undefined;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      // Toast first error so non-sighted/scrolled-out users still see it
      const first = Object.values(next)[0];
      if (first) toast.error(first);
      return { ok: false };
    }

    // Cross-field rule: staff/branch_manager must pick a branch
    if (showsBranchPicker && !branchId) {
      setErrors({
        branchId:
          "เลือกสาขาที่ทำงาน — ตำแหน่งนี้ต้องผูกกับสาขา (ถ้ายังไม่แน่ใจ ติดต่อ Admin)",
      });
      toast.error("กรุณาเลือกสาขาที่ทำงาน");
      return { ok: false };
    }

    setErrors({});
    return { ok: true, data: result.data };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = validate();
    if (!v.ok) return;

    startTransition(async () => {
      const res = await fetch("/api/auth/register-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: v.data.name,
          employeeCode: v.data.employeeCode.toUpperCase(),
          phone: v.data.phone,
          email: v.data.email || undefined,
          requestedRole: v.data.requestedRole,
          branchId: v.data.branchId ?? null,
          notes: v.data.notes || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || "ส่งคำขอไม่สำเร็จ — ลองใหม่อีกครั้ง");
        return;
      }
      setSubmitted(true);
      toast.success("ส่งคำขอเรียบร้อย · รอ Admin ติดต่อกลับ");
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
            รออนุมัติจาก Admin ภายใน 1-2 วันทำการ · จะติดต่อกลับทาง LINE หรือเบอร์โทรที่ให้ไว้ พร้อมส่งลิงก์ตั้งรหัสผ่าน
          </p>
          <p className="text-xs text-zinc-400">
            ถ้าด่วน ติดต่อเจ้าของระบบโดยตรง
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Card className="animate-fade-up delay-100">
        <CardHeader>
          <CardTitle>ข้อมูลของคุณ</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <Field label="ชื่อ-นามสกุล" required error={errors.name}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น สมชาย ใจดี"
              prefixSlot={<UserIcon className="size-4" />}
              invalid={Boolean(errors.name)}
              required
            />
          </Field>
          <Field
            label="รหัสพนักงาน"
            required
            hint="รหัสจาก Humansoft (ตัวอักษรพิมพ์ใหญ่ + ตัวเลข)"
            error={errors.employeeCode}
          >
            <Input
              value={employeeCode}
              onChange={(e) => setEmployeeCode(e.target.value.toUpperCase())}
              placeholder="เช่น EMP-1024"
              prefixSlot={<IdCard className="size-4" />}
              invalid={Boolean(errors.employeeCode)}
              required
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
          </Field>
          <Field
            label="เบอร์โทร"
            required
            hint="ใช้สำหรับติดต่อกลับ + Telegram"
            error={errors.phone}
          >
            <Input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="เช่น 081-234-5678"
              prefixSlot={<Phone className="size-4" />}
              invalid={Boolean(errors.phone)}
              required
            />
          </Field>
          <Field label="อีเมล" optional error={errors.email}>
            <Input
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="เช่น somchai@gmail.com"
              prefixSlot={<Mail className="size-4" />}
              invalid={Boolean(errors.email)}
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
                onChange={() => {
                  setRole(r.value);
                  // Clear branch picker if role no longer needs it
                  if (!ROLES_REQUIRING_BRANCH.includes(r.value)) {
                    setBranchId("");
                    setErrors((p) => ({ ...p, branchId: undefined }));
                  }
                }}
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

      {showsBranchPicker && (
        <Card className="mt-4 animate-fade-up delay-200">
          <CardHeader>
            <CardTitle>สาขาที่จะดูแล</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {/* Step 1 — ประเภทธุรกิจ (memory rule: biztype-first filter) */}
            <Field
              label="ประเภทธุรกิจ"
              required
              hint="เลือกประเภทธุรกิจก่อน แล้วค่อยเลือกสาขา"
            >
              <div className="relative">
                <select
                  value={businessType}
                  onChange={(e) => {
                    setBusinessType(e.target.value);
                    // Reset branch when biztype changes
                    setBranchId("");
                    setBranchSearch("");
                  }}
                  className={cn(
                    "appearance-none w-full h-12 rounded-xl border-2 bg-white pl-11 pr-10 text-base text-zinc-900",
                    "outline-none transition-colors",
                    "border-zinc-200 focus:border-[var(--color-brand-500)]",
                  )}
                >
                  <option value="">— เลือกประเภทธุรกิจ —</option>
                  {availableBizTypes.map(({ key, cfg }) => (
                    <option key={key} value={key}>
                      {cfg!.emoji} {cfg!.label}
                    </option>
                  ))}
                </select>
                <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-zinc-400 pointer-events-none" />
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400 pointer-events-none" />
              </div>
            </Field>

            {/* Step 2 — สาขา (filtered by biztype + searchable) */}
            <Field
              label="สาขา"
              required
              error={errors.branchId}
              hint={
                businessType
                  ? "เลือกสาขาหลักที่จะทำงาน · Admin อาจปรับให้ภายหลัง"
                  : "เลือกประเภทธุรกิจด้านบนก่อน"
              }
            >
              <Input
                value={branchSearch}
                onChange={(e) => setBranchSearch(e.target.value)}
                placeholder="ค้นหาด้วยรหัสสาขาหรือชื่อ (เช่น KKN-001)"
                prefixSlot={<Search className="size-4" />}
                disabled={!businessType}
              />
              <div className="mt-2 grid grid-cols-1 gap-2 max-h-72 overflow-auto">
                {!businessType && (
                  <p className="text-sm text-zinc-400 py-6 text-center">
                    เลือกประเภทธุรกิจก่อน
                  </p>
                )}
                {businessType && filteredBranches.length === 0 && (
                  <p className="text-sm text-zinc-400 py-6 text-center">
                    ไม่พบสาขาที่ตรงกับการค้นหา
                  </p>
                )}
                {businessType &&
                  filteredBranches.map((b) => {
                    const cfg = BUSINESS_TYPES[b.business_type];
                    return (
                      <label
                        key={b.id}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors",
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
                          onChange={() => {
                            setBranchId(b.id);
                            setErrors((p) => ({ ...p, branchId: undefined }));
                          }}
                        />
                        <span className="text-lg">{cfg?.emoji ?? "📋"}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold truncate">
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
            </Field>
          </CardBody>
        </Card>
      )}

      <Card className="mt-4 animate-fade-up delay-300">
        <CardHeader>
          <CardTitle>หมายเหตุ (ถ้ามี)</CardTitle>
        </CardHeader>
        <CardBody>
          <Field
            label="หมายเหตุถึง Admin"
            optional
            hint="เช่น ผู้แนะนำ · วันเริ่มงาน · ข้อมูลอื่น ๆ"
            error={errors.notes}
          >
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="เช่น สมัครจาก ผจก. ใจดี · เริ่มงาน 5 พ.ค."
              rows={3}
              maxLength={500}
              className={cn(
                "w-full rounded-xl border-2 bg-white p-3.5 text-base focus:outline-none transition-colors resize-none",
                errors.notes
                  ? "border-[var(--color-danger)]"
                  : "border-zinc-200 focus:border-[var(--color-brand-500)]",
              )}
            />
          </Field>
          <p className="text-[11px] text-zinc-400 flex items-center gap-1 mt-2">
            <MessageSquare className="size-3" />
            {notes.length}/500 · Admin จะติดต่อกลับภายใน 1-2 วันทำการ
          </p>
        </CardBody>
      </Card>

      <Button
        type="submit"
        size="lg"
        fullWidth
        className="mt-6 animate-fade-up delay-300"
        loading={pending}
      >
        {pending ? "กำลังส่ง..." : "ส่งคำขอเข้าใช้งาน"}
      </Button>
    </form>
  );
}
