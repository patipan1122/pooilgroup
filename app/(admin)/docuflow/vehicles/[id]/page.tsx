// DocuFlow · Vehicle detail — 4-section doc grid
// Server component · params is Promise<{id}> (Next 16)

import { notFound } from "next/navigation";
import Link from "next/link";
import { FileText, RefreshCw } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole, isAdminTier } from "@/lib/auth/role-guards";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/ui/back-button";
import { Section } from "@/components/ui/section";
import {
  loadVehicles,
  loadVehicleDocuments,
  getVehicleTypeConfig,
  STANDARD_VEHICLE_DOC_TYPES,
  VEHICLE_DOC_TYPES,
  type ExpiryStatus,
  type CanonicalVehicleDocument,
} from "@/lib/vehicles/data";
import { loadBranches, indexBranches } from "@/lib/cashhub/data";
import { prisma } from "@/lib/prisma";
import { thaiDateLong } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<
  ExpiryStatus | "missing",
  { tone: "neutral" | "success" | "warning" | "danger" | "info"; label: string }
> = {
  expired: { tone: "danger", label: "หมดอายุแล้ว" },
  critical: { tone: "danger", label: "ภายใน 7 วัน" },
  urgent: { tone: "warning", label: "ภายใน 30 วัน" },
  watch: { tone: "info", label: "ภายใน 90 วัน" },
  ok: { tone: "success", label: "ปลอดภัย" },
  no_expiry: { tone: "neutral", label: "ไม่ระบุวันหมด" },
  missing: { tone: "neutral", label: "ยังไม่มีเอกสาร" },
};

interface DocSlotVm {
  type: string;
  label: string;
  status: ExpiryStatus | "missing";
  expiryDate: string | null;
  daysToExpiry: number | null;
  document: CanonicalVehicleDocument["document"] | null;
}

