// Cross-branch monthly matrix · per branch per month
// POS · deposit · drift · write-offs
import { Fragment } from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { baht } from "@/lib/chairops/utils/format";
import { cn } from "@/lib/utils/cn";

export const dynamic = "force-dynamic";

const MONTHS_BACK = 6;

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const yShort = String(Number(y) + 543).slice(-2); // BE short year
  return `${months[Number(m) - 1]} ${yShort}`;
}

export default async function MonthlyReport() {
  const since = new Date();
  since.setMonth(since.getMonth() - MONTHS_BACK + 1);
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const [branches, posDaily, collections, writeOffs] = await Promise.all([
    prisma.chairopsBranch.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true, mallGroup: true },
    }),
    prisma.chairopsPosDaily.findMany({
      where: { bizDate: { gte: since } },
      select: { branchId: true, bizDate: true, grossTotal: true },
    }),
    // Wave-2 audit P0 #6: deposits moved to chairops_cash_deposit · include
     // the new row so a collection's "ฝาก" reflects what landed at bank.
     // Fall back to legacy depositedAmount column for pre-W2 rows where the
     // separate deposit table wasn't yet wired.
    prisma.chairopsCashCollection.findMany({
      where: { collectedAt: { gte: since } },
      select: {
        branchId: true,
        collectedAt: true,
        depositedAmount: true,
        deposit: { select: { depositedAmount: true, bankFee: true } },
      },
    }),
    prisma.chairopsWriteOff.findMany({
      where: { makerAt: { gte: since }, status: "APPROVED" },
      select: { branchId: true, makerAt: true, amount: true },
    }),
  ]);

  // Build month keys (recent → oldest)
  const monthKeys: string[] = [];
  for (let i = MONTHS_BACK - 1; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    monthKeys.push(monthKey(d));
  }

  // Aggregate {branchId → {monthKey → {pos, dep, wo}}}
  type Cell = { pos: number; dep: number; wo: number };
  const matrix = new Map<string, Map<string, Cell>>();
  const ensure = (bid: string, mk: string): Cell => {
    if (!matrix.has(bid)) matrix.set(bid, new Map());
    const inner = matrix.get(bid)!;
    if (!inner.has(mk)) inner.set(mk, { pos: 0, dep: 0, wo: 0 });
    return inner.get(mk)!;
  };
  // grossTotal is Decimal — coerce to number for summation
  for (const p of posDaily) ensure(p.branchId, monthKey(p.bizDate)).pos += Number(p.grossTotal);
  for (const c of collections) {
    const dep = c.deposit
      ? Number(c.deposit.depositedAmount) + Number(c.deposit.bankFee)
      : Number(c.depositedAmount);
    ensure(c.branchId, monthKey(c.collectedAt)).dep += dep;
  }
  for (const w of writeOffs) ensure(w.branchId, monthKey(w.makerAt)).wo += w.amount;

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/chairops/reports"
          className="text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          ← กลับรายงาน
        </Link>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">รายงานรายเดือน</h1>
        <p className="text-sm text-muted-foreground">
          {MONTHS_BACK} เดือนล่าสุด · POS / ฝาก / drift / write-off ต่อสาขา
        </p>
      </div>

      <div className="rounded-xl border border-border bg-background shadow-sm">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full min-w-[900px] border-collapse text-xs sm:text-sm">
            <thead className="sticky top-0 z-20 bg-background">
              <tr className="border-b border-border bg-muted/60">
                <th className="sticky left-0 z-10 min-w-[160px] bg-muted/80 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  สาขา
                </th>
                {monthKeys.map((mk) => (
                  <th
                    key={mk}
                    colSpan={3}
                    className="bg-muted/60 px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {monthLabel(mk)}
                  </th>
                ))}
              </tr>
              <tr className="border-b border-border bg-muted/60 text-muted-foreground">
                <th className="sticky left-0 z-10 bg-muted/80 px-3 py-1 text-left text-[10px] font-medium uppercase">
                  &nbsp;
                </th>
                {monthKeys.map((mk) => (
                  <Fragment key={mk}>
                    <th className="bg-muted/60 px-2 py-1 text-right text-[10px] font-medium">
                      POS
                    </th>
                    <th className="bg-muted/60 px-2 py-1 text-right text-[10px] font-medium">
                      ฝาก
                    </th>
                    <th className="bg-muted/60 px-2 py-1 text-right text-[10px] font-medium">
                      ส่วนต่าง
                    </th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => {
                const branchMatrix = matrix.get(b.id);
                return (
                  <tr key={b.id} className="border-b border-border bg-background hover:bg-muted/30">
                    <td className="sticky left-0 z-10 bg-background px-3 py-2">
                      <Link
                        href={`/chairops/dashboard/${b.slug}`}
                        className="block font-medium hover:underline"
                      >
                        {b.name}
                      </Link>
                      <span className="text-[10px] text-muted-foreground">
                        {b.mallGroup ?? "—"}
                      </span>
                    </td>
                    {monthKeys.map((mk) => {
                      const cell = branchMatrix?.get(mk) ?? { pos: 0, dep: 0, wo: 0 };
                      const drift = cell.pos - cell.dep - cell.wo;
                      return (
                        <Fragment key={`${b.id}-${mk}`}>
                          <td className="whitespace-nowrap bg-background px-2 py-2 text-right tabular-nums">
                            {cell.pos ? baht(cell.pos) : "—"}
                          </td>
                          <td className="whitespace-nowrap bg-background px-2 py-2 text-right tabular-nums">
                            {cell.dep ? baht(cell.dep) : "—"}
                          </td>
                          <td
                            className={cn(
                              "whitespace-nowrap bg-background px-2 py-2 text-right tabular-nums",
                              drift > 0
                                ? "text-[hsl(0,84%,40%)] font-semibold"
                                : drift < -100
                                ? "text-[hsl(38,92%,32%)] font-semibold"
                                : "text-muted-foreground"
                            )}
                          >
                            {cell.pos || cell.dep ? baht(drift, true) : "—"}
                          </td>
                        </Fragment>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        ส่วนต่าง = POS − ฝาก − write-off (อนุมัติแล้ว) · บวก = ค้างเก็บหรือขาด · ลบ = ฝากเกิน (เช่น tip)
      </p>
    </div>
  );
}
