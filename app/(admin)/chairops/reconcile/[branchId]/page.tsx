// Per-branch drill — interleaved timeline of POS daily + cash collections
// + audit history + write-off request form.
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { OfficeShell } from "@/app/(admin)/chairops/dashboard-office/layout";
import { Badge } from "@/components/chairops/ui/badge";
import { Button } from "@/components/chairops/ui/button";
import { Input } from "@/components/chairops/ui/input";
import { baht, thaiDate, thaiDateTime, thaiRelative } from "@/lib/chairops/utils/format";
import { recomputeDriftForBranch } from "@/lib/chairops/reconcile/drift-engine";
import { disputeCollection, requestWriteOff } from "../actions";

export default async function BranchReconcilePage({
  params,
  searchParams,
}: {
  params: Promise<{ branchId: string }>;
  searchParams: Promise<{ error?: string; disputed?: string }>;
}) {
  const session = await requireRole("OFFICE");
  const { branchId } = await params;
  const sp = await searchParams;

  const branch = await prisma.chairopsBranch.findUnique({ where: { id: branchId } });
  if (!branch) notFound();

  // Recompute on-demand to ensure freshness when an office user opens the page
  const drift = await recomputeDriftForBranch(branchId);

  const [posRows, collections, openAlerts, writeOffs, auditLogs] = await Promise.all([
    prisma.chairopsPosDaily.findMany({
      where: { branchId },
      orderBy: { bizDate: "desc" },
      take: 60,
    }),
    prisma.chairopsCashCollection.findMany({
      where: { branchId },
      orderBy: { collectedAt: "desc" },
      take: 60,
      include: { maid: { select: { id: true, displayName: true } } },
    }),
    prisma.chairopsAlert.findMany({
      where: { branchId, status: { in: ["OPEN", "ACK"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.chairopsWriteOff.findMany({
      where: { branchId },
      orderBy: { makerAt: "desc" },
      take: 10,
      include: {
        maker: { select: { displayName: true } },
        approver: { select: { displayName: true } },
      },
    }),
    prisma.chairopsAuditLog.findMany({
      where: {
        entity: { in: ["PosDaily", "CashCollection", "WriteOff", "Alert", "PosImport"] },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { user: { select: { displayName: true, role: true } } },
    }),
  ]);

  // Build interleaved timeline (pos vs collection) per bizDate / collectedAt
  type Entry =
    | { kind: "pos"; ts: Date; data: (typeof posRows)[number] }
    | { kind: "collection"; ts: Date; data: (typeof collections)[number] };

  const timeline: Entry[] = [
    ...posRows.map((p) => ({ kind: "pos" as const, ts: p.bizDate, data: p })),
    ...collections.map((c) => ({ kind: "collection" as const, ts: c.collectedAt, data: c })),
  ].sort((a, b) => b.ts.getTime() - a.ts.getTime());

  return (
    <OfficeShell session={session} active="/chairops/reconcile">
      <div className="mb-4">
        <Link href="/chairops/reconcile" className="text-sm text-muted-foreground hover:underline">
          ← กลับตารางสาขา
        </Link>
      </div>

      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{branch.name}</h1>
          <p className="text-sm text-muted-foreground">
            {branch.mallGroup ?? "—"} {branch.floor ? `· ${branch.floor}` : ""} · {branch.region ?? ""} · slug {branch.slug}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {openAlerts.length > 0 && <Badge variant="danger">{openAlerts.length} alert open</Badge>}
          <Badge variant={drift.status === "ok" ? "success" : drift.status === "watch" ? "warning" : "danger"}>
            {drift.status}
          </Badge>
        </div>
      </header>

      {sp.error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-2 text-sm">
          {decodeURIComponent(sp.error)}
        </div>
      )}
      {sp.disputed && (
        <div className="mb-4 rounded-md border border-success/30 bg-success/10 px-4 py-2 text-sm">
          บันทึก dispute เรียบร้อย · log ไปที่ผู้ที่เกี่ยวข้องแล้ว
        </div>
      )}

      {/* drift summary */}
      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="POS รวม" value={baht(drift.posTotal)} />
        <Tile label="ฝากรวม" value={baht(drift.depositTotal)} />
        <Tile
          label="DRIFT"
          value={baht(drift.driftAmount, true)}
          tone={drift.driftAmount > 0 ? "danger" : drift.driftAmount < -100 ? "warning" : undefined}
        />
        <Tile label="อายุ DRIFT" value={drift.driftAmount > 0 ? `${drift.driftHours} ชม.` : "—"} />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Timeline (2/3 width) */}
        <section className="lg:col-span-2">
          <h2 className="mb-2 text-lg font-semibold">Timeline (POS + แม่บ้านเก็บเงิน)</h2>
          <div className="overflow-hidden rounded-lg border border-border bg-background">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs uppercase text-muted-foreground">
                <tr className="text-left">
                  <th className="px-2 py-2">เวลา</th>
                  <th className="px-2 py-2">ประเภท</th>
                  <th className="px-2 py-2 text-right">จำนวน</th>
                  <th className="px-2 py-2">รายละเอียด</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {timeline.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">
                      ยังไม่มีข้อมูลให้ตรวจ
                    </td>
                  </tr>
                )}
                {timeline.map((e, idx) => {
                  if (e.kind === "pos") {
                    return (
                      <tr key={`pos-${e.data.id}-${idx}`} className="bg-background hover:bg-muted/30">
                        <td className="whitespace-nowrap px-2 py-1.5 text-xs text-muted-foreground">
                          {thaiDate(e.data.bizDate)}
                        </td>
                        <td className="px-2 py-1.5">
                          <Badge variant="secondary">POS</Badge>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-semibold">
                          {baht(e.data.totalRevenue)}
                        </td>
                        <td className="px-2 py-1.5 text-xs text-muted-foreground">
                          {e.data.chairCode ? <span className="font-mono">{e.data.chairCode}</span> : "ยอดรวมสาขา"}{" "}
                          · ออน {baht(e.data.online)} · แบงค์ {baht(e.data.cash)} · เหรียญ {baht(e.data.coin)}
                        </td>
                        <td className="px-2 py-1.5" />
                      </tr>
                    );
                  } else {
                    const c = e.data;
                    const slipDiff = c.countedAmount - c.depositedAmount;
                    return (
                      <tr key={`col-${c.id}`} className="bg-success/5 hover:bg-success/10">
                        <td className="whitespace-nowrap px-2 py-1.5 text-xs text-muted-foreground">
                          <div>{thaiDateTime(c.collectedAt)}</div>
                          <div>{thaiRelative(c.collectedAt)}</div>
                        </td>
                        <td className="px-2 py-1.5">
                          <Badge variant="success">เก็บเงิน</Badge>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-semibold">
                          {baht(c.depositedAmount)}
                        </td>
                        <td className="px-2 py-1.5 text-xs text-muted-foreground">
                          แม่บ้าน <strong>{c.maid.displayName}</strong> · นับได้ {baht(c.countedAmount)}
                          {slipDiff !== 0 && (
                            <span className="ml-1 text-warning">
                              (ต่างจากที่ฝาก {baht(slipDiff, true)})
                            </span>
                          )}
                          {c.notes && <div className="mt-0.5 italic">📝 {c.notes.slice(0, 120)}</div>}
                        </td>
                        <td className="px-2 py-1.5">
                          <form action={disputeCollection} className="flex items-center gap-1">
                            <input type="hidden" name="collectionId" value={c.id} />
                            <input
                              name="reason"
                              placeholder="dispute reason..."
                              maxLength={500}
                              className="h-8 w-44 rounded border border-border bg-background px-2 text-xs"
                            />
                            <Button type="submit" size="sm" variant="outline">
                              dispute
                            </Button>
                          </form>
                        </td>
                      </tr>
                    );
                  }
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Right column: write-off form + alerts + audit */}
        <aside className="space-y-6">
          <div className="rounded-lg border border-border bg-background p-4">
            <h2 className="mb-2 text-base font-semibold">ขอตัดเงินขาด (write-off)</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              ใช้เมื่อ drift หาคืนไม่ได้ · &lt;500฿ ใช้ MANAGER อนุมัติ · ≥500฿ ต้องให้ CEO
            </p>
            <form action={requestWriteOff} className="space-y-2.5">
              <input type="hidden" name="branchId" value={branchId} />
              <label className="block text-xs font-medium text-foreground">จำนวนเงิน (บาท)</label>
              <Input
                type="number"
                name="amount"
                min={1}
                max={1_000_000}
                required
                placeholder={drift.driftAmount > 0 ? String(drift.driftAmount) : "0"}
              />
              <label className="block text-xs font-medium text-foreground">เหตุผล</label>
              <textarea
                name="reason"
                required
                rows={3}
                minLength={5}
                maxLength={500}
                placeholder="เช่น แม่บ้านลาออก · ยอดหายไป · POS รายงานผิด"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              <Button type="submit" size="default" className="w-full">
                ส่งคำขอ
              </Button>
            </form>
          </div>

          <div className="rounded-lg border border-border bg-background p-4">
            <h2 className="mb-2 text-base font-semibold">Alerts เปิดอยู่</h2>
            {openAlerts.length === 0 ? (
              <p className="text-xs text-muted-foreground">ไม่มี · ทุกอย่างเงียบ</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {openAlerts.map((a) => (
                  <li key={a.id} className="rounded border border-border p-2">
                    <div className="flex items-center justify-between">
                      <Badge variant={a.level === "CRITICAL" ? "danger" : "warning"}>{a.kind}</Badge>
                      <span className="text-muted-foreground">{thaiRelative(a.createdAt)}</span>
                    </div>
                    <div className="mt-1 font-medium">{a.title}</div>
                    <div className="text-muted-foreground">{a.message}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-border bg-background p-4">
            <h2 className="mb-2 text-base font-semibold">Write-offs ล่าสุด</h2>
            {writeOffs.length === 0 ? (
              <p className="text-xs text-muted-foreground">ยังไม่เคยขอ</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {writeOffs.map((w) => (
                  <li key={w.id} className="rounded border border-border p-2">
                    <div className="flex items-center justify-between">
                      <Badge
                        variant={
                          w.status === "APPROVED" ? "success" : w.status === "REJECTED" ? "danger" : "warning"
                        }
                      >
                        {w.status}
                      </Badge>
                      <span className="tabular-nums font-semibold">{baht(w.amount)}</span>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      ขอโดย {w.maker.displayName} · {thaiRelative(w.makerAt)}
                      {w.approver && ` · อนุมัติโดย ${w.approver.displayName}`}
                    </div>
                    <div className="mt-0.5">{w.reason}</div>
                    {w.notes && <div className="mt-0.5 italic text-muted-foreground">"{w.notes}"</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-border bg-background p-4">
            <h2 className="mb-2 text-base font-semibold">Audit ล่าสุด</h2>
            {auditLogs.length === 0 ? (
              <p className="text-xs text-muted-foreground">ไม่มี</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {auditLogs.slice(0, 12).map((l) => (
                  <li key={l.id} className="border-b border-border pb-1.5 last:border-0">
                    <span className="font-mono text-muted-foreground">{thaiRelative(l.createdAt)}</span>{" "}
                    <span className="font-medium">{l.action}</span>{" "}
                    <span className="text-muted-foreground">
                      โดย {l.user?.displayName ?? "?"} ({l.user?.role ?? "?"})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </OfficeShell>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "danger" | "warning" }) {
  const toneClass =
    tone === "danger" ? "text-[hsl(0,84%,48%)]" : tone === "warning" ? "text-[hsl(38,92%,38%)]" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-xl font-bold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}