export default async function VehicleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const { id } = await params;
  const orgId = session.user.org_id;

  const vehicles = await loadVehicles(orgId, {
    activeOnly: false,
    ids: [id],
  });
  const vehicle = vehicles[0];
  if (!vehicle) notFound();

  const [docs, branches, companies] = await Promise.all([
    loadVehicleDocuments(orgId, { vehicleIds: [id] }),
    loadBranches(orgId, { activeOnly: false }),
    prisma.company.findMany({
      where: { orgId, isActive: true },
      select: { id: true, code: true, name: true },
    }),
  ]);
  const branchById = indexBranches(branches);

  const branch = vehicle.branch_id ? branchById.get(vehicle.branch_id) : null;
  const company = vehicle.company_id
    ? companies.find((c) => c.id === vehicle.company_id)
    : null;
  const typeCfg = getVehicleTypeConfig(vehicle.vehicle_type);
  const canRenew = isAdminTier(session.user.role);

  // Build 4-slot grid (any extra docs render in "อื่นๆ")
  const docByType = new Map<string, CanonicalVehicleDocument>();
  for (const d of docs) docByType.set(d.doc_type, d);

  const slots: DocSlotVm[] = STANDARD_VEHICLE_DOC_TYPES.map((type) => {
    const cfg = VEHICLE_DOC_TYPES[type];
    const d = docByType.get(type);
    if (!d) {
      return {
        type,
        label: cfg.label,
        status: "missing" as const,
        expiryDate: null,
        daysToExpiry: null,
        document: null,
      };
    }
    return {
      type,
      label: cfg.label,
      status: d.expiry_status,
      expiryDate: d.expiry_date,
      daysToExpiry: d.days_to_expiry,
      document: d.document,
    };
  });

  const otherDocs = docs.filter(
    (d) =>
      !STANDARD_VEHICLE_DOC_TYPES.includes(
        d.doc_type as (typeof STANDARD_VEHICLE_DOC_TYPES)[number],
      ),
  );

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-5xl mx-auto pb-24">
      <div className="mb-4">
        <BackButton fallbackHref="/docuflow/vehicles" />
      </div>

      <header className="mb-6 animate-fade-up">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold">
          📄 DocuFlow · ทะเบียนรถ · {thaiDateLong(new Date())}
        </p>
        <div className="mt-3 flex items-center gap-4 flex-wrap">
          <div className="size-14 rounded-2xl bg-[var(--color-brand-50)] border-2 border-[var(--color-brand-100)] flex items-center justify-center text-3xl shrink-0">
            {typeCfg.emoji}
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.04em] font-display tabular-nums">
              {vehicle.license_plate}
            </h1>
            <p className="text-zinc-600 mt-1 text-sm flex flex-wrap gap-x-3 gap-y-1">
              <span>{typeCfg.label}</span>
              {company && <span>· {company.name}</span>}
              {branch && (
                <span>
                  · {branch.code} · {branch.name}
                </span>
              )}
            </p>
          </div>
        </div>
        {vehicle.notes && (
          <p className="mt-3 text-sm text-zinc-600 max-w-3xl">
            {vehicle.notes}
          </p>
        )}
      </header>

      <Section number="01" label="DOCUMENTS" title="เอกสารหลัก 4 ประเภท">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {slots.map((slot) => (
            <DocSlotCard
              key={slot.type}
              slot={slot}
              vehicleId={vehicle.id}
              canRenew={canRenew}
            />
          ))}
        </div>
      </Section>

      {otherDocs.length > 0 && (
        <Section
          number="02"
          label="OTHER"
          title="เอกสารเพิ่มเติม"
          className="mt-8"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {otherDocs.map((d) => (
              <DocSlotCard
                key={d.id}
                slot={{
                  type: d.doc_type,
                  label:
                    VEHICLE_DOC_TYPES[d.doc_type]?.label ?? d.doc_type,
                  status: d.expiry_status,
                  expiryDate: d.expiry_date,
                  daysToExpiry: d.days_to_expiry,
                  document: d.document,
                }}
                vehicleId={vehicle.id}
                canRenew={canRenew}
              />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

/* ============================================================
   DocSlotCard — single doc-type cell
   ============================================================ */

function DocSlotCard({
  slot,
  vehicleId,
  canRenew,
}: {
  slot: DocSlotVm;
  vehicleId: string;
  canRenew: boolean;
}) {
  const badge = STATUS_BADGE[slot.status];
  const daysLabel =
    slot.daysToExpiry !== null
      ? slot.daysToExpiry < 0
        ? `เลยมา ${Math.abs(slot.daysToExpiry)} วัน`
        : slot.daysToExpiry === 0
          ? "หมดอายุวันนี้"
          : `เหลืออีก ${slot.daysToExpiry} วัน`
      : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-2 min-w-0">
          <div className="size-8 shrink-0 rounded-lg bg-[var(--color-brand-50)] flex items-center justify-center text-[var(--color-brand-700)]">
            <FileText className="size-4" />
          </div>
          <CardTitle>{slot.label}</CardTitle>
        </div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </CardHeader>
      <CardBody className="space-y-3">
        {slot.expiryDate ? (
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider font-bold">
              วันหมดอายุ
            </p>
            <p className="text-base font-bold text-zinc-900 tabular-nums mt-0.5">
              {slot.expiryDate}
            </p>
            {daysLabel && (
              <p
                className={
                  slot.status === "expired" ||
                  slot.status === "critical"
                    ? "text-xs font-semibold text-rose-700 mt-0.5"
                    : slot.status === "urgent"
                      ? "text-xs font-semibold text-amber-700 mt-0.5"
                      : "text-xs text-zinc-500 mt-0.5"
                }
              >
                {daysLabel}
              </p>
            )}
          </div>
        ) : slot.document ? (
          <p className="text-sm text-zinc-500">ไม่ได้ระบุวันหมดอายุ</p>
        ) : (
          <p className="text-sm text-zinc-500">ยังไม่มีเอกสาร — กดปุ่มเพื่ออัปโหลด</p>
        )}

        {/* file link */}
        {slot.document && (
          <a
            href={
              slot.document.file_public_url ??
              `/api/docuflow/documents/${slot.document.id}/download`
            }
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-brand-700)] hover:underline"
          >
            ดูไฟล์ · {slot.document.name}
          </a>
        )}

        {canRenew && (
          <div className="pt-1">
            <Link
              href={`/docuflow/vehicles/${vehicleId}/renew?type=${encodeURIComponent(slot.type)}`}
              className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 bg-white text-zinc-900 border border-zinc-200 hover:bg-zinc-50 active:bg-zinc-100 h-9 px-3 text-sm rounded-lg"
            >
              <RefreshCw className="size-3.5" />
              {slot.document ? "ต่ออายุ" : "อัปโหลด"}
            </Link>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
