"use client";

// Client-only form for new vehicle registration.
// Uses fetch to /api/docuflow/vehicles (Agent A — POST handler)
// Field pattern: filter (ประเภทธุรกิจ → branch) per feedback_filter_pattern_biztype_first
//   — ถ้า branch list น้อย แสดง dropdown ตรงๆ; ถ้าเยอะ filter biztype แล้ว dropdown
// HARD RULE: BackButton + button contrast + Tailwind v4 var syntax

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BUSINESS_TYPES } from "@/constants/business-types";

interface CompanyOpt {
  id: string;
  code: string;
  name: string;
}
interface BranchOpt {
  id: string;
  code: string;
  name: string;
  businessType: string;
}
interface VehicleTypeOpt {
  key: string;
  label: string;
}

export function NewVehicleForm({
  companies,
  branches,
  vehicleTypes,
}: {
  companies: CompanyOpt[];
  branches: BranchOpt[];
  vehicleTypes: VehicleTypeOpt[];
}) {
  const router = useRouter();
  const [licensePlate, setLicensePlate] = useState("");
  const [vehicleType, setVehicleType] = useState(
    vehicleTypes[0]?.key ?? "fuel_truck",
  );
  const [companyId, setCompanyId] = useState<string>("");
  const [businessType, setBusinessType] = useState<string>("");
  const [branchId, setBranchId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter branches by selected biztype (เพื่อ scan เร็วเมื่อ branch เยอะ)
  const branchOptions = useMemo(() => {
    if (!businessType) return branches;
    return branches.filter((b) => b.businessType === businessType);
  }, [branches, businessType]);

  // Available business types from this org's branches
  const bizTypeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const b of branches) set.add(b.businessType);
    return Array.from(set).map((t) => ({
      key: t,
      label: BUSINESS_TYPES[t]?.label ?? t,
      emoji: BUSINESS_TYPES[t]?.emoji ?? "🏢",
    }));
  }, [branches]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!licensePlate.trim()) {
      setError("กรอกป้ายทะเบียน");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/docuflow/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          licensePlate: licensePlate.trim(),
          vehicleType,
          companyId: companyId || null,
          branchId: branchId || null,
          notes: notes.trim() || null,
          isActive: true,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "บันทึกไม่สำเร็จ");
        setSubmitting(false);
        return;
      }
      const out = (await res.json()) as { id?: string };
      if (out.id) {
        router.push(`/docuflow/vehicles/${out.id}`);
        return;
      }
      router.push("/docuflow/vehicles");
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-5">
          <Field label="ป้ายทะเบียน" required htmlFor="plate">
            <Input
              id="plate"
              placeholder="เช่น 70-1234"
              value={licensePlate}
              onChange={(e) => setLicensePlate(e.target.value)}
              autoComplete="off"
            />
          </Field>

          <Field label="ประเภทรถ" required>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {vehicleTypes.map((vt) => (
                <button
                  key={vt.key}
                  type="button"
                  onClick={() => setVehicleType(vt.key)}
                  className={
                    vehicleType === vt.key
                      ? "rounded-xl border-2 border-[var(--color-brand-500)] bg-[var(--color-brand-50)] px-3 py-2 text-sm font-semibold text-[var(--color-brand-800)] text-left"
                      : "rounded-xl border-2 border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:border-zinc-300 text-left"
                  }
                >
                  {vt.label}
                </button>
              ))}
            </div>
          </Field>

          <Field
            label="บริษัท (นิติบุคคล)"
            optional
            hint="ปล่อยว่างได้ถ้าใช้ร่วมหลายบริษัท"
          >
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="h-12 w-full rounded-xl border border-zinc-200 bg-white px-4 text-base text-zinc-900 outline-none focus:border-[var(--color-brand-500)] transition-colors"
            >
              <option value="">— ไม่ระบุ —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
          </Field>

          {/* Layered filter: ประเภทธุรกิจ → สาขา */}
          <Field label="ประเภทธุรกิจ" optional>
            <select
              value={businessType}
              onChange={(e) => {
                setBusinessType(e.target.value);
                setBranchId(""); // reset branch on biztype change
              }}
              className="h-12 w-full rounded-xl border border-zinc-200 bg-white px-4 text-base text-zinc-900 outline-none focus:border-[var(--color-brand-500)] transition-colors"
            >
              <option value="">— ทุกประเภท —</option>
              {bizTypeOptions.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.emoji} {b.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="สาขาประจำ (Home base)"
            optional
            hint={
              businessType
                ? `${branchOptions.length} สาขาในประเภทนี้`
                : "เลือกประเภทธุรกิจก่อนเพื่อแคบรายการ"
            }
          >
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="h-12 w-full rounded-xl border border-zinc-200 bg-white px-4 text-base text-zinc-900 outline-none focus:border-[var(--color-brand-500)] transition-colors"
            >
              <option value="">— ไม่ระบุสาขา —</option>
              {branchOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} · {b.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="หมายเหตุ" optional>
            <Input
              placeholder="เช่น ย้ายมาจากสาขา A"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>

          {error && (
            <p className="text-sm text-[var(--color-danger)] font-medium">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2 pt-2">
            <Button type="submit" variant="primary" loading={submitting}>
              บันทึก
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={submitting}
            >
              ยกเลิก
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
