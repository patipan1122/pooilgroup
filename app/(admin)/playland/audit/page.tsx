import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { fmtDateTime } from "@/lib/playland/format";
import { BackOfficeTabs } from "@/components/playland/back-office-tabs";
import { History, ArrowLeft, Search } from "lucide-react";

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

  // Group by date for cleaner view
  const byDate = new Map<string, typeof logs>();
  for (const l of logs) {
    const day = new Date(l.createdAt).toISOString().slice(0, 10);
    (byDate.get(day) ?? byDate.set(day, []).get(day)!).push(l);
  }

  return (
    <div className="pl-page">
      <header className="pl-header">
        <div>
          <Link href="/playland" className="pl-eyebrow" style={{ textDecoration: "none" }}><ArrowLeft size={11} /> Workspace</Link>
          <h1>Audit Log · <span style={{ fontFamily: "var(--pl-font-mono)", fontSize: "0.85rem", color: "var(--pl-text-muted)", fontWeight: 400 }}>{logs.length} entries</span></h1>
        </div>
        <form style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div className="pl-toggle-group">
            <a href="/playland/audit" className={!sp.category ? "is-active" : ""} style={{ padding: "5px 12px", borderRadius: "calc(var(--pl-r-md) - 3px)", fontSize: "0.8125rem", fontWeight: 500, color: !sp.category ? "var(--pl-text)" : "var(--pl-text-muted)", textDecoration: "none", background: !sp.category ? "var(--pl-paper)" : "transparent", boxShadow: !sp.category ? "var(--pl-shadow-1)" : "none" }}>ทั้งหมด</a>
            <a href="/playland/audit?category=money" className={sp.category === "money" ? "is-active" : ""} style={{ padding: "5px 12px", borderRadius: "calc(var(--pl-r-md) - 3px)", fontSize: "0.8125rem", fontWeight: 500, color: sp.category === "money" ? "var(--pl-text)" : "var(--pl-text-muted)", textDecoration: "none", background: sp.category === "money" ? "var(--pl-paper)" : "transparent", boxShadow: sp.category === "money" ? "var(--pl-shadow-1)" : "none" }}>เงิน</a>
            <a href="/playland/audit?category=device" className={sp.category === "device" ? "is-active" : ""} style={{ padding: "5px 12px", borderRadius: "calc(var(--pl-r-md) - 3px)", fontSize: "0.8125rem", fontWeight: 500, color: sp.category === "device" ? "var(--pl-text)" : "var(--pl-text-muted)", textDecoration: "none", background: sp.category === "device" ? "var(--pl-paper)" : "transparent", boxShadow: sp.category === "device" ? "var(--pl-shadow-1)" : "none" }}>Device</a>
            <a href="/playland/audit?category=general" className={sp.category === "general" ? "is-active" : ""} style={{ padding: "5px 12px", borderRadius: "calc(var(--pl-r-md) - 3px)", fontSize: "0.8125rem", fontWeight: 500, color: sp.category === "general" ? "var(--pl-text)" : "var(--pl-text-muted)", textDecoration: "none", background: sp.category === "general" ? "var(--pl-paper)" : "transparent", boxShadow: sp.category === "general" ? "var(--pl-shadow-1)" : "none" }}>ทั่วไป</a>
          </div>
          <input className="pl-input" name="q" placeholder="ค้น action..." defaultValue={sp.q ?? ""} style={{ width: 200 }} />
        </form>
      </header>

      <BackOfficeTabs active="audit" />

      <div style={{ overflowY: "auto", padding: 20 }}>
        {logs.length === 0 ? (
          <div className="pl-empty">
            <div className="pl-empty-icon"><History size={22} /></div>
            <div className="pl-empty-title">ยังไม่มี log</div>
            <div className="pl-empty-message">ทุกการกระทำ (login · register · refund · ปิดกะ · etc.) จะถูกบันทึกที่นี่</div>
          </div>
        ) : (
          Array.from(byDate.entries()).map(([day, items]) => (
            <div key={day} style={{ marginBottom: 20 }}>
              <div className="pl-eyebrow" style={{ marginBottom: 8 }}>{day} · {items.length} actions</div>
              <div className="pl-card" style={{ padding: 0, overflow: "hidden" }}>
                <table className="pl-table">
                  <thead>
                    <tr>
                      <th>เวลา</th>
                      <th>Action</th>
                      <th>Entity</th>
                      <th>Actor</th>
                      <th>Category</th>
                      <th>Payload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((l) => (
                      <tr key={l.id}>
                        <td className="pl-num" style={{ color: "var(--pl-text-muted)", fontSize: 12 }}>{new Date(l.createdAt).toISOString().slice(11, 19)}</td>
                        <td><span className="pl-chip pl-chip-brand">{l.action}</span></td>
                        <td style={{ fontSize: 12 }}>{l.entityType}{l.entityId ? <span style={{ color: "var(--pl-text-faint)", fontFamily: "var(--pl-font-mono)" }}> #{l.entityId.slice(0, 6)}</span> : null}</td>
                        <td style={{ fontSize: 12 }}>
                          <span className="pl-chip pl-chip-muted">{l.actorRole ?? "—"}</span>
                          {l.actorUserId && <span style={{ marginLeft: 4, color: "var(--pl-text-faint)", fontFamily: "var(--pl-font-mono)", fontSize: 11 }}>{l.actorUserId.slice(0, 6)}</span>}
                        </td>
                        <td>
                          <span className={`pl-chip ${l.category === "money" ? "pl-chip-danger" : l.category === "device" ? "pl-chip-info" : "pl-chip-muted"}`}>
                            {l.category}
                          </span>
                        </td>
                        <td style={{ fontSize: 11, fontFamily: "var(--pl-font-mono)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--pl-text-muted)" }}>
                          {l.after ? JSON.stringify(l.after) : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
