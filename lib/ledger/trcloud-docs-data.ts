import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { accountName } from "@/lib/ledger/coa-chart";

// อ่าน snapshot PO/AP จาก DB เรา (ไม่ยิง TRCloud) → เปิดหน้าเร็ว. sync แยกด้วยปุ่ม "รีเฟรช".
// + แยก "แหล่งที่มา": ใบไหนเราส่งขึ้นไปจาก LedgerLine vs ใบที่สร้างตรงใน TRCloud
//   (จับคู่จาก ledger_expense.trcloud_doc_id / trcloud_doc_no / reference==doc_code).
// + สำหรับใบ "จากเรา" (●) แนบหมวดค่าใช้จ่าย + รหัสบัญชีที่เราตั้งไว้ (โชว์เป็นคอลัมน์เร็ว ๆ)
//   — หมายเหตุ: นี่คือ "หมวดที่เราตั้ง" · การลงบัญชี "จริง" ของ TRCloud ดูได้ตอนคลิกเปิดไส้ใน.

export type TrcloudDocKind = "PO" | "AP";
export type TrcloudDocSource = "ours" | "trcloud";

export type TrcloudDocFilters = {
  kind: TrcloudDocKind;
  companyFormat?: string;
  department?: string;
  project?: string;
  status?: string;
  source?: TrcloudDocSource;
  category?: string; // หมวดค่าใช้จ่าย (ของใบที่ส่งจากเรา)
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
  hasVat: boolean;              // ยอดนี้มี VAT ไหม (tax > 0)
  fromLedger: boolean;          // ส่งขึ้นไปจาก LedgerLine (ฝั่งเรา)
  ledgerDocCode: string | null; // เลขใบภายใน LedgerLine (EXP-YYYYMM-NNNN) ถ้าจับคู่ได้
  ourCategoryName: string | null; // หมวดที่เราตั้ง (● เท่านั้น)
  ourAccCode: string | null;      // รหัสบัญชีเดบิตที่เราตั้ง (● เท่านั้น)
  ourAccName: string | null;      // ชื่อบัญชีของ ourAccCode
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
    category: string[]; // หมวดค่าใช้จ่ายที่พบในใบที่ส่งจากเรา
  };
  lastSyncedAt: string | null;
};

const ROW_LIMIT = 300;
const SENTINELS = new Set(["sent", "error", "pending", ""]);

function num(d: Prisma.Decimal | null): number | null {
  return d == null ? null : Number(d);
}

type CatInfo = { name: string | null; accCode: string | null };

// ดึงตัวจับคู่ "ใบที่ LedgerLine ส่งขึ้น TRCloud" (org นี้) → 3 สัญญาณ + map กลับเป็น docCode + หมวด/บัญชี
async function loadLedgerLinks(orgId: string) {
  const pushed = await prisma.ledgerExpense.findMany({
    where: { orgId, trcloudPushedAt: { not: null } },
    select: {
      docCode: true,
      trcloudDocId: true,
      trcloudDocNo: true,
      category: { select: { name: true, trcloudAccCode: true } },
    },
  });
  const idSet = new Set<string>();
  const noSet = new Set<string>();
  const codeSet = new Set<string>();
  const byId = new Map<string, string>();   // trcloudDocId → docCode
  const byNo = new Map<string, string>();    // trcloudDocNo → docCode
  const byCode = new Map<string, string>();  // docCode → docCode
  const catById = new Map<string, CatInfo>();
  const catByNo = new Map<string, CatInfo>();
  const catByCode = new Map<string, CatInfo>();
  const categoryNames = new Set<string>();
  for (const e of pushed) {
    const cat: CatInfo = { name: e.category?.name ?? null, accCode: e.category?.trcloudAccCode ?? null };
    if (cat.name) categoryNames.add(cat.name);
    if (e.trcloudDocId && !SENTINELS.has(e.trcloudDocId)) {
      idSet.add(e.trcloudDocId);
      byId.set(e.trcloudDocId, e.docCode);
      catById.set(e.trcloudDocId, cat);
    }
    if (e.trcloudDocNo) {
      noSet.add(e.trcloudDocNo);
      byNo.set(e.trcloudDocNo, e.docCode);
      catByNo.set(e.trcloudDocNo, cat);
    }
    if (e.docCode) {
      codeSet.add(e.docCode);
      byCode.set(e.docCode, e.docCode);
      catByCode.set(e.docCode, cat);
    }
  }
  return { idSet, noSet, codeSet, byId, byNo, byCode, catById, catByNo, catByCode, categoryNames };
}

