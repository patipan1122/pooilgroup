// DocuFlow — pyramid drill-down aggregations
// ────────────────────────────────────────────────────────────────────
// อ่านก่อนแก้: feedback_single_source_of_truth.md
//
// Goal: support Group → Company → Business Type → Branch drill view on
// /docuflow overview. ทำงานบน 1,100 docs (ทั้ง org) — small enough to
// aggregate in JS instead of raw SQL.
//
// Counting model (Phase 1 — direct-ownership only, no inheritance):
//   - "Group" tile  = docs ที่ ownership.level='group'
//   - Company X     = docs ที่ ownership.companyId=X (ไม่นับ branch ลงไป)
//   - BusinessType Y in Company X = docs ที่ ownership.businessType=Y
//                    (filtered to branches under X) + branch-level rolled up
//   - Branch B      = docs ที่ ownership.branchId=B
//
// Phase 2 (later): add ownership inheritance — group-level docs roll into
// every company; company-level docs roll into every business_type; etc.
// ────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import type { BusinessType } from "@/lib/generated/prisma/enums";

export interface DocStats {
  total: number;
  expired: number; // expiryDate < today
  critical: number; // 0 < days <= 30
  watch: number; // 31 <= days <= 90
  noExpiry: number; // doc has no renewal row
}

export interface AggregateNode {
  key: string; // companyId | businessType | branchId | "group"
  label: string;
  sublabel?: string;
  emoji?: string;
  href: string;
  stats: DocStats;
}

const EMPTY_STATS: DocStats = {
  total: 0,
  expired: 0,
  critical: 0,
  watch: 0,
  noExpiry: 0,
};

const TYPE_EMOJI: Record<string, string> = {
  fuel_station: "⛽",
  lpg_station: "🔵",
  lpg_retail: "🛢️",
  bottling_plant: "🏭",
  hotel: "🏨",
  convenience_store: "🏪",
  ev_station: "⚡",
  cafe: "☕",
  cafe_punthai: "🍵",
  massage_chair: "💺",
  claw_machine: "🎰",
  training_center: "🎓",
  transport: "🚛",
  gas_fleet: "🛻",
};

const TYPE_LABEL: Record<string, string> = {
  fuel_station: "ปั๊มน้ำมัน",
  lpg_station: "ปั๊มแก๊ส",
  lpg_retail: "ร้านค้าแก๊ส",
  bottling_plant: "โรงบรรจุก๊าซ",
  hotel: "โรงแรม",
  convenience_store: "ร้านสะดวกซื้อ",
  ev_station: "EV Station",
  cafe: "Café Amazon",
  cafe_punthai: "พันธุ์ไทย",
  massage_chair: "เก้าอี้นวด",
  claw_machine: "ตู้คีบ",
  training_center: "ศูนย์ฝึกอบรม",
  transport: "ขนส่ง",
  gas_fleet: "Fleet ก๊าซ",
};

export function businessTypeLabel(t: string): string {
  return TYPE_LABEL[t] ?? t;
}

export function businessTypeEmoji(t: string): string {
  return TYPE_EMOJI[t] ?? "📄";
}

interface OwnershipRow {
  level: string;
  companyId: string | null;
  branchId: string | null;
  businessType: string | null;
  documentId: string;
  expiryDate: Date | null; // earliest renewal expiry, null if none
}

/** Fetch all ownership rows joined with earliest renewal date — single query. */
async function loadOwnershipRows(orgId: string): Promise<OwnershipRow[]> {
  const rows = await prisma.documentOwnership.findMany({
    where: { orgId, document: { isActive: true } },
    select: {
      level: true,
      companyId: true,
      branchId: true,
      businessType: true,
      documentId: true,
      document: {
        select: {
          renewals: {
            orderBy: { expiryDate: "asc" },
            take: 1,
            select: { expiryDate: true },
          },
        },
      },
    },
  });

  return rows.map((r) => ({
    level: r.level,
    companyId: r.companyId,
    branchId: r.branchId,
    businessType: r.businessType,
    documentId: r.documentId,
    expiryDate: r.document.renewals[0]?.expiryDate ?? null,
  }));
}

