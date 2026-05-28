// Playland · Wristband management · cashier issues + table of active

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { listBranches } from "@/lib/playland/queries";
import { fmtDateTime } from "@/lib/playland/format";
import { WristbandIssueForm } from "@/components/playland/wristband-issue-form";
import { ArrowLeft, ScanLine, ScanQrCode } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function WristbandsPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const orgId = session.user.org_id;
  const branches = await listBranches(orgId);
  const branchId = sp.branch || branches[0]?.id;
  if (!branchId) return <div className="pl-page"><header className="pl-header"><h1>ตั้งค่าสาขาก่อน</h1></header></div>;

  const recent = await prisma.playlandWristband.findMany({
    where: { orgId, branchId },
    include: { member: { select: { name: true, nickname: true, memberCode: true } } },
    orderBy: { issuedAt: "desc" },
    take: 30,
  });

  return (
    <div className="pl-page">
      <header className="pl-header">
        <div>
          <Link href="/playland" className="pl-eyebrow" style={{ textDecoration: "none" }}><ArrowLeft size={11} /> Workspace</Link>
          <h1>สายรัดข้อมือ · <span style={{ fontFamily: "var(--pl-font-mono)", fontSize: "0.85rem", color: "var(--pl-text-muted)", fontWeight: 400 }}>{recent.length} ล่าสุด</span></h1>
        </div>
        <Link href="/playland/scan" className="pl-btn pl-btn-primary"><ScanLine size={14} /> สแกน wristband</Link>
      </header>

      <div className="pl-two-pane">
        <main className="pl-pane" style={{ padding: 18 }}>
          <div className="pl-eyebrow" style={{ marginBottom: 10 }}><ScanQrCode size={11} /> ออก wristband ใหม่</div>
          <WristbandIssueForm branchId={branchId} />
        </main>

        <aside className="pl-pane">
          <div className="pl-pane-head">
            <div>
              <div className="pl-pane-title">ที่ออกล่าสุด</div>
              <div className="pl-pane-count">{recent.length} รายการ</div>
            </div>
          </div>
          <table className="pl-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>สมาชิก</th>
                <th>สถานะ</th>
                <th>ออกเมื่อ</th>
              </tr>
            </thead>
            <tbody className="pl-stagger">
              {recent.length === 0 ? (
                <tr><td colSpan={4}><div className="pl-empty">ยังไม่มี wristband</div></td></tr>
              ) : recent.map((w) => (
                <tr key={w.id}>
                  <td style={{ fontFamily: "var(--pl-font-mono)", fontWeight: 600 }}>{w.code}</td>
                  <td>{w.member?.name ?? "—"}</td>
                  <td>
                    <span className={`pl-chip ${
                      w.status === "ACTIVE" ? "pl-chip-ok" :
                      w.status === "ISSUED" ? "pl-chip-warn" :
                      w.status === "LOST" ? "pl-chip-danger" : "pl-chip-muted"
                    }`}>{w.status}</span>
                  </td>
                  <td className="pl-num" style={{ fontSize: 11, color: "var(--pl-text-muted)" }}>{fmtDateTime(w.issuedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </aside>
      </div>
    </div>
  );
}