type LedgerLinks = Awaited<ReturnType<typeof loadLedgerLinks>>;

function matchLedger(
  links: LedgerLinks,
  r: { trcloudId: string; docNumber: string | null; trcloudReference: string | null },
): { fromLedger: boolean; ledgerDocCode: string | null; cat: CatInfo | null } {
  if (links.idSet.has(r.trcloudId))
    return { fromLedger: true, ledgerDocCode: links.byId.get(r.trcloudId) ?? null, cat: links.catById.get(r.trcloudId) ?? null };
  if (r.docNumber && links.noSet.has(r.docNumber))
    return { fromLedger: true, ledgerDocCode: links.byNo.get(r.docNumber) ?? null, cat: links.catByNo.get(r.docNumber) ?? null };
  if (r.trcloudReference && links.codeSet.has(r.trcloudReference))
    return { fromLedger: true, ledgerDocCode: links.byCode.get(r.trcloudReference) ?? null, cat: links.catByCode.get(r.trcloudReference) ?? null };
  return { fromLedger: false, ledgerDocCode: null, cat: null };
}

function ledgerMatchOr(links: LedgerLinks): Prisma.LedgerTrcloudDocWhereInput[] {
  const or: Prisma.LedgerTrcloudDocWhereInput[] = [];
  if (links.idSet.size) or.push({ trcloudId: { in: [...links.idSet] } });
  if (links.noSet.size) or.push({ docNumber: { in: [...links.noSet] } });
  if (links.codeSet.size) or.push({ trcloudReference: { in: [...links.codeSet] } });
  return or;
}

// ใบที่ "หมวดที่เราตั้ง" == ชื่อหมวดที่เลือก → ชุดสัญญาณสำหรับ WHERE (กรองที่ DB ให้ count/truncate ถูก)
function categoryMatchOr(links: LedgerLinks, categoryName: string): Prisma.LedgerTrcloudDocWhereInput[] {
  const ids: string[] = [];
  const nos: string[] = [];
  const codes: string[] = [];
  for (const [k, v] of links.catById) if (v.name === categoryName) ids.push(k);
  for (const [k, v] of links.catByNo) if (v.name === categoryName) nos.push(k);
  for (const [k, v] of links.catByCode) if (v.name === categoryName) codes.push(k);
  const or: Prisma.LedgerTrcloudDocWhereInput[] = [];
  if (ids.length) or.push({ trcloudId: { in: ids } });
  if (nos.length) or.push({ docNumber: { in: nos } });
  if (codes.length) or.push({ trcloudReference: { in: codes } });
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
  // ตัวกรองหมวดค่าใช้จ่าย (เฉพาะใบที่ส่งจากเรา — ใบ TRCloud ล้วนไม่มีหมวดฝั่งเรา)
  if (f.category) {
    const or = categoryMatchOr(links, f.category);
    and.push(or.length ? { OR: or } : { id: "___none___" });
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
    const taxNum = num(r.tax);
    const accCode = m.cat?.accCode ?? null;
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
      tax: taxNum,
      wht: num(r.wht),
      payment: num(r.payment),
      staff: r.staff,
      invoiceNote: r.invoiceNote,
      pdfUrl: r.pdfUrl,
      prNo: r.prNo,
      hasVat: (taxNum ?? 0) > 0,
      fromLedger: m.fromLedger,
      ledgerDocCode: m.ledgerDocCode,
      ourCategoryName: m.cat?.name ?? null,
      ourAccCode: accCode,
      ourAccName: accountName(accCode),
    };
  });

  return {
    rows: mapped,
    truncated,
    counts,
    fromLedgerInView,
    facets: {
      companyFormat: cf,
      department: dept,
      project: proj,
      status,
      category: [...links.categoryNames].sort((a, b) => a.localeCompare(b, "th")),
    },
    lastSyncedAt: lastSync._max.syncedAt ? lastSync._max.syncedAt.toISOString() : null,
  };
}
