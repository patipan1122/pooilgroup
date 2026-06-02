// Office-side "เบิกของจากแม่บ้าน" queue · Server Component.
//
// Source: ChairopsSparePartMovement rows with delta=0 and reason startsWith
// MAID_PART_REQUEST_PREFIX (see lib/chairops/parts/actions.ts ::
// requestPartFromMaid). The maid creates a movement with delta=0 so it does
// NOT change stock — it's purely a request log. The office sees the queue here
// and (later) fulfils via the existing adjustStock action on each part.
//
// CEO 2026-06-02 approved: "Maid เบิกของ → wire to office queue".
// Smallest viable: read-only list with maid name, part, qty, branch, when,
// reason. Each row deep-links to the part's detail pane where adjustStock
// is already wired up. No DB schema change.
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { thaiDateTime } from "@/lib/chairops/utils/format";
import { MAID_PART_REQUEST_PREFIX } from "@/lib/chairops/parts/constants";

/** Parses "<prefix> · qty=<n> · <free-text reason>" written by requestPartFromMaid. */
function parseRequestReason(raw: string): { qty: number | null; note: string } {
  // Reason format (kept in sync with lib/chairops/parts/actions.ts):
  //   "maid-request:PENDING · qty=2 · เก้าอี้พังขาหัก"
  const body = raw.startsWith(MAID_PART_REQUEST_PREFIX)
    ? raw.slice(MAID_PART_REQUEST_PREFIX.length).replace(/^\s*·\s*/, "")
    : raw;
  const m = body.match(/^qty=(\d+)\s*·\s*(.*)$/);
  if (!m) return { qty: null, note: body };
  return { qty: Number(m[1]), note: m[2] ?? "" };
}

export async function PartsRequestsPane({ orgId }: { orgId: string }) {
  // Pull last 100 maid requests across the org. Office can scope by branch in a
  // future iteration (search-param `?branch=`) — keeping scope tight today.
  const movements = await prisma.chairopsSparePartMovement.findMany({
    where: {
      orgId,
      delta: 0,
      reason: { startsWith: MAID_PART_REQUEST_PREFIX },
    },
    orderBy: { at: "desc" },
    take: 100,
  });

  const partIds = Array.from(new Set(movements.map((m) => m.partId)));
  const userIds = Array.from(new Set(movements.map((m) => m.byUserId)));
  const branchIds = Array.from(
    new Set(movements.map((m) => m.branchId).filter((b): b is string => !!b)),
  );

  const [parts, users, branches] = await Promise.all([
    prisma.chairopsSparePart.findMany({
      where: { id: { in: partIds }, orgId },
      select: { id: true, partCode: true, name: true, unit: true, stockOnHand: true },
    }),
    prisma.chairopsUser.findMany({
      where: { id: { in: userIds }, orgId },
      select: { id: true, displayName: true },
    }),
    prisma.chairopsBranch.findMany({
      where: { id: { in: branchIds }, orgId },
      select: { id: true, name: true },
    }),
  ]);
  const partById = new Map(parts.map((p) => [p.id, p]));
  const userById = new Map(users.map((u) => [u.id, u.displayName]));
  const branchById = new Map(branches.map((b) => [b.id, b.name]));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold tracking-tight">
          คำขอเบิกจากแม่บ้าน
        </h2>
        <p className="text-sm text-muted-foreground">
          {movements.length} รายการล่าสุด · กดแถวเพื่อปรับสต็อกจริง
        </p>
      </div>

      {movements.length === 0 ? (
        <Card>
          <CardBody className="p-8 text-center text-sm text-muted-foreground">
            ยังไม่มีคำขอเบิกของจากแม่บ้าน
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/40">
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">เมื่อ</th>
                    <th className="px-3 py-2 font-medium">สาขา</th>
                    <th className="px-3 py-2 font-medium">แม่บ้าน</th>
                    <th className="px-3 py-2 font-medium">อะไหล่</th>
                    <th className="px-3 py-2 text-right font-medium">จำนวนขอ</th>
                    <th className="px-3 py-2 text-right font-medium">คงเหลือ</th>
                    <th className="px-3 py-2 font-medium">เหตุผล</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => {
                    const p = partById.get(m.partId);
                    const parsed = parseRequestReason(m.reason);
                    const stock = p?.stockOnHand ?? 0;
                    const stockShort =
                      parsed.qty != null && parsed.qty > stock;
                    return (
                      <tr key={m.id} className="border-t border-border">
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {thaiDateTime(m.at)}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {m.branchId
                            ? branchById.get(m.branchId) ?? "—"
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {userById.get(m.byUserId) ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          {p ? (
                            <Link
                              href={`/chairops/parts?selected=${p.id}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {p.name}
                              <span className="ml-1 font-mono text-xs text-muted-foreground">
                                · {p.partCode}
                              </span>
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className="font-mono font-semibold">
                            {parsed.qty ?? "—"}
                          </span>
                          {p && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              {p.unit}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className="font-mono text-xs">
                            {stock.toLocaleString("en-US")}
                          </span>
                          {stockShort && (
                            <Badge tone="danger" className="ml-2 text-[10px]">
                              ไม่พอ
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground max-w-[20rem]">
                          <span className="line-clamp-1">{parsed.note}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        หมายเหตุ: คำขอนี้ไม่ลดสต็อกอัตโนมัติ · ออฟฟิศต้องกดเข้าอะไหล่ที่ขอ
        แล้วใช้ &quot;ปรับสต็อก&quot; เพื่อหักจริงเมื่อจ่ายของให้แม่บ้าน
      </p>
    </div>
  );
}
