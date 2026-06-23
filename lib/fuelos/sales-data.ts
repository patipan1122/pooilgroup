import "server-only";
import { prisma } from "@/lib/prisma";

// FuelOS · ยอดขาย/ลูกหนี้ — query layer
// PERF: สรุปด้วย SQL (aggregate/groupBy) ไม่โหลดทุกแถวเข้า memory (ข้อมูลหลายหมื่นใบ)
// ทุกอย่าง serializable (Decimal → number, Date → ISO) เพราะส่งเข้า client component

export type PaymentState = "PAID" | "PARTIAL" | "UNPAID";

export interface InvoiceRow {
  id: string;
  docNo: string;
  companyFormat: string | null;
  contactId: string | null;
  customerName: string;
  customerOrg: string | null;
  issueDate: string;
  dueDate: string | null;
  paidDate: string | null;     // วันจ่ายล่าสุด (จากใบเสร็จ RV)
  grandTotal: number;
  paidAmount: number;
  outstanding: number;
  paymentState: PaymentState;
  trcloudStatus: string | null;
  salesman: string | null;
  quantity: number;
  isOverdue: boolean;
  overdueDays: number;
}

export interface CustomerAgg {
  key: string;
  contactId: string | null;
  name: string;
  org: string | null;
  taxId: string | null;
  totalSales: number;
  paid: number;
  outstanding: number;
  overdue: number;
  invoiceCount: number;
  lastIssueDate: string;
}

export interface SalesOverview {
  totalSales: number; totalPaid: number; totalOutstanding: number; totalOverdue: number;
  invoiceCount: number; customerCount: number; unpaidCount: number; partialCount: number;
}

export interface SalesData {
  overview: SalesOverview;
  byCustomer: CustomerAgg[];
  invoices: InvoiceRow[];
  invoicesTruncated: boolean;
  lastSyncedAt: string | null;
}

function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function daysBetween(a: Date, b: Date): number {
  return Math.floor((startOfDayUTC(a).getTime() - startOfDayUTC(b).getTime()) / 86_400_000);
}
const num = (d: unknown): number => Number(d ?? 0);
const round = (n: number): number => Math.round(n * 100) / 100;

// แปลงแถว prisma → InvoiceRow (+ overdue)
function mapRow(r: {
  id: string; docNo: string; companyFormat: string | null; contactId: string | null;
  customerName: string; customerOrg: string | null; issueDate: Date; dueDate: Date | null;
  paidDate: Date | null; grandTotal: unknown; paidAmount: unknown; outstanding: unknown;
  paymentState: string; trcloudStatus: string | null; salesman: string | null; quantity: unknown;
}, today: Date): InvoiceRow {
  const outstanding = num(r.outstanding);
  const overdueDays = r.dueDate && outstanding > 0.01 ? Math.max(daysBetween(today, new Date(r.dueDate)), 0) : 0;
  return {
    id: r.id, docNo: r.docNo, companyFormat: r.companyFormat, contactId: r.contactId,
    customerName: r.customerName, customerOrg: r.customerOrg,
    issueDate: r.issueDate.toISOString().slice(0, 10),
    dueDate: r.dueDate ? r.dueDate.toISOString().slice(0, 10) : null,
    paidDate: r.paidDate ? r.paidDate.toISOString().slice(0, 10) : null,
    grandTotal: num(r.grandTotal), paidAmount: num(r.paidAmount), outstanding,
    paymentState: r.paymentState as PaymentState, trcloudStatus: r.trcloudStatus,
    salesman: r.salesman, quantity: num(r.quantity),
    isOverdue: overdueDays > 0, overdueDays,
  };
}

interface RawCust {
  key: string; contactId: string | null; name: string; org: string | null; taxId: string | null;
  totalSales: number; paid: number; outstanding: number; overdue: number; invoiceCount: number; lastIssueDate: string;
}

const INVOICE_LIMIT = 300;

