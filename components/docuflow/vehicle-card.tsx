// Vehicle row card — shown in the fleet list page
// Server component: receives pre-rendered VM (no functions across boundary)
// Pattern: Card + license-plate (large) + 4 doc-status badges

import Link from "next/link";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, MapPin } from "lucide-react";
import type { ExpiryStatus } from "@/lib/vehicles/data";

export interface VehicleDocStatusVm {
  /** registration | insurance_compulsory | inspection | tank_cert */
  docType: string;
  shortLabel: string; // "ทะเบียน" | "พ.ร.บ." | "ตรวจสภาพ" | "ถัง"
  status: ExpiryStatus | "missing";
  expiryDate: string | null;
  daysToExpiry: number | null;
}

export interface VehicleCardVm {
  id: string;
  licensePlate: string;
  vehicleTypeEmoji: string;
  vehicleTypeLabel: string;
  branchLabel: string | null;
  companyLabel: string | null;
  worstStatus: ExpiryStatus | "missing";
  worstStatusLabel: string;
  docs: VehicleDocStatusVm[];
}

const TONE: Record<
  ExpiryStatus | "missing",
  { tone: "neutral" | "success" | "warning" | "danger" | "info"; label: string }
> = {
  expired: { tone: "danger", label: "หมดอายุ" },
  critical: { tone: "danger", label: "≤7 วัน" },
  urgent: { tone: "warning", label: "≤30 วัน" },
  watch: { tone: "info", label: "≤90 วัน" },
  ok: { tone: "success", label: "ปลอดภัย" },
  no_expiry: { tone: "neutral", label: "ไม่ระบุ" },
  missing: { tone: "neutral", label: "ไม่มีเอกสาร" },
};

function statusToBadgeTone(s: ExpiryStatus | "missing") {
  return TONE[s];
}

export function VehicleCard({ vm }: { vm: VehicleCardVm }) {
  const worst = statusToBadgeTone(vm.worstStatus);
  return (
    <Link
      href={`/docuflow/vehicles/${vm.id}`}
      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] rounded-2xl"
    >
      <Card className="hover-lift transition-all">
        <CardBody className="space-y-3">
          {/* Top row: plate + type + worst status */}
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div className="size-12 shrink-0 rounded-xl bg-[var(--color-brand-50)] border-2 border-[var(--color-brand-100)] flex items-center justify-center text-2xl">
                {vm.vehicleTypeEmoji}
              </div>
              <div className="min-w-0">
                <div className="text-lg sm:text-xl font-extrabold tracking-tight font-display text-zinc-900 tabular-nums">
                  {vm.licensePlate}
                </div>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {vm.vehicleTypeLabel}
                </p>
              </div>
            </div>
            <Badge tone={worst.tone}>{worst.label}</Badge>
          </div>

          {/* Branch / Company line */}
          {(vm.branchLabel || vm.companyLabel) && (
            <div className="flex items-center gap-3 text-xs text-zinc-500 flex-wrap">
              {vm.branchLabel && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3" />
                  {vm.branchLabel}
                </span>
              )}
              {vm.companyLabel && (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="size-3" />
                  {vm.companyLabel}
                </span>
              )}
            </div>
          )}

          {/* Doc statuses — 4 badges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
            {vm.docs.map((d) => {
              const t = statusToBadgeTone(d.status);
              return (
                <div
                  key={d.docType}
                  className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5"
                >
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500 font-bold">
                    {d.shortLabel}
                  </p>
                  <Badge tone={t.tone} className="mt-1">
                    {t.label}
                  </Badge>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>
    </Link>
  );
}
