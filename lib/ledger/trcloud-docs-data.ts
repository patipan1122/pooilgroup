import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";

// อ่าน snapshot PO/AP จาก DB เรา (ไม่ยิง TRCloud) → เปิดหน้าเร็ว. sync แยกด้วยปุ่ม "รีเฟรช".

export type TrcloudDocKind = "PO" | "AP";

export type TrcloudDocFilters = {
  kind: TrcloudDocKind;
  companyFormat?: string;
  department?: string;
  project?: string;
  status?: string;
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
  q?: string;
};

export type TrcloudDocRow = {
  id: string;
  kind: TrcloudDocKind;
  trcloudId: string;
  companyFormat: string | null;
  docNumber: string | null;
  refNo: string | null;
  issueDate: string | null;
  vendorName: string | null;
  organization: string | null;
  taxId: string | null;
  department: string | null;
  project: string | null;
  status: string | null;
  statusAp: string | null;
  total: number | null;
  grandTotal: number | null;
  tax: number | null;
  wht: number | null;
  payment: number | null;
  staff: string | null;
  invoiceNote: string | null;
  pdfUrl: string | null;
  prNo: string | null;
};

export type TrcloudDocsData = {
  rows: TrcloudDocRow[];
  truncated: boolean;
  counts: { po: number; ap: number };
  facets: {
    companyFormat: string[];
    department: string[];
    project: string[];
    status: string[];
  };
  lastSyncedAt: string | null;
};

const ROW_LIMIT = 300;

function num(d: Prisma.Decimal | null): number | null {
  return d == null ? null : Number(d);
}

function buildWhere(orgId: string, f: TrcloudDocFilters): Prisma.LedgerTrcloudDocWhereInput {
  const where: Prisma.LedgerTrcloudDocWhereInput = { orgId, kind: f.kind };
  if (f.companyFormat) where.companyFormat = f.companyFormat;
  if (f.department) where.department = f.department;
  if (f.project) where.project = f.project;
  if (f.status) where.status = f.status;
  if (f.from || f.to) {
    where.issueDate = {};
    if (f.from) where.issueDate.gte = new Date(`${f.from}T00:00:00`);
    if (f.to) where.issueDate.lte = new Date(`${f.to}T23:59:59`);
  }
  if (f.q && f.q.trim()) {
    const q = f.q.trim();
    where.OR = [
      { vendorName: { contains: q, mode: "insensitive" } },
      { organization: { contains: q, mode: "insensitive" } },
      { docNumber: { contains: q, mode: "insensitive" } },
      { refNo: { contains: q, mode: "insensitive" } },
      { invoiceNote: { contains: q, mode: "insensitive" } },
      { taxId: { contains: q, mode: "insensitive" } },
    ];
  }
  return where;
}

async function facetValues(orgId: string, kind: TrcloudDocKind, field: "companyFormat" | "department" | "project" | "status"): Promise<string[]> {
  const rows = await prisma.ledgerTrcloudDoc.findMany({
    where: { orgId, kind, [field]: { not: null } },
    select: { [field]: true },
    distinct: [field],
    orderBy: { [field]: "asc" },
    take: 200,
  });
  return rows.map((r) => (r as Record<string, string | null>)[field]).filter((v): v is string => !!v);
}

export async function getTrcloudDocs(orgId: string, f: TrcloudDocFilters): Promise<TrcloudDocsData> {
  const where = buildWhere(orgId, f);
  const [rows, countByKind, cf, dept, proj, status, lastSync] = await Promise.all([
    prisma.ledgerTrcloudDoc.findMany({
      where,
      orderBy: [{ issueDate: { sort: "desc", nulls: "last" } }, { trcloudCreatedAt: "desc" }],
      take: ROW_LIMIT + 1,
    }),
    prisma.ledgerTrcloudDoc.groupBy({ by: ["kind"], where: { orgId }, _count: { _all: true } }),
    facetValues(orgId, f.kind, "companyFormat"),
    facetValues(orgId, f.kind, "department"),
    facetValues(orgId, f.kind, "project"),
    facetValues(orgId, f.kind, "status"),
    prisma.ledgerTrcloudDoc.aggregate({ where: { orgId }, _max: { syncedAt: true } }),
  ]);

  const truncated = rows.length > ROW_LIMIT;
  const sliced = truncated ? rows.slice(0, ROW_LIMIT) : rows;

  const counts = { po: 0, ap: 0 };
  for (const c of countByKind) {
    if (c.kind === "PO") counts.po = c._count._all;
    else if (c.kind === "AP") counts.ap = c._count._all;
  }

  return {
    rows: sliced.map((r) => ({
      id: r.id,
      kind: r.kind as TrcloudDocKind,
      trcloudId: r.trcloudId,
      companyFormat: r.companyFormat,
      docNumber: r.docNumber,
      refNo: r.refNo,
      issueDate: r.issueDate ? r.issueDate.toISOString().slice(0, 10) : null,
      vendorName: r.vendorName,
      organization: r.organization,
      taxId: r.taxId,
      department: r.department,
      project: r.project,
      status: r.status,
      statusAp: r.statusAp,
      total: num(r.total),
      grandTotal: num(r.grandTotal),
      tax: num(r.tax),
      wht: num(r.wht),
      payment: num(r.payment),
      staff: r.staff,
      invoiceNote: r.invoiceNote,
      pdfUrl: r.pdfUrl,
      prNo: r.prNo,
    })),
    truncated,
    counts,
    facets: { companyFormat: cf, department: dept, project: proj, status },
    lastSyncedAt: lastSync._max.syncedAt ? lastSync._max.syncedAt.toISOString() : null,
  };
}
