import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { fmtDateTime } from "@/lib/playland/format";
import { History } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ category?: string; q?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const orgId = session.user.org_id;

  const logs = await prisma.playlandAuditLog.findMany({
    where: {
      orgId,
      ...(sp.category ? { category: sp.category } : {}),
      ...(sp.q ? { OR: [{ action: { contains: sp.q } }, { entityType: { contains: sp.q } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  return (
    <div className="pl-page">
      <header className="pl-header">
        <div>
          <div className="pl-eyebrow">Playland · Audit Log</div>
          <h1>บันทึกการกระทำ · {logs.length} entries (ล่าสุด 500)</h1>
        </div>
        <form style={{ display: "flex", gap: 8 }}>
          <select className="pl-select" name="category" defaultValue={sp.category ?? ""} onChange={(e) => e.currentTarget.form?.submit()}>
            <option value="">ทุกประเภท</option>
            <option value="money">เงิน</option>
            <option value="device">Device</option>
            <option value="general">ทั่วไป</option>
          </select>
          <input className="pl-input" name="q" placeholder="ค้น action / entity" defaultValue={sp.q ?? ""} style={{ width: 240 }} />
        </form>
      </header>

      <div className="pl-pane" style={{ flex: 1, overflowY: "auto" }}>
        <table className="pl-table">
          <thead>
            <tr>
              <th>เวลา</th>
              <th>Actor</th>
              <th>Role</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Category</th>
              <th>รายละเอียด</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && <tr><td colSpan={7}><div className="pl-empty"><History size={28} opacity={0.4} />ยังไม่มี log</div></td></tr>}
            {logs.map((l) => (
              <tr key={l.id}>
                <td style={{ fontSize: 12 }}>{fmtDateTime(l.createdAt)}</td>
                <td style={{ fontSize: 12 }}>{l.actorUserId?.slice(0, 8) ?? "—"}</td>
                <td><span className="pl-chip pl-chip-muted">{l.actorRole ?? "—"}</span></td>
                <td><span className="pl-chip pl-chip-brand">{l.action}</span></td>
                <td style={{ fontSize: 12 }}>{l.entityType} {l.entityId ? `#${l.entityId.slice(0, 8)}` : ""}</td>
                <td><span className={`pl-chip pl-chip-${l.category === "money" ? "danger" : l.category === "device" ? "info" : "muted"}`}>{l.category}</span></td>
                <td style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {l.after ? JSON.stringify(l.after) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
