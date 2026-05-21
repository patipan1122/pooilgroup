// Reports hub · monthly P&L · daily CSV export · cleanliness audit summary
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/chairops/ui/card";
import { Button } from "@/components/chairops/ui/button";

export const dynamic = "force-dynamic";

function todayIso() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function firstOfMonthIso() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

export default async function ReportsHub() {
  const [cleanlinessAgg, cleanlinessFails, branches] = await Promise.all([
    prisma.chairopsCleanlinessReport.groupBy({
      by: ["grade"],
      _count: { _all: true },
      where: { reportedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
    }),
    prisma.chairopsCleanlinessReport.findMany({
      where: {
        grade: "FAIL",
        reportedAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
      },
      orderBy: { reportedAt: "desc" },
      take: 5,
      include: { branch: { select: { name: true, slug: true } } },
    }),
    prisma.chairopsBranch.count({ where: { isActive: true } }),
  ]);

  const passCount = cleanlinessAgg.find((g) => g.grade === "PASS")?._count._all ?? 0;
  const warnCount = cleanlinessAgg.find((g) => g.grade === "WARN")?._count._all ?? 0;
  const failCount = cleanlinessAgg.find((g) => g.grade === "FAIL")?._count._all ?? 0;
  const totalReports = passCount + warnCount + failCount;
  const passRate = totalReports > 0 ? Math.round((passCount / totalReports) * 100) : 0;

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">รายงาน</h1>
        <p className="text-sm text-muted-foreground">
          สรุปข้ามสาขา · export ข้อมูลออก CSV ({branches} สาขาทำการ)
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Monthly P&L card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">รายงานรายเดือน</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              เปรียบเทียบ POS · ฝาก · drift · write-offs ต่อสาขาต่อเดือน
            </p>
            <Link href="/chairops/reports/monthly">
              <Button variant="default" size="sm" className="w-full">
                เปิดรายงานรายเดือน →
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* CSV export card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Export CSV</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              ดาวน์โหลด POS รายวัน หรือ สรุปรายเดือน เป็นไฟล์ .csv
            </p>
            <form
              action="/chairops/reports/export"
              method="get"
              className="flex flex-col gap-2"
            >
              <div className="flex gap-2">
                <label className="flex-1">
                  <span className="text-xs text-muted-foreground">ตั้งแต่</span>
                  <input
                    type="date"
                    name="from"
                    defaultValue={firstOfMonthIso()}
                    className="mt-1 h-10 w-full rounded-md border border-border bg-background px-2 text-sm"
                  />
                </label>
                <label className="flex-1">
                  <span className="text-xs text-muted-foreground">ถึง</span>
                  <input
                    type="date"
                    name="to"
                    defaultValue={todayIso()}
                    className="mt-1 h-10 w-full rounded-md border border-border bg-background px-2 text-sm"
                  />
                </label>
              </div>
              <label>
                <span className="text-xs text-muted-foreground">ประเภท</span>
                <select
                  name="type"
                  defaultValue="daily"
                  className="mt-1 h-10 w-full rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="daily">POS รายวัน</option>
                  <option value="monthly">สรุปรายเดือนต่อสาขา</option>
                </select>
              </label>
              <Button type="submit" variant="default" size="sm">
                ดาวน์โหลด CSV
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Cleanliness audit card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ความสะอาด · 30 วัน</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md bg-success/10 p-2">
                <div className="text-xl font-bold text-[hsl(142,76%,28%)]">{passCount}</div>
                <div className="text-xs text-muted-foreground">PASS</div>
              </div>
              <div className="rounded-md bg-warning/10 p-2">
                <div className="text-xl font-bold text-[hsl(38,92%,32%)]">{warnCount}</div>
                <div className="text-xs text-muted-foreground">WARN</div>
              </div>
              <div className="rounded-md bg-danger/10 p-2">
                <div className="text-xl font-bold text-[hsl(0,84%,40%)]">{failCount}</div>
                <div className="text-xs text-muted-foreground">FAIL</div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">อัตราผ่าน {passRate}%</p>
            {cleanlinessFails.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-semibold text-muted-foreground">FAIL ล่าสุด:</p>
                <ul className="space-y-1">
                  {cleanlinessFails.map((c) => (
                    <li key={c.id} className="truncate text-xs">
                      <Link
                        href={`/chairops/dashboard/${c.branch.slug}`}
                        className="text-primary hover:underline"
                      >
                        {c.branch.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