// สรุปยอดขายช่วงวันที่ — SQL ทำงานหนักแทน JS (เร็วแม้ข้อมูลหลายหมื่นใบ)
export async function getSalesData(
  orgId: string,
  opts: { from: Date; to: Date; state?: PaymentState | "OVERDUE" | "ALL"; q?: string },
): Promise<SalesData> {
  const today = startOfDayUTC(new Date());
  const { from, to } = opts;
  const where = { orgId, issueDate: { gte: from, lte: to } };
  const state = opts.state ?? "ALL";
  const q = (opts.q ?? "").trim();

  const [agg, overdueAgg, stateGroups, custRow, lastSync, byCustomerRaw, rows] = await Promise.all([
    prisma.salesInvoice.aggregate({ where, _sum: { grandTotal: true, paidAmount: true, outstanding: true }, _count: { _all: true } }),
    prisma.salesInvoice.aggregate({ where: { ...where, paymentState: { not: "PAID" }, outstanding: { gt: 0 }, dueDate: { lt: today } }, _sum: { outstanding: true } }),
    prisma.salesInvoice.groupBy({ by: ["paymentState"], where, _count: { _all: true } }),
    prisma.$queryRaw<Array<{ c: number }>>`SELECT count(DISTINCT coalesce(contact_id, customer_name))::int AS c FROM fuel.sales_invoices WHERE org_id = ${orgId}::uuid AND issue_date >= ${from} AND issue_date <= ${to}`,
    prisma.salesInvoice.aggregate({ where: { orgId }, _max: { syncedAt: true } }),
    prisma.$queryRaw<RawCust[]>`
      SELECT coalesce(contact_id, 'n:' || customer_name) AS key, contact_id AS "contactId",
        max(customer_name) AS name, max(customer_org) AS org, max(customer_tax_id) AS "taxId",
        sum(grand_total)::float8 AS "totalSales", sum(paid_amount)::float8 AS paid,
        sum(outstanding)::float8 AS outstanding,
        sum(CASE WHEN outstanding > 0 AND payment_state <> 'PAID' AND due_date IS NOT NULL AND due_date < ${today} THEN outstanding ELSE 0 END)::float8 AS overdue,
        count(*)::int AS "invoiceCount", max(issue_date)::text AS "lastIssueDate"
      FROM fuel.sales_invoices
      WHERE org_id = ${orgId}::uuid AND issue_date >= ${from} AND issue_date <= ${to}
      GROUP BY coalesce(contact_id, 'n:' || customer_name), contact_id
      ORDER BY outstanding DESC, "totalSales" DESC
      LIMIT 300`,
    prisma.salesInvoice.findMany({
      where: {
        ...where,
        ...(state === "UNPAID" || state === "PARTIAL" || state === "PAID" ? { paymentState: state } : {}),
        ...(state === "OVERDUE" ? { paymentState: { not: "PAID" }, outstanding: { gt: 0 }, dueDate: { lt: today } } : {}),
        ...(q ? { OR: [
          { docNo: { contains: q, mode: "insensitive" as const } },
          { customerName: { contains: q, mode: "insensitive" as const } },
          { customerOrg: { contains: q, mode: "insensitive" as const } },
          { salesman: { contains: q, mode: "insensitive" as const } },
        ] } : {}),
      },
      orderBy: { issueDate: "desc" },
      take: INVOICE_LIMIT + 1,
    }),
  ]);

  const stateCount = (s: string) => Number(stateGroups.find((g) => g.paymentState === s)?._count._all ?? 0);
  const overview: SalesOverview = {
    totalSales: round(num(agg._sum.grandTotal)),
    totalPaid: round(num(agg._sum.paidAmount)),
    totalOutstanding: round(num(agg._sum.outstanding)),
    totalOverdue: round(num(overdueAgg._sum.outstanding)),
    invoiceCount: agg._count._all,
    customerCount: Number(custRow[0]?.c ?? 0),
    unpaidCount: stateCount("UNPAID"),
    partialCount: stateCount("PARTIAL"),
  };

  const byCustomer: CustomerAgg[] = byCustomerRaw.map((r) => ({
    key: r.key, contactId: r.contactId, name: r.name, org: r.org, taxId: r.taxId,
    totalSales: round(num(r.totalSales)), paid: round(num(r.paid)),
    outstanding: round(num(r.outstanding)), overdue: round(num(r.overdue)),
    invoiceCount: Number(r.invoiceCount), lastIssueDate: r.lastIssueDate,
  }));

  const invoicesTruncated = rows.length > INVOICE_LIMIT;
  const invoices = rows.slice(0, INVOICE_LIMIT).map((r) => mapRow(r, today));

  return { overview, byCustomer, invoices, invoicesTruncated, lastSyncedAt: lastSync._max.syncedAt ? lastSync._max.syncedAt.toISOString() : null };
}

export interface CustomerDetail {
  name: string; org: string | null; taxId: string | null; contactId: string | null;
  totalSales: number; paid: number; outstanding: number; overdue: number; invoiceCount: number;
  invoices: InvoiceRow[];
}

// รายละเอียดลูกค้ารายเดียว — ใบทั้งหมด (ซื้อวันไหน จ่ายเท่าไร จ่ายวันไหน ค้างเท่าไร)
// key = contact_id (ตรง ๆ) หรือ "n:<ชื่อ>" (ลูกค้าไม่มีรหัส)
export async function getCustomerDetail(orgId: string, key: string): Promise<CustomerDetail | null> {
  const today = startOfDayUTC(new Date());
  const where = key.startsWith("n:")
    ? { orgId, contactId: null, customerName: key.slice(2) }
    : { orgId, contactId: key };
  const rows = await prisma.salesInvoice.findMany({ where, orderBy: { issueDate: "desc" } });
  if (rows.length === 0) return null;
  const invoices = rows.map((r) => mapRow(r, today));
  const sum = invoices.reduce(
    (a, r) => { a.sales += r.grandTotal; a.paid += r.paidAmount; a.out += r.outstanding; if (r.isOverdue) a.overdue += r.outstanding; return a; },
    { sales: 0, paid: 0, out: 0, overdue: 0 },
  );
  const first = rows[0];
  return {
    name: first.customerName, org: first.customerOrg, taxId: first.customerTaxId, contactId: first.contactId,
    totalSales: round(sum.sales), paid: round(sum.paid), outstanding: round(sum.out), overdue: round(sum.overdue),
    invoiceCount: invoices.length, invoices,
  };
}
