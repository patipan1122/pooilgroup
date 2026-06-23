import "server-only";
import { prisma } from "@/lib/prisma";

// FuelOS · ยอดขาย/ลูกหนี้ — query layer (อ่านจาก snapshot ใน DB ที่ดึงมาจาก TRCloud บริษัท 44)
// ทุกอย่าง serializable (Decimal → number, Date → ISO) เพราะส่งเข้า client component

export type PaymentState = "PAID" | "PARTIAL" | "UNPAID";

export interface InvoiceRow {
  id: string;
  docNo: string;
  companyFormat: string | null;
  contactId: string | null;
  customerName: string;
  customerOrg: string | null;
  issueDate: string;       // ISO date
  dueDate: string | null;
  grandTotal: number;
  paidAmount: number;
  outstanding: number;
  paymentState: PaymentState;
  trcloudStatus: string | null;
  salesman: string | null;
  quantity: number;
  isOverdue: boolean;      // ค้าง + เลยกำหนด
  overdueDays: number;     // เลยกำหนดกี่วัน (0 ถ้าไม่เกิน)
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
  overdue: number;         // ค้าง+เลยกำหนด
  invoiceCount: number;
  lastIssueDate: string;
}

export interface SalesOverview {
  totalSales: number;
  totalPaid: number;
  totalOutstanding: number;
  totalOverdue: number;
  invoiceCount: number;
  customerCount: number;
  unpaidCount: number;
  partialCount: number;
}

export interface SalesData {
  overview: SalesOverview;
  byCustomer: CustomerAgg[];
  invoices: InvoiceRow[];
  lastSyncedAt: string | null;
}

function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function daysBetween(a: Date, b: Date): number {
  return Math.floor((startOfDayUTC(a).getTime() - startOfDayUTC(b).getTime()) / 86_400_000);
}

// โหลดยอดขายช่วงวันที่ครั้งเดียว → สรุป overview + รายลูกค้า + รายใบ (filter ต่อใน JS)
export async function getSalesData(
  orgId: string,
  opts: { from: Date; to: Date; state?: PaymentState | "OVERDUE" | "ALL"; q?: string },
): Promise<SalesData> {
  const today = startOfDayUTC(new Date());
  const rows = await prisma.salesInvoice.findMany({
    where: { orgId, issueDate: { gte: opts.from, lte: opts.to } },
    orderBy: { issueDate: "desc" },
  });

  const lastSync = await prisma.salesInvoice.aggregate({ where: { orgId }, _max: { syncedAt: true } });

  // map → InvoiceRow (+ overdue)
  const mapped: InvoiceRow[] = rows.map((r) => {
    const outstanding = Number(r.outstanding);
    const due = r.dueDate ? new Date(r.dueDate) : null;
    const overdueDays = due && outstanding > 0.01 ? Math.max(daysBetween(today, due), 0) : 0;
    return {
      id: r.id,
      docNo: r.docNo,
      companyFormat: r.companyFormat,
      contactId: r.contactId,
      customerName: r.customerName,
      customerOrg: r.customerOrg,
      issueDate: r.issueDate.toISOString().slice(0, 10),
      dueDate: r.dueDate ? r.dueDate.toISOString().slice(0, 10) : null,
      grandTotal: Number(r.grandTotal),
      paidAmount: Number(r.paidAmount),
      outstanding,
      paymentState: r.paymentState as PaymentState,
      trcloudStatus: r.trcloudStatus,
      salesman: r.salesman,
      quantity: Number(r.quantity),
      isOverdue: overdueDays > 0,
      overdueDays,
    };
  });

  // overview (ทั้งช่วง · ไม่สนใจ filter state/q)
  const overview: SalesOverview = {
    totalSales: 0, totalPaid: 0, totalOutstanding: 0, totalOverdue: 0,
    invoiceCount: mapped.length, customerCount: 0, unpaidCount: 0, partialCount: 0,
  };
  const custMap = new Map<string, CustomerAgg>();
  for (const r of mapped) {
    overview.totalSales += r.grandTotal;
    overview.totalPaid += r.paidAmount;
    overview.totalOutstanding += r.outstanding;
    if (r.isOverdue) overview.totalOverdue += r.outstanding;
    if (r.paymentState === "UNPAID") overview.unpaidCount++;
    if (r.paymentState === "PARTIAL") overview.partialCount++;

    const key = r.contactId ? `c:${r.contactId}` : `n:${r.customerName}`;
    let c = custMap.get(key);
    if (!c) {
      c = {
        key, contactId: r.contactId, name: r.customerName, org: r.customerOrg, taxId: null,
        totalSales: 0, paid: 0, outstanding: 0, overdue: 0, invoiceCount: 0, lastIssueDate: r.issueDate,
      };
      custMap.set(key, c);
    }
    c.totalSales += r.grandTotal;
    c.paid += r.paidAmount;
    c.outstanding += r.outstanding;
    if (r.isOverdue) c.overdue += r.outstanding;
    c.invoiceCount++;
    if (r.issueDate > c.lastIssueDate) c.lastIssueDate = r.issueDate;
  }
  overview.customerCount = custMap.size;
  const round = (n: number) => Math.round(n * 100) / 100;
  overview.totalSales = round(overview.totalSales);
  overview.totalPaid = round(overview.totalPaid);
  overview.totalOutstanding = round(overview.totalOutstanding);
  overview.totalOverdue = round(overview.totalOverdue);

  const byCustomer = [...custMap.values()]
    .map((c) => ({ ...c, totalSales: round(c.totalSales), paid: round(c.paid), outstanding: round(c.outstanding), overdue: round(c.overdue) }))
    .sort((a, b) => b.outstanding - a.outstanding || b.totalSales - a.totalSales);

  // invoice list (apply filter)
  const q = (opts.q ?? "").trim().toLowerCase();
  const state = opts.state ?? "ALL";
  const invoices = mapped.filter((r) => {
    if (state === "OVERDUE" && !r.isOverdue) return false;
    if ((state === "PAID" || state === "PARTIAL" || state === "UNPAID") && r.paymentState !== state) return false;
    if (q && !(`${r.docNo} ${r.customerName} ${r.customerOrg ?? ""} ${r.salesman ?? ""}`.toLowerCase().includes(q))) return false;
    return true;
  });

  return { overview, byCustomer, invoices, lastSyncedAt: lastSync._max.syncedAt ? lastSync._max.syncedAt.toISOString() : null };
}
