"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, MapPin, Phone, Clock, Hash, Globe } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { cn } from "@/lib/utils/cn";

const TYPE_OPTIONS = Object.entries(BUSINESS_TYPES).map(([value, cfg]) => ({
  value,
  label: cfg.label,
  emoji: cfg.emoji,
}));

interface ManagerOption {
  id: string;
  name: string;
  role: string;
}

interface InitialBranch {
  id: string;
  code: string;
  name: string;
  business_type: string;
  company_id?: string | null;
  province: string | null;
  region: string | null;
  address: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  manager_id: string | null;
  line_group_id: string | null;
  report_deadline: string;
}

interface CompanyOption {
  id: string;
  code: string;
  name: string;
}

interface CreateProps {
  mode: "create";
  managers: ManagerOption[];
  companies: CompanyOption[];
}

interface EditProps {
  mode: "edit";
  branch: InitialBranch;
  managers: ManagerOption[];
  companies?: CompanyOption[];
}

type Props = CreateProps | EditProps;

export function BranchForm(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const initial = props.mode === "edit" ? props.branch : null;
  const isEdit = props.mode === "edit";
  const companies = props.companies ?? [];

  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [companyId, setCompanyId] = useState<string>(
    initial?.company_id ?? (companies[0]?.id ?? ""),
  );
  const [businessType, setBusinessType] = useState(
    initial?.business_type ?? "fuel_station",
  );
  const [province, setProvince] = useState(initial?.province ?? "");
  const [region, setRegion] = useState(initial?.region ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [latStr, setLatStr] = useState(
    initial?.lat != null ? String(initial.lat) : "",
  );
  const [lngStr, setLngStr] = useState(
    initial?.lng != null ? String(initial.lng) : "",
  );
  const [managerId, setManagerId] = useState(initial?.manager_id ?? "");
  const [lineGroupId, setLineGroupId] = useState(initial?.line_group_id ?? "");
  const [deadline, setDeadline] = useState(initial?.report_deadline ?? "21:00");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim()) {
      toast.error("กรุณากรอกรหัสและชื่อสาขา");
      return;
    }
    if (!/^[A-Z0-9-]+$/i.test(code.trim())) {
      toast.error("รหัสสาขาใช้ได้เฉพาะ A-Z, 0-9, -");
      return;
    }
    if (!isEdit && !companyId) {
      toast.error("เลือกนิติบุคคล (Company) ก่อน — ถ้ายังไม่มี ให้สร้างที่ /companies");
      return;
    }

    const payload: Record<string, unknown> = {
      name: name.trim(),
      province: province.trim() || null,
      region: region.trim() || null,
      address: address.trim() || null,
      phone: phone.trim() || null,
      lat: latStr ? Number(latStr) : null,
      lng: lngStr ? Number(lngStr) : null,
      managerId: managerId || null,
      lineGroupId: lineGroupId.trim() || null,
      reportDeadline: deadline,
    };
    if (!isEdit) {
      payload.code = code.trim().toUpperCase();
      payload.businessType = businessType;
      payload.companyId = companyId;
    }

    startTransition(async () => {
      const url = isEdit ? `/api/admin/branches/${initial!.id}` : "/api/admin/branches";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "บันทึกไม่สำเร็จ");
        return;
      }
      toast.success(isEdit ? "บันทึกการแก้ไขแล้ว" : "เพิ่มสาขาเรียบร้อย");
      const newId = isEdit ? initial!.id : json.id;
      router.push(`/branches/${newId}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* Section 1 — Identity */}
      <Card className="animate-fade-up delay-100">
        <CardHeader>
          <CardTitle>ข้อมูลหลัก</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {!isEdit && companies.length > 0 && (
            <Field
              label="นิติบุคคล (Company)"
              required
              hint="สาขานี้อยู่ในนิติบุคคลไหน — เปลี่ยนภายหลังไม่ได้"
            >
              <select
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                required
                className="w-full h-11 rounded-xl border-2 border-zinc-200 bg-white px-3 text-sm font-medium focus:outline-none focus:border-[var(--color-brand-500)]"
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="รหัสสาขา"
              required
              hint={isEdit ? "แก้รหัสไม่ได้" : "เช่น KKN-001"}
            >
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="KKN-001"
                prefixSlot={<Hash className="size-4" />}
                disabled={isEdit}
                required
              />
            </Field>
            <Field label="ชื่อสาขา" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="เช่น ปั๊มขอนแก่น สาขา 1"
                prefixSlot={<Building2 className="size-4" />}
                required
              />
            </Field>
          </div>

          <Field
            label="ประเภทธุรกิจ"
            required
            hint={isEdit ? "ประเภทเปลี่ยนภายหลังไม่ได้" : undefined}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {TYPE_OPTIONS.map((t) => (
                <label
                  key={t.value}
                  className={cn(
                    "flex items-center gap-2.5 p-2.5 rounded-xl border-2 transition-colors",
                    businessType === t.value
                      ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
                      : "border-zinc-200 hover:bg-zinc-50",
                    isEdit && "cursor-not-allowed opacity-60",
                    !isEdit && "cursor-pointer",
                  )}
                >
                  <input
                    type="radio"
                    name="businessType"
                    value={t.value}
                    checked={businessType === t.value}
                    onChange={() => !isEdit && setBusinessType(t.value)}
                    disabled={isEdit}
                  />
                  <span className="text-xl">{t.emoji}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{t.label}</div>
                  </div>
                </label>
              ))}
            </div>
          </Field>
        </CardBody>
      </Card>

      {/* Section 2 — Location */}
      <Card className="mt-4 animate-fade-up delay-150">
        <CardHeader>
          <CardTitle>ที่ตั้ง</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="จังหวัด" optional>
              <Input
                value={province}
                onChange={(e) => setProvince(e.target.value)}
                placeholder="เช่น ขอนแก่น"
                prefixSlot={<MapPin className="size-4" />}
              />
            </Field>
            <Field label="ภาค" optional>
              <Input
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="เช่น อีสาน"
                prefixSlot={<Globe className="size-4" />}
              />
            </Field>
          </div>
          <Field label="ที่อยู่เต็ม" optional>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="เช่น 123 ถ.มิตรภาพ ต.ในเมือง อ.เมือง จ.ขอนแก่น"
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="พิกัด GPS · Latitude" optional hint="เช่น 16.4321">
              <Input
                value={latStr}
                onChange={(e) => setLatStr(e.target.value)}
                placeholder="16.4321"
                inputMode="decimal"
              />
            </Field>
            <Field label="พิกัด GPS · Longitude" optional hint="เช่น 102.8236">
              <Input
                value={lngStr}
                onChange={(e) => setLngStr(e.target.value)}
                placeholder="102.8236"
                inputMode="decimal"
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      {/* Section 3 — Operations */}
      <Card className="mt-4 animate-fade-up delay-200">
        <CardHeader>
          <CardTitle>การจัดการ</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="เบอร์โทรสาขา" optional>
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="เช่น 081-234-5678"
                prefixSlot={<Phone className="size-4" />}
              />
            </Field>
            <Field label="Deadline ส่งรายงาน" required hint="HH:mm รูปแบบ 24 ชม.">
              <Input
                type="time"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                prefixSlot={<Clock className="size-4" />}
                required
              />
            </Field>
          </div>

          <Field label="ผู้จัดการสาขา" optional>
            <select
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
              className="w-full h-12 rounded-xl border-2 border-zinc-200 bg-white px-3.5 text-base focus:border-[var(--color-brand-500)] focus:outline-none transition-colors"
            >
              <option value="">— ยังไม่กำหนด —</option>
              {props.managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.role})
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="LINE Group ID"
            optional
            hint="วาง group_id หลัง bot ถูก add เข้า group"
          >
            <Input
              value={lineGroupId}
              onChange={(e) => setLineGroupId(e.target.value)}
              placeholder="เช่น Cxxxxxxxxxxxxxx"
              prefixSlot={<Hash className="size-4" />}
            />
          </Field>
        </CardBody>
      </Card>

      <div className="mt-6 flex gap-2 sm:justify-end animate-fade-up delay-300">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.back()}
          disabled={pending}
        >
          ยกเลิก
        </Button>
        <Button
          type="submit"
          size="lg"
          loading={pending}
          disabled={!code.trim() || !name.trim()}
        >
          {isEdit ? "บันทึกการแก้ไข" : "เพิ่มสาขา"}
        </Button>
        {!isEdit && <Badge tone="neutral">เริ่มใช้งานได้ทันที</Badge>}
      </div>
    </form>
  );
}
