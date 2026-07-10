// DC · หลังบ้าน · รายการใบเบิก (Issue list)
//   • เลขที่ · คลัง · จำนวนรายการ (นับจาก movement refType=dc_issue) · หมายเหตุ · เมื่อ
//   • ปุ่มลบต่อแถว = super_admin เท่านั้น (คืนของกลับเข้าคลัง + เก็บ snapshot)
import { PackageMinus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getDcContext } from "@/lib/dc/access";
import { requireDcManager } from "@/lib/dc/role-guard";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { DcDeleteButton } from "@/app/(admin)/dc/_components/dc-delete-button";
import { getDcOfficeChrome, dcShellChrome } from "@/lib/dc/office-chrome";
import { DcOfficeShell } from "@/components/dc/office-shell";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

function fmtDateTime(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

export default async function DcIssuesPage() {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;
  const canDelete = isSuperAdmin(ctx.session.user.role); // ลบใบเบิก = super_admin เท่านั้น

  const issues = await prisma.dcIssue.findMany({
    where: { orgId },
    orderBy: { issuedAt: "desc" },
    take: 200,
  });

  // ชื่อคลัง (ใบเบิกเก็บแค่ warehouseId)
  const whIds = [...new Set(issues.map((i) => i.warehouseId))];
  const whs = whIds.length
    ? await prisma.dcWarehouse.findMany({ where: { id: { in: whIds }, orgId }, select: { id: true, name: true } })
    : [];
  const whName = new Map(whs.map((w) => [w.id, w.name]));

  // จำนวนรายการต่อใบ = count movement (refType=dc_issue · refId=issue.id) — 1 query รวม
  const issueIds = issues.map((i) => i.id);
  const moveCounts = issueIds.length
    ? await prisma.dcStockMovement.groupBy({
        by: ["refId"],
        where: { orgId, refType: "dc_issue", refId: { in: issueIds } },
        _count: { _all: true },
      })
    : [];
  const countByIssue = new Map(moveCounts.map((m) => [m.refId, m._count._all]));

  const chrome = await getDcOfficeChrome(orgId);

  return (
    <DcOfficeShell {...dcShellChrome(ctx, chrome)}>
      <div className="dc-page dc-page--wide" style={{ padding: 0, maxWidth: "none", margin: 0 }}>
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: "-.01em" }}>รายการใบเบิก</h1>
          <p style={{ margin: "5px 0 0", color: "var(--ink2)", fontSize: 14 }}>
            ประวัติการเบิกของออกจากคลัง — เบิกใหม่ที่หน้า “เบิกออก”
          </p>
        </div>

        {issues.length === 0 ? (
          <EmptyState
            icon={<PackageMinus size={26} />}
            title="ยังไม่มีใบเบิก"
            description="เบิกของออกจากคลังที่หน้า “เบิกออก” — เมื่อเบิกแล้วจะมาปรากฏที่นี่"
          />
        ) : (
          <div className="dc-card" style={{ padding: 0, overflowX: "auto", overflowY: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#71717a", background: "#fafafa" }}>
                  <th style={cellHead}>เลขที่</th>
                  <th style={cellHead}>คลัง</th>
                  <th style={{ ...cellHead, textAlign: "right" }}>จำนวนรายการ</th>
                  <th style={cellHead}>หมายเหตุ</th>
                  <th style={cellHead}>เมื่อ</th>
                  {canDelete && <th style={{ ...cellHead, textAlign: "right" }}>ลบ</th>}
                </tr>
              </thead>
              <tbody>
                {issues.map((i) => (
                  <tr key={i.id} style={{ borderTop: "1px solid var(--dc-line, #f0f0f2)" }}>
                    <td style={{ ...cell, fontWeight: 700, color: "#18181b", fontVariantNumeric: "tabular-nums" }}>{i.issueCode}</td>
                    <td style={{ ...cell, color: "#52525b" }}>{whName.get(i.warehouseId) ?? "—"}</td>
                    <td style={{ ...cell, textAlign: "right", color: "#52525b", fontVariantNumeric: "tabular-nums" }}>
                      {countByIssue.get(i.id) ?? 0}
                    </td>
                    <td style={{ ...cell, color: "#52525b" }}>{i.note ?? "—"}</td>
                    <td style={{ ...cell, color: "#52525b", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {fmtDateTime(i.issuedAt)}
                    </td>
                    {canDelete && (
                      <td style={{ ...cell, textAlign: "right" }}>
                        <DcDeleteButton docType="issue" docId={i.id} docCode={i.issueCode} size="sm" />
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
