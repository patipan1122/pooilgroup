// DocuFlow · ทะเบียนรถ + เอกสารยานพาหนะ — fleet list
// Server component · canonical loaders · pre-rendered VM rows
// Single Source: lib/vehicles/data.ts (loadVehicles, loadVehicleDocuments)

import Link from "next/link";
import { Truck, Plus, ArrowLeft, AlertTriangle, FileText } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { thaiDateLong } from "@/lib/utils/format";
import {
  DfButton,
  DfCard,
  DfEyebrow,
  DfPageHeader,
  DfPill,
  DfSection,
  DfStatCard,
} from "@/components/docuflow/df-ui";
import { DfTopBanner } from "@/components/docuflow/df-top-banner";
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
    <div
      style={{
        padding: "28px clamp(16px, 4vw, 40px)",
        paddingBottom: 96,
        maxWidth: 1500,
        margin: "0 auto",
      }}
    >
      <DfTopBanner breadcrumbs={[{ label: "หน้าหลัก", href: "/docuflow" }, { label: "ทะเบียนรถ" }]} />

      <DfPageHeader
        eyebrow={<DfEyebrow>ทะเบียนรถ · กองรถ</DfEyebrow>}
        title={
          <>
            <span style={{ color: "var(--df-brand)" }}>{rows.length}</span> คัน
            {expiringSoonCount > 0 && (
              <>
                <br />
                <span style={{ color: "var(--df-danger)" }}>
                  {expiringSoonCount} คันต้องดำเนินการ
                </span>
              </>
            )}
          </>
        }
        description={`${thaiDateLong(new Date())} · ใบขับขี่ · พ.ร.บ. · ตรวจสภาพ`}
        actions={
          canRegister ? (
            <DfButton href="/docuflow/vehicles/new" variant="brand">
              <Plus size={15} />
              เพิ่มรถ
            </DfButton>
          ) : null
        }
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 12,
          marginBottom: 22,
        }}
        className="df-fade-up df-fade-up-100"
      >
        <DfStatCard
          label="กองรถทั้งหมด"
          value={rows.length}
          tone="ink"
          icon={<Truck size={17} />}
        />
        <DfStatCard
          label="ใกล้หมดอายุ"
          value={expiringSoonCount}
          tone={expiringSoonCount > 0 ? "warn" : "ink"}
          icon={<AlertTriangle size={17} />}
        />
        <DfStatCard
          label="ไม่มีเอกสาร"
          value={missingCount}
          tone={missingCount > 0 ? "danger" : "ink"}
          icon={<FileText size={17} />}
        />
        <DfStatCard
          label="พร้อมใช้"
          value={Math.max(0, rows.length - expiringSoonCount - missingCount)}
          tone="success"
          icon={<Truck size={17} />}
        />
      </div>

      <DfSection
        number="01"
        label="ตัวกรอง"
        action={
          (sp.company || sp.branch || sp.type) ? (
            <DfPill tone="brand" small>
              ผลลัพธ์ {rows.length} คัน
            </DfPill>
          ) : null
        }
        className="df-fade-up df-fade-up-100"
      >
        <DfCard padding={18}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
              <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4 }}>
                <Link
                  href="/docuflow/vehicles"
                  style={{
                    fontSize: 12,
                    color: "var(--df-brand)",
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  ล้างตัวกรอง
                </Link>
              </div>
            )}
          </div>
        </DfCard>
      </DfSection>

      {/* Vehicle list */}
      <DfSection number="02" label={`รายการรถ · ${rows.length} คัน`}>
        {rows.length === 0 ? (
          <DfCard padding={36} style={{ textAlign: "center" }}>
            <Truck size={32} style={{ color: "var(--df-muted)", margin: "0 auto 12px" }} />
            <h3 className="df-serif" style={{ fontSize: 18, marginTop: 0, marginBottom: 8 }}>
              ยังไม่มีรถ
            </h3>
            <p style={{ fontSize: 13, color: "var(--df-muted)", marginBottom: 16 }}>
              {canRegister
                ? "กดปุ่ม 'เพิ่มรถ' ด้านบนเพื่อลงทะเบียนคันแรก"
                : "ขอให้ผู้ดูแลระบบลงทะเบียนรถให้"}
            </p>
            {canRegister && (
              <DfButton href="/docuflow/vehicles/new" variant="brand">
                <Plus size={14} />
                เพิ่มรถคันแรก
              </DfButton>
            )}
          </DfCard>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
              gap: 14,
            }}
          >
            {rows.map((vm) => (
              <VehicleCard key={vm.id} vm={vm} />
            ))}
          </div>
        )}
      </DfSection>
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
