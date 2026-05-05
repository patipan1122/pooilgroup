"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

interface Props {
  companies: Array<{ id: string; code: string; name: string }>;
}

const SAMPLE_CSV = `KKN-001, ปั๊ม KKN ขอนแก่น, fuel_station, ขอนแก่น, อีสาน, 21:00, 10000000
KKN-007, 7-Eleven KKN, convenience_store, ขอนแก่น, อีสาน, 21:00, 800000
HOTEL-01, Pool Hotel KKN, hotel, ขอนแก่น, อีสาน, 23:00, 1500000`;

const SAMPLE_INVITE = `สมชาย ใจดี, 0812345678, somchai@pool.com, KKN-001, branch_manager
สุดา รักดี, 0898765432, suda@pool.com, KKN-007, branch_manager`;

export function SetupWizardForm({ companies }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [branchCsv, setBranchCsv] = useState(SAMPLE_CSV);
  const [inviteCsv, setInviteCsv] = useState(SAMPLE_INVITE);

  function parseBranches() {
    return branchCsv
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"))
      .map((line) => {
        const [code, name, businessType, province, region, deadline, target] =
          line.split(",").map((s) => s.trim());
        return {
          code: code ?? "",
          name: name ?? "",
          businessType: businessType ?? "",
          province: province || undefined,
          region: region || undefined,
          deadline: deadline || undefined,
          target: target ? parseFloat(target) : undefined,
        };
      });
  }

  function parseInvites() {
    return inviteCsv
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"))
      .map((line) => {
        const [name, phone, email, branchCode, role] = line
          .split(",")
          .map((s) => s.trim());
        return {
          name: name ?? "",
          phone: phone ?? "",
          email: email || undefined,
          branchCode: branchCode ?? "",
          role: (role || "branch_manager") as
            | "branch_manager"
            | "staff"
            | "admin",
        };
      })
      .filter((i) => i.name && i.phone && i.branchCode);
  }

  function submit() {
    const branches = parseBranches().filter(
      (b) => b.code && b.name && b.businessType,
    );
    if (branches.length === 0) {
      toast.error("ไม่มีสาขาให้สร้าง — ตรวจ CSV อีกครั้ง");
      return;
    }
    const managerInvites = parseInvites();

    startTransition(async () => {
      const res = await fetch("/api/setup-wizard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: companyId || undefined,
          branches,
          managerInvites,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "สร้างไม่สำเร็จ");
        return;
      }
      toast.success(
        `สร้างสาขา ${json.createdBranches} (ข้าม ${json.skippedBranches}) + invite ${json.createdInvites} คน`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {companies.length > 0 && (
        <Field label="บริษัท" htmlFor="company">
          <select
            id="company"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="w-full h-11 rounded-xl border border-zinc-200 px-3 bg-white"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field
        label="รายการสาขา (CSV)"
        hint="แต่ละบรรทัด: code, name, businessType, province, region, deadline, target"
      >
        <textarea
          rows={6}
          value={branchCsv}
          onChange={(e) => setBranchCsv(e.target.value)}
          className="w-full rounded-xl border border-zinc-200 px-4 py-3 font-mono text-xs leading-relaxed bg-white outline-none focus:border-[--color-brand-500]"
        />
      </Field>

      <Field
        label="ผจก./Staff invite (CSV) — ออปชัน"
        hint="แต่ละบรรทัด: name, phone, email, branchCode, role"
      >
        <textarea
          rows={4}
          value={inviteCsv}
          onChange={(e) => setInviteCsv(e.target.value)}
          className="w-full rounded-xl border border-zinc-200 px-4 py-3 font-mono text-xs leading-relaxed bg-white outline-none focus:border-[--color-brand-500]"
        />
      </Field>

      <div className="flex justify-end">
        <Button
          size="lg"
          onClick={submit}
          loading={pending}
          disabled={pending}
        >
          ✨ สร้างทั้งหมด
        </Button>
      </div>
    </div>
  );
}
