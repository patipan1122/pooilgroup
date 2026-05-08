// DocuFlow · ทะเบียนรถ + เอกสารยานพาหนะ — fleet list
// Server component · canonical loaders · pre-rendered VM rows
// Single Source: lib/vehicles/data.ts (loadVehicles, loadVehicleDocuments)

import Link from "next/link";
import { Truck, Plus } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { thaiDateLong } from "@/lib/utils/format";
import { loadBranches, indexBranches } from "@/lib/cashhub/data";
import {
  loadVehicles,
  loadVehicleDocuments,
  getVehicleTypeConfig,
  STANDARD_VEHICLE_DOC_TYPES,
  VEHICLE_DOC_TYPES,
  VEHICLE_TYPES,
  type CanonicalVehicleDocument,
  type ExpiryStatus,
} from "@/lib/vehicles/data";
import { isAdminTier } from "@/lib/auth/role-guards";
import { VehicleCard, type VehicleCardVm } from "@/components/docuflow/vehicle-card";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const STATUS_RANK: Record<ExpiryStatus | "missing", number> = {
  expired: 0,
  critical: 1,
  urgent: 2,
  watch: 3,
  no_expiry: 4,
  ok: 5,
  missing: 6,
};

function worstStatusOf(
  docs: VehicleCardVm["docs"],
): ExpiryStatus | "missing" {
  let worst: ExpiryStatus | "missing" = "ok";
  for (const d of docs) {
    if (STATUS_RANK[d.status] < STATUS_RANK[worst]) worst = d.status;
  }
  return worst;
}

const STATUS_PRIORITY_LABEL: Record<ExpiryStatus | "missing", string> = {
  expired: "หมดอายุแล้ว",
  critical: "≤7 วัน",
  urgent: "≤30 วัน",
  watch: "≤90 วัน",
  ok: "ปลอดภัย",
  no_expiry: "ไม่ระบุ",
  missing: "ไม่มีเอกสาร",
};