function classify(expiryDate: Date | null, today: Date): keyof DocStats | null {
  if (!expiryDate) return "noExpiry";
  const days = Math.floor(
    (expiryDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (days < 0) return "expired";
  if (days <= 30) return "critical";
  if (days <= 90) return "watch";
  return null;
}

function addToStats(stats: DocStats, expiryDate: Date | null, today: Date) {
  stats.total += 1;
  const bucket = classify(expiryDate, today);
  if (bucket && bucket !== "total") {
    stats[bucket] += 1;
  }
}

/* ============================================================
   ROOT — list companies + a "Group-level" tile + counts
   ============================================================ */

export interface RootView {
  groupTile: AggregateNode | null; // null = no group-level docs
  companies: AggregateNode[];
  totals: DocStats;
}

export async function aggregateRoot(orgId: string): Promise<RootView> {
  const [rows, companies] = await Promise.all([
    loadOwnershipRows(orgId),
    prisma.company.findMany({
      where: { orgId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true },
    }),
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const groupStats: DocStats = { ...EMPTY_STATS };
  const perCompany = new Map<string, DocStats>();
  for (const c of companies) perCompany.set(c.id, { ...EMPTY_STATS });

  // Track unique (companyId × documentId) so docs touching multiple ownerships
  // of the same company aren't double-counted.
  const seenGroup = new Set<string>();
  const seenCompany = new Map<string, Set<string>>();
  for (const c of companies) seenCompany.set(c.id, new Set());

  const totals: DocStats = { ...EMPTY_STATS };
  const seenTotals = new Set<string>();

  for (const r of rows) {
    if (!seenTotals.has(r.documentId)) {
      seenTotals.add(r.documentId);
      addToStats(totals, r.expiryDate, today);
    }

    if (r.level === "group") {
      if (!seenGroup.has(r.documentId)) {
        seenGroup.add(r.documentId);
        addToStats(groupStats, r.expiryDate, today);
      }
    } else if (r.companyId) {
      const seen = seenCompany.get(r.companyId);
      const stats = perCompany.get(r.companyId);
      if (seen && stats && !seen.has(r.documentId)) {
        seen.add(r.documentId);
        addToStats(stats, r.expiryDate, today);
      }
    }
    // Note: business_type / branch / person without companyId are not rolled
    // up to a company in Phase 1. They'll appear when drilling into specific
    // levels.
  }

  const companyNodes: AggregateNode[] = companies.map((c) => ({
    key: c.id,
    label: c.name,
    sublabel: c.code,
    emoji: "🏢",
    href: `/docuflow?level=company&id=${c.id}`,
    stats: perCompany.get(c.id) ?? { ...EMPTY_STATS },
  }));

  const groupTile: AggregateNode | null =
    groupStats.total > 0
      ? {
          key: "group",
          label: "ทั้งกลุ่ม",
          sublabel: "Pooilgroup · เอกสารระดับกลุ่ม",
          emoji: "🌐",
          href: `/docuflow?level=group`,
          stats: groupStats,
        }
      : null;

  return { groupTile, companies: companyNodes, totals };
}

/* ============================================================
   COMPANY — show business types within a company + direct company docs
   ============================================================ */

export interface CompanyView {
  company: { id: string; code: string; name: string };
  directStats: DocStats;
  businessTypes: AggregateNode[];
  totals: DocStats;
}

export async function aggregateCompany(
  orgId: string,
  companyId: string,
): Promise<CompanyView | null> {
  const [rows, company, branches] = await Promise.all([
    loadOwnershipRows(orgId),
    prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, code: true, name: true, orgId: true },
    }),
    prisma.branch.findMany({
      where: { orgId, companyId, isActive: true },
      select: { id: true, businessType: true },
    }),
  ]);

  if (!company || company.orgId !== orgId) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const branchToType = new Map<string, BusinessType>();
  const typesPresent = new Set<BusinessType>();
  for (const b of branches) {
    branchToType.set(b.id, b.businessType);
    typesPresent.add(b.businessType);
  }

  const directStats: DocStats = { ...EMPTY_STATS };
  const seenDirect = new Set<string>();
  const perType = new Map<BusinessType, DocStats>();
  const seenType = new Map<BusinessType, Set<string>>();
  for (const t of typesPresent) {
    perType.set(t, { ...EMPTY_STATS });
    seenType.set(t, new Set());
  }
  const totals: DocStats = { ...EMPTY_STATS };
  const seenTotals = new Set<string>();

  for (const r of rows) {
    let touchesCompany = false;

    if (r.level === "company" && r.companyId === companyId) {
      touchesCompany = true;
      if (!seenDirect.has(r.documentId)) {
        seenDirect.add(r.documentId);
        addToStats(directStats, r.expiryDate, today);
      }
    }

    if (r.level === "business_type" && r.businessType) {
      const t = r.businessType as BusinessType;
      if (typesPresent.has(t)) {
        touchesCompany = true;
        const seen = seenType.get(t);
        const stats = perType.get(t);
        if (seen && stats && !seen.has(r.documentId)) {
          seen.add(r.documentId);
          addToStats(stats, r.expiryDate, today);
        }
      }
    }

    if (r.level === "branch" && r.branchId && branchToType.has(r.branchId)) {
      const t = branchToType.get(r.branchId)!;
      touchesCompany = true;
      const seen = seenType.get(t);
      const stats = perType.get(t);
      if (seen && stats && !seen.has(r.documentId)) {
        seen.add(r.documentId);
        addToStats(stats, r.expiryDate, today);
      }
    }

    if (touchesCompany && !seenTotals.has(r.documentId)) {
      seenTotals.add(r.documentId);
      addToStats(totals, r.expiryDate, today);
    }
  }

  const businessTypes: AggregateNode[] = Array.from(typesPresent)
    .map((t) => ({
      key: t,
      label: businessTypeLabel(t),
      emoji: businessTypeEmoji(t),
      href: `/docuflow?level=business_type&id=${companyId}_${t}`,
      stats: perType.get(t) ?? { ...EMPTY_STATS },
    }))
    .sort((a, b) => b.stats.total - a.stats.total);

  return {
    company: { id: company.id, code: company.code, name: company.name },
    directStats,
    businessTypes,
    totals,
  };
}

/* ============================================================
   BUSINESS TYPE — show branches within (company × business_type)
   ============================================================ */

export interface BusinessTypeView {
  company: { id: string; code: string; name: string };
  businessType: BusinessType;
  businessTypeLabel: string;
  businessTypeEmoji: string;
  directStats: DocStats; // docs ที่ owned ที่ระดับ business_type โดยตรง
  branches: AggregateNode[];
  totals: DocStats;
}

export async function aggregateBusinessType(
  orgId: string,
  companyId: string,
  businessType: BusinessType,
): Promise<BusinessTypeView | null> {
  const [rows, company, branches] = await Promise.all([
    loadOwnershipRows(orgId),
    prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, code: true, name: true, orgId: true },
    }),
    prisma.branch.findMany({
      where: { orgId, companyId, businessType, isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, province: true },
    }),
  ]);

  if (!company || company.orgId !== orgId) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const branchIds = new Set(branches.map((b) => b.id));

  const directStats: DocStats = { ...EMPTY_STATS };
  const seenDirect = new Set<string>();
  const perBranch = new Map<string, DocStats>();
  const seenBranch = new Map<string, Set<string>>();
  for (const b of branches) {
    perBranch.set(b.id, { ...EMPTY_STATS });
    seenBranch.set(b.id, new Set());
  }
  const totals: DocStats = { ...EMPTY_STATS };
  const seenTotals = new Set<string>();

  for (const r of rows) {
    let touches = false;

    if (r.level === "business_type" && r.businessType === businessType) {
      touches = true;
      if (!seenDirect.has(r.documentId)) {
        seenDirect.add(r.documentId);
        addToStats(directStats, r.expiryDate, today);
      }
    }

    if (r.level === "branch" && r.branchId && branchIds.has(r.branchId)) {
      touches = true;
      const seen = seenBranch.get(r.branchId);
      const stats = perBranch.get(r.branchId);
      if (seen && stats && !seen.has(r.documentId)) {
        seen.add(r.documentId);
        addToStats(stats, r.expiryDate, today);
      }
    }

    if (touches && !seenTotals.has(r.documentId)) {
      seenTotals.add(r.documentId);
      addToStats(totals, r.expiryDate, today);
    }
  }

  const branchNodes: AggregateNode[] = branches.map((b) => ({
    key: b.id,
    label: b.name,
    sublabel: [b.code, b.province].filter(Boolean).join(" · "),
    emoji: "🏪",
    href: `/docuflow/documents?branchId=${b.id}`,
    stats: perBranch.get(b.id) ?? { ...EMPTY_STATS },
  }));

  return {
    company: { id: company.id, code: company.code, name: company.name },
    businessType,
    businessTypeLabel: businessTypeLabel(businessType),
    businessTypeEmoji: businessTypeEmoji(businessType),
    directStats,
    branches: branchNodes,
    totals,
  };
}

/* ============================================================
   GROUP-LEVEL DOCS view — list of docs at level='group'
   ============================================================ */

export interface GroupView {
  stats: DocStats;
  count: number; // for header
}

export async function aggregateGroupLevel(orgId: string): Promise<GroupView> {
  const rows = await prisma.documentOwnership.findMany({
    where: {
      orgId,
      level: "group",
      document: { isActive: true },
    },
    select: {
      documentId: true,
      document: {
        select: {
          renewals: {
            orderBy: { expiryDate: "asc" },
            take: 1,
            select: { expiryDate: true },
          },
        },
      },
    },
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const stats: DocStats = { ...EMPTY_STATS };
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.documentId)) continue;
    seen.add(r.documentId);
    addToStats(stats, r.document.renewals[0]?.expiryDate ?? null, today);
  }
  return { stats, count: stats.total };
}
