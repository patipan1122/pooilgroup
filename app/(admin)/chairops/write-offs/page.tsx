// Write-offs queue — pending + history. Approve/reject buttons enforced by canWriteOff.
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { OfficeShell } from "@/app/(admin)/chairops/dashboard-office/layout";
import { Badge } from "@/components/chairops/ui/badge";
import { Button } from "@/components/chairops/ui/button";
import { baht, thaiDateTime, thaiRelative } from "@/lib/chairops/utils/format";
import { canWriteOff } from "@/lib/chairops/auth/role-guards";
import { approveWriteOff, rejectWriteOff } from "../reconcile/actions";

export default async function WriteOffsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; approved?: string; rejected?: string; requested?: string; tab?: string }>;
}) {
  const session = await requireRole("OFFICE");
  const sp = await searchParams;
  const tab = (sp.tab ?? "pending") as "pending" | "history";

  const rows = await prisma.chairopsWriteOff.findMany({
    where: tab === "pending" ? { status: "PENDING" } : { status: { in: ["APPROVED", "REJECTED"] } },
    orderBy: tab === "pending" ? { makerAt: "asc" } : { approverAt: "desc" },
    take: 100,
    include: {
      maker: { select: { id: true, displayName: true, role: true } },
      approver: { select: { id: true, displayName: true, role: true } },
    },
  });

  const branchIds = [...new Set(rows.map((r) => r.branchId))];
  const branches = branchIds.length
    ? await prisma.chairopsBranch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } })
    : [];
  const branchMap = new Map(branches.map((b) => [b.id, b.name]));

  return (
    <OfficeShell session={session} active="/chairops/write-offs">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">ตัดเงินขาด (Write-offs)</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            &lt;500฿ ใช้ MANAGER · ≥500฿ ต้อง CEO · ผู้ขอกับผู้อนุมัติต้องเป็นคนละคน
          </p>
        </div>
        <div className="flex gap-1 text-sm">
          {(["pending", "history"] as const).map((k) => (
            <Link
              key={k}
              href={`/chairops/write-offs?tab=${k}`}
              className={
                "rounded-md px-3 py-1.5 font-medium transition-colors " +
                (tab === k
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted")
              }
            >
              {k === "pending" ? "รออนุมัติ" : "ประวัติ"}
            </Link>
          ))}
        </div>
      </div>

      {/* flash messages */}
      {sp.error && (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-4 py-2 text-sm">{decodeURIComponent(sp.error)}</div>
      )}
      {sp.approved && (
        <div className="mb-3 rounded-md border border-success/30 bg-success/10 px-4 py-2 text-sm">อนุมัติเรียบร้อย</div>
      )}
      {sp.rejected && (
        <div className="mb-3 rounded-md border border-warning/30 bg-warning/10 px-4 py-2 text-sm">ปฏิเสธเรียบร้อย</div>
      )}
      {sp.requested && (
        <div className="mb-3 rounded-md border border-success/30 bg-success/10 px-4 py-2 text-sm">ส่งคำขอเรียบร้อย</div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-background">
        <table className="min-w-[1000px] w-full text-sm">
          <thead className="sticky top-14 z-20 bg-muted text-xs uppercase text-muted-foreground">
            <tr className="text-left">
              <th className="px-2 py-2">เวลาขอ</th>
              <th className="px-2 py-2">สาขา</th>
              <th className="px-2 py-2 text-right">จำนวน</th>
              <th className="px-2 py-2">ผู้ขอ</th>
              <th className="px-2 py-2">เหตุผล</th>
              <th className="px-2 py-2">สถานะ</th>
              <th className="px-2 py-2">ผู้อนุมัติ / หมายเหตุ</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                  {tab === "pending" ? "ไม่มีรายการรออนุมัติ" : "ยังไม่มีประวัติ"}
                </td>
              </tr>
            )}
            {rows.map((w) => {
              const canApprove = canWriteOff(session.user, w.amount) && w.makerId !== session.user.id;
              const requiredRole = w.amount >= 500 ? "CEO" : "MANAGER";
              return (
                <tr key={w.id} className="hover:bg-muted/40">
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-muted-foreground">
                    <div>{thaiDateTime(w.makerAt)}</div>
                    <div>{thaiRelative(w.makerAt)}</div>
                  </td>
                  <td className="px-2 py-2 font-medium">
                    <Link href={`/chairops/reconcile/${w.branchId}`} className="hover:underline">
                      {branchMap.get(w.branchId) ?? w.branchId.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums font-bold">
                    {baht(w.amount)}
                    <div className="text-[10px] font-normal text-muted-foreground">ต้อง {requiredRole}</div>
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {w.maker.displayName}
                    <div className="text-muted-foreground">{w.maker.role}</div>
                  </td>
                  <td className="px-2 py-2 max-w-[260px] text-xs text-muted-foreground">{w.reason}</td>
                  <td className="px-2 py-2">
                    <Badge
                      variant={
                        w.status === "APPROVED" ? "success" : w.status === "REJECTED" ? "danger" : "warning"
                      }
                    >
                      {w.status}
                    </Badge>
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {w.approver ? (
                      <>
                        <div>{w.approver.displayName}</div>
                        <div className="text-muted-foreground">
                          {w.approver.role} · {w.approverAt ? thaiRelative(w.approverAt) : ""}
                        </div>
                        {w.notes && <div className="mt-0.5 italic">"{w.notes}"</div>}
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {w.status === "PENDING" && (
                      <div className="flex flex-col gap-1.5">
                        <form action={approveWriteOff}>
                          <input type="hidden" name="writeOffId" value={w.id} />
                          <Button
                            type="submit"
                            size="sm"
                            variant="success"
                            disabled={!canApprove}
                            title={
                              !canApprove
                                ? w.makerId === session.user.id
                                  ? "ห้ามอนุมัติของตัวเอง"
                                  : `ต้อง ${requiredRole} ขึ้นไป`
                                : undefined
                            }
                            className="w-full"
                          >
                            ✓ อนุมัติ
                          </Button>
                        </form>
                        <form action={rejectWriteOff} className="flex flex-col gap-1">
                          <input type="hidden" name="writeOffId" value={w.id} />
                          <input
                            name="reason"
                            required
                            placeholder="เหตุผลปฏิเสธ..."
                            className="h-8 rounded border border-border bg-background px-2 text-xs"
                          />
                          <Button
                            type="submit"
                            size="sm"
                            variant="outline"
                            disabled={!canApprove}
                            className="w-full"
                          >
                            ✕ ปฏิเสธ
                          </Button>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </OfficeShell>
  );
}