export default async function DocuFlowVehiclesPage({
  searchParams,
}: {
  searchParams: Promise<{
    company?: string;
    branch?: string;
    type?: string;
  }>;
}) {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const sp = await searchParams;
  const orgId = session.user.org_id;

  const [vehicles, allBranches, companies] = await Promise.all([
    loadVehicles(orgId, {
      activeOnly: true,
      companyId: sp.company || undefined,
      branchId: sp.branch || undefined,
      vehicleType: sp.type || undefined,
    }),
    loadBranches(orgId, { activeOnly: false }),
    prisma.company.findMany({
      where: { orgId, isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
  ]);
  const branchById = indexBranches(allBranches);

  // Load all VehicleDocuments for these vehicles
  const vehicleIds = vehicles.map((v) => v.id);
  const docs =
    vehicleIds.length > 0
      ? await loadVehicleDocuments(orgId, { vehicleIds })
      : [];

  // Group docs by vehicleId → docType
  const docByVehicle = new Map<
    string,
    Map<string, CanonicalVehicleDocument>
  >();
  for (const d of docs) {
    if (!docByVehicle.has(d.vehicle_id)) {
      docByVehicle.set(d.vehicle_id, new Map());
    }
    docByVehicle.get(d.vehicle_id)!.set(d.doc_type, d);
  }

  // Build VMs
  const rows: VehicleCardVm[] = vehicles.map((v) => {
    const vMap = docByVehicle.get(v.id);
    const docVms: VehicleCardVm["docs"] = STANDARD_VEHICLE_DOC_TYPES.map(
      (type) => {
        const cfg = VEHICLE_DOC_TYPES[type];
        const d = vMap?.get(type);
        if (!d) {
          return {
            docType: type,
            shortLabel: cfg.short,
            status: "missing" as const,
            expiryDate: null,
            daysToExpiry: null,
          };
        }
        return {
          docType: type,
          shortLabel: cfg.short,
          status: d.expiry_status,
          expiryDate: d.expiry_date,
          daysToExpiry: d.days_to_expiry,
        };
      },
    );
    const branch = v.branch_id ? branchById.get(v.branch_id) : null;
    const company = v.company_id
      ? companies.find((c) => c.id === v.company_id)
      : null;
    const typeCfg = getVehicleTypeConfig(v.vehicle_type);
    const worst = worstStatusOf(docVms);
    return {
      id: v.id,
      licensePlate: v.license_plate,
      vehicleTypeEmoji: typeCfg.emoji,
      vehicleTypeLabel: typeCfg.label,
      branchLabel: branch ? `${branch.code} · ${branch.name}` : null,
      companyLabel: company ? company.name : null,
      worstStatus: worst,
      worstStatusLabel: STATUS_PRIORITY_LABEL[worst],
      docs: docVms,
    };
  });

  // Sort: worst-status-first (expired/critical at top)
  rows.sort(
    (a, b) => STATUS_RANK[a.worstStatus] - STATUS_RANK[b.worstStatus],
  );

  // Top-of-list summary counts
  const expiringSoonCount = rows.filter(
    (r) =>
      r.worstStatus === "expired" ||
      r.worstStatus === "critical" ||
      r.worstStatus === "urgent",
  ).length;
  const missingCount = rows.filter(
    (r) => r.worstStatus === "missing",
  ).length;

  // Filter chip data
  const branchOptions = allBranches
    .filter((b) => b.is_active)
    .map((b) => ({ id: b.id, code: b.code, name: b.name }));
  const canRegister = isAdminTier(session.user.role);

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-7xl mx-auto pb-24">
      <header className="mb-6 animate-fade-up">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold">
          📄 DocuFlow · ทะเบียนรถ · {thaiDateLong(new Date())}
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.04em] font-display mt-4 leading-[0.95]">
          ทะเบียน <span className="text-gradient-blue">รถ</span>
        </h1>
        <p className="text-zinc-600 mt-1.5 text-sm">
          {rows.length} คัน
          {expiringSoonCount > 0 && (
            <>
              {" · "}
              <span className="font-bold text-rose-700">
                ใกล้หมดอายุ {expiringSoonCount}
              </span>
            </>
          )}
          {missingCount > 0 && (
            <>
              {" · "}
              <span className="font-bold text-zinc-700">
                ไม่มีเอกสาร {missingCount}
              </span>
            </>
          )}
        </p>
      </header>

      {/* Filter chips */}
      <Section
        number="01"
        label="FILTER"
        title="กรองรายการ"
        action={
          canRegister ? (
            <Link
              href="/docuflow/vehicles/new"
              className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 bg-[var(--color-brand-600)] text-white hover:bg-[var(--color-brand-700)] active:bg-[var(--color-brand-800)] shadow-soft h-10 px-4 text-sm rounded-xl"
            >
              <Plus className="size-4" />
              เพิ่มรถ
            </Link>
          ) : null
        }
        className="mb-6"
      >
        <Card>
          <CardBody className="space-y-4">
            {/* Company chips */}
            <div>
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                บริษัท
              </p>
              <div className="flex flex-wrap gap-2">
                <FilterChip
                  href={buildHref({ company: undefined, branch: sp.branch, type: sp.type })}
                  label="ทั้งหมด"
                  active={!sp.company}
                />
                {companies.map((c) => (
                  <FilterChip
                    key={c.id}
                    href={buildHref({ company: c.id, branch: sp.branch, type: sp.type })}
                    label={c.code}
                    active={sp.company === c.id}
                  />
                ))}
              </div>
            </div>
            {/* Vehicle type chips */}
            <div>
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                ประเภทรถ
              </p>
              <div className="flex flex-wrap gap-2">
                <FilterChip
                  href={buildHref({ company: sp.company, branch: sp.branch, type: undefined })}
                  label="ทั้งหมด"
                  active={!sp.type}
                />
                {Object.entries(VEHICLE_TYPES).map(([k, v]) => (
                  <FilterChip
                    key={k}
                    href={buildHref({ company: sp.company, branch: sp.branch, type: k })}
                    label={`${v.emoji} ${v.label}`}
                    active={sp.type === k}
                  />
                ))}
              </div>
            </div>
            {/* Branch chips (เฉพาะถ้า ≤ 12 สาขา — เพื่อไม่ overflow) */}
            {branchOptions.length > 0 && branchOptions.length <= 12 && (
              <div>
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                  สาขา
                </p>
                <div className="flex flex-wrap gap-2">
                  <FilterChip
                    href={buildHref({ company: sp.company, branch: undefined, type: sp.type })}
                    label="ทั้งหมด"
                    active={!sp.branch}
                  />
                  {branchOptions.map((b) => (
                    <FilterChip
                      key={b.id}
                      href={buildHref({ company: sp.company, branch: b.id, type: sp.type })}
                      label={b.code}
                      active={sp.branch === b.id}
                    />
                  ))}
                </div>
              </div>
            )}
            {(sp.company || sp.branch || sp.type) && (
              <div className="flex items-center gap-2 pt-1">
                <Link
                  href="/docuflow/vehicles"
                  className="text-xs text-[var(--color-brand-700)] hover:underline font-medium"
                >
                  ล้างตัวกรอง
                </Link>
                <Badge tone="brand">
                  ผลลัพธ์ {rows.length} คัน
                </Badge>
              </div>
            )}
          </CardBody>
        </Card>
      </Section>

      {/* Vehicle list */}
      <Section number="02" label="FLEET" title="รายการรถ" className="mt-8">
        {rows.length === 0 ? (
          <Card>
            <CardBody>
              <EmptyState
                icon={<Truck className="size-6" />}
                title="ยังไม่มีรถ"
                description={
                  canRegister
                    ? "กดปุ่ม 'เพิ่มรถ' ด้านบนเพื่อลงทะเบียนคันแรก"
                    : "ขอให้ผู้ดูแลระบบลงทะเบียนรถให้"
                }
              />
            </CardBody>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {rows.map((vm) => (
              <VehicleCard key={vm.id} vm={vm} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/* ============================================================
   Helpers (server-only — components/Link)
   ============================================================ */

function buildHref(opts: {
  company?: string;
  branch?: string;
  type?: string;
}): string {
  const params = new URLSearchParams();
  if (opts.company) params.set("company", opts.company);
  if (opts.branch) params.set("branch", opts.branch);
  if (opts.type) params.set("type", opts.type);
  const qs = params.toString();
  return qs ? `/docuflow/vehicles?${qs}` : "/docuflow/vehicles";
}

function FilterChip({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-[var(--color-brand-600)] text-white"
          : "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-zinc-100 text-zinc-700 hover:bg-zinc-200 transition-colors"
      }
    >
      {label}
    </Link>
  );
}
