import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";

// อ่าน snapshot PO/AP จาก DB เรา (ไม่ยิง TRCloud) → เปิดหน้าเร็ว. sync แยกด้วยปุ่ม "รีเฟรช".
// + แยก "แหล่งที่มา": ใบไหนเราส่งขึ้นไปจาก LedgerLine vs ใบที่สร้างตรงใน TRCloud
//   (จับคู่จาก ledger_expense.trcloud_doc_id / trcloud_doc_no / reference==doc_code).

export type TrcloudDocKind = "PO" | "AP";
export type TrcloudDocSource = "ours" | "trcloud";

export type TrcloudDocFilters = {
  kind: TrcloudDocKind;
  companyFormat?: string;
  department?: string;
  project?: string;
  status?: string;
  source?: TrcloudDocSource;
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
  fromLedger: boolean;         // ส่งขึ้นไปจาก LedgerLine (ฝั่งเรา)
  ledgerDocCode: string | null; // เลขใบภายใน LedgerLine (EXP-YYYYMM-NNNN) ถ้าจับคู่ได้
};

export type TrcloudDocsData = {
  rows: TrcloudDocRow[];
  truncated: boolean;
  counts: { po: number; ap: number };
  fromLedgerInView: number; // ในชุดที่แสดง มีกี่ใบที่ส่งจากเรา
  facets: {
    companyFormat: string[];
    department: string[];
    project: string[];
    status: string[];
  };
  lastSyncedAt: string | null;
};

const ROW_LIMIT = 300;
const SENTINELS = new Set(["sent", "error", "pending", ""]);

function num(d: Prisma.Decimal | null): number | null {
  return d == null ? null : Number(d);
}

// ดึงตัวจับคู่ "ใบที่ LedgerLine ส่งขึ้น TRCloud" (org นี้) → 3 สัญญาณ + map กลับเป็น docCode
async function loadLedgerLinks(orgId: string) {
  const pushed = await prisma.ledgerExpense.findMany({
    where: { orgId, trcloudPushedAt: { not: null } },
    select: { docCode: true, trcloudDocId: true, trcloudDocNo: true },
  });
  const idSet = new Set<string>();
  const noSet = new Set<string>();
  const codeSet = new Set<string>();
  const byId = new Map<string, string>();   // trcloudDocId → docCode
  const byNo = new Map<string, string>();    // trcloudDocNo → docCode
  const byCode = new Map<string, string>();  // docCode → docCode
  for (const e of pushed) {
    if (e.trcloudDocId && !SENTINELS.has(e.trcloudDocId)) {
      idSet.add(e.trcloudDocId);
      byId.set(e.trcloudDocId, e.docCode);
    }
    if (e.trcloudDocNo) {
      noSet.add(e.trcloudDocNo);
      byNo.set(e.trcloudDocNo, e.docCode);
    }
    if (e.docCode) {
      codeSet.add(e.docCode);
      byCode.set(e.docCode, e.docCode);
    }
  }
  return { idSet, noSet, codeSet, byId, byNo, byCode };
}

type LedgerLinks = Awaited<ReturnType<typeof loadLedgerLinks>>;

function matchLedger(
  links: LedgerLinks,
  r: { trcloudId: string; docNumber: string | null; trcloudReference: string | null },
): { fromLedger: boolean; ledgerDocCode: string | null } {
  if (links.idSet.has(r.trcloudId)) return { fromLedger: true, ledgerDocCode: links.byId.get(r.trcloudId) ?? null };
  if (r.docNumber && links.noSet.has(r.docNumber)) return { fromLedger: true, ledgerDocCode: links.byNo.get(r.docNumber) ?? null };
  if (r.trcloudReference && links.codeSet.has(r.trcloudReference)) return { fromLedger: true, ledgerDocCode: links.byCode.get(r.trcloudReference) ?? null };
  return { fromLedger: false, ledgerDocCode: null };
}

function ledgerMatchOr(links: LedgerLinks): Prisma.LedgerTrcloudDocWhereInput[] {
  const or: Prisma.LedgerTrcloudDocWhereInput[] = [];
  if (links.idSet.size) or.push({ trcloudId: { in: [...links.idSet] } });
  if (links.noSet.size) or.push({ docNumber: { in: [...links.noSet] } });
  if (links.codeSet.size) or.push({ trcloudReference: { in: [...links.codeSet] } });
  return or;
}

function buildWhere(orgId: string, f: TrcloudDocFilters, links: LedgerLinks): Prisma.LedgerTrcloudDocWhereInput {
  const and: Prisma.LedgerTrcloudDocWhereInput[] = [];
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
    and.push({
      OR: [
        { vendorName: { contains: q, mode: "insensitive" } },
        { organization: { contains: q, mode: "insensitive" } },
        { docNumber: { contains: q, mode: "insensitive" } },
        { refNo: { contains: q, mode: "insensitive" } },
        { invoiceNote: { contains: q, mode: "insensitive" } },
        { taxId: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  // ตัวกรองแหล่งที่มา
  if (f.source === "ours") {
    const or = ledgerMatchOr(links);
    and.push(or.length ? { OR: or } : { id: "___none___" }); // ไม่มีใบจากเรา → ไม่แสดงอะไร
  } else if (f.source === "trcloud") {
    const or = ledgerMatchOr(links);
    if (or.length) and.push({ NOT: { OR: or } });
  }
  if (and.length) where.AND = and;
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
  const links = await loadLedgerLinks(orgId);
  const where = buildWhere(orgId, f, links);
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

  let fromLedgerInView = 0;
  const mapped: TrcloudDocRow[] = sliced.map((r) => {
    const m = matchLedger(links, { trcloudId: r.trcloudId, docNumber: r.docNumber, trcloudReference: r.trcloudReference });
    if (m.fromLedger) fromLedgerInView += 1;
    return {
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
      fromLedger: m.fromLedger,
      ledgerDocCode: m.ledgerDocCode,
    };
  });

  return {
    rows: mapped,
    truncated,
    counts,
    fromLedgerInView,
    facets: { companyFormat: cf, department: dept, project: proj, status },
    lastSyncedAt: lastSync._max.syncedAt ? lastSync._max.syncedAt.toISOString() : null,
  };
}
