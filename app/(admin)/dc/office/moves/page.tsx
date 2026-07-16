// DC · หลังบ้าน · รายการใบย้ายที่ (Move list)
//   • เลขที่ · คลัง · หมายเหตุ · เมื่อ  (ย้ายที่ = เปลี่ยนตำแหน่งจัดเก็บ · ไม่กระทบจำนวน)
//   • ปุ่มลบต่อแถว = super_admin เท่านั้น (ลบใบ · ไม่คืนสต๊อกเพราะไม่กระทบจำนวน + เก็บ snapshot)
import { ArrowLeftRight } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { requireDcManager } from "@/lib/dc/role-guard";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { DcDeleteButton } from "@/app/(admin)/dc/_components/dc-delete-button";
import { getDcOfficeChrome, dcShellChrome } from "@/lib/dc/office-chrome";
import { DcOfficeShell } from "@/components/dc/office-shell";
import { DcDocsSubnav } from "@/components/dc/docs-subnav";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

function fmtDateTime(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

export default async function DcMovesPage() {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;
  const canDelete = isSuperAdmin(ctx.session.user.role); // ลบใบย้ายที่ = super_admin เท่านั้น

  const moves = await prisma.dcMove.findMany({
    where: { orgId },
    orderBy: { movedAt: "desc" },
    take: 200,
  });

  // ชื่อคลัง (ใบย้ายเก็บแค่ warehouseId)
  const whIds = [...new Set(moves.map((m) => m.warehouseId))];
  const whs = whIds.length
    ? await prisma.dcWarehouse.findMany({ where: { id: { in: whIds }, orgId }, select: { id: true, name: true } })
    : [];
  const whName = new Map(whs.map((w) => [w.id, w.name]));

  const chrome = await getDcOfficeChrome(orgId);

  return (
    <DcOfficeShell {...dcShellChrome(ctx, chrome)}>
      <div className="dc-page dc-page--wide" style={{ padding: 0, maxWidth: "none", margin: 0 }}>
        <DcDocsSubnav active="moves" />
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: "-.01em" }}>รายการใบย้ายที่</h1>
          <p style={{ margin: "5px 0 0", color: "var(--ink2)", fontSize: 14 }}>
            ประวัติการย้ายตำแหน่งจัดเก็บในคลัง (ไม่กระทบจำนวนสินค้า) — ย้ายใหม่ที่หน้า “ย้ายที่”
          </p>
        </div>

        {moves.length === 0 ? (
          <EmptyState
            icon={<ArrowLeftRight size={26} />}
            title="ยังไม่มีใบย้ายที่"
            description="ย้ายของระหว่างชั้นวางที่หน้า “ย้ายที่” — เมื่อย้ายแล้วจะมาปรากฏที่นี่"
          />
        ) : (
          <div className="dc-card" style={{ padding: 0, overflowX: "auto", overflowY: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#71717a", background: "#fafafa" }}>
                  <th style={cellHead}>เลขที่</th>
                  <th style={cellHead}>คลัง</th>
                  <th style={cellHead}>หมายเหตุ</th>
                  <th style={cellHead}>เมื่อ</th>
                  {canDelete && <th style={{ ...cellHead, textAlign: "right" }}>ลบ</th>}
                </tr>
              </thead>
              <tbody>
                {moves.map((m) => (
                  <tr key={m.id} style={{ borderTop: "1px solid var(--dc-line, #f0f0f2)" }}>
                    <td style={{ ...cell, fontWeight: 700, color: "#18181b", fontVariantNumeric: "tabular-nums" }}>{m.moveCode}</td>
                    <td style={{ ...cell, color: "#52525b" }}>{whName.get(m.warehouseId) ?? "—"}</td>
                    <td style={{ ...cell, color: "#52525b" }}>{m.note ?? "—"}</td>
                    <td style={{ ...cell, color: "#52525b", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {fmtDateTime(m.movedAt)}
                    </td>
                    {canDelete && (
                      <td style={{ ...cell, textAlign: "right" }}>
                        <DcDeleteButton docType="move" docId={m.id} docCode={m.moveCode} size="sm" />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DcOfficeShell>
  );
}

const cellHead: React.CSSProperties = {
  padding: "10px 14px",
  fontSize: 12,
  fontWeight: 700,
  whiteSpace: "nowrap",
};
const cell: React.CSSProperties = {
  padding: "12px 14px",
  verticalAlign: "middle",
};
