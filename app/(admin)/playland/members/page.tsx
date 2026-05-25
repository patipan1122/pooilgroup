import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { listBranches, searchMembers, getMemberDetail, listPackages } from "@/lib/playland/queries";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtDateTime, memberTypeLabel } from "@/lib/playland/format";
import { CheckinExistingButton } from "@/components/playland/checkin-existing-button";
import { Users, ScanFace } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ q?: string; branch?: string; selected?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const orgId = session.user.org_id;
  const branches = await listBranches(orgId);
  const branchId = sp.branch || branches[0]?.id;
  const query = sp.q ?? "";

  let members: Awaited<ReturnType<typeof searchMembers>> = [];
  if (branchId) {
    members = query.length > 0
      ? await searchMembers(orgId, query, branchId, 100)
      : await prisma.playlandMember.findMany({ where: { orgId, branchId, deletedAt: null }, orderBy: { createdAt: "desc" }, take: 100 });
  }

  const selectedId = sp.selected;
  const selected = selectedId ? await getMemberDetail(orgId, selectedId) : null;
  const packages = branchId ? await listPackages(orgId, branchId) : [];

  return (
    <div className="pl-page">
      <header className="pl-header">
        <div>
          <div className="pl-eyebrow">Playland · สมาชิก</div>
          <h1>สมาชิกทั้งหมด · {members.length} คน</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <form>
            <input className="pl-input" name="q" placeholder="ค้นชื่อ · เบอร์ · code (Enter)" defaultValue={query} style={{ width: 280 }} />
            {sp.branch && <input type="hidden" name="branch" value={sp.branch} />}
          </form>
          <Link href={`/playland?branch=${branchId ?? ""}`} className="pl-btn pl-btn-primary"><ScanFace size={14} /> ลงทะเบียนใหม่</Link>
        </div>
      </header>

      <div className="pl-two-pane">
        <div className="pl-pane">
          <table className="pl-table">
            <thead>
              <tr>
                <th>ชื่อ</th>
                <th>ประเภท</th>
                <th>เบอร์</th>
                <th>สมัครเมื่อ</th>
                <th>มาล่าสุด</th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 && (
                <tr><td colSpan={5}><div className="pl-empty"><Users size={32} opacity={0.4} />ไม่มีสมาชิก</div></td></tr>
              )}
              {members.map((m) => (
                <tr key={m.id} className={selectedId === m.id ? "is-selected" : ""} onClick={() => { window.location.href = `/playland/members?selected=${m.id}${branchId ? `&branch=${branchId}` : ""}${query ? `&q=${query}` : ""}`; }}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{m.name} {m.nickname ? <span style={{ color: "var(--pl-text-muted)", fontWeight: 400 }}>({m.nickname})</span> : null}</div>
                    <div style={{ fontSize: 11, color: "var(--pl-text-muted)" }}>{m.memberCode}</div>
                  </td>
                  <td><span className="pl-chip pl-chip-brand">{memberTypeLabel(m.type)}</span></td>
                  <td>{m.phone ?? "—"}</td>
                  <td>{fmtDate(m.createdAt)}</td>
                  <td>{m.lastVisitAt ? fmtDateTime(m.lastVisitAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="pl-pane">
          {!selected ? (
            <div className="pl-empty">
              <Users size={32} opacity={0.4} />
              เลือกสมาชิกเพื่อดูรายละเอียด
            </div>
          ) : (
            <div style={{ padding: 16 }}>
              <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                {selected.photoR2Path ? (
                  <img src={selected.photoR2Path} alt={selected.name} style={{ width: 80, height: 80, borderRadius: 12, objectFit: "cover" }} />
                ) : (
                  <div style={{ width: 80, height: 80, borderRadius: 12, background: "var(--pl-line)", display: "grid", placeItems: "center", fontSize: 28, fontWeight: 700, color: "var(--pl-text-muted)" }}>{selected.name[0]}</div>
                )}
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{selected.name}</div>
                  <div style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>{selected.memberCode}</div>
                  <span className="pl-chip pl-chip-brand" style={{ marginTop: 4 }}>{memberTypeLabel(selected.type)}</span>
                </div>
              </div>
              <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
                <div><span style={{ color: "var(--pl-text-muted)" }}>เบอร์:</span> {selected.phone ?? "—"}</div>
                <div><span style={{ color: "var(--pl-text-muted)" }}>วันเกิด:</span> {selected.dateOfBirth ? fmtDate(selected.dateOfBirth) : "—"}</div>
                <div><span style={{ color: "var(--pl-text-muted)" }}>Face ID:</span> {selected.faceId ?? "ยังไม่มี"}</div>
                <div><span style={{ color: "var(--pl-text-muted)" }}>สมัครเมื่อ:</span> {fmtDateTime(selected.createdAt)}</div>
                <div><span style={{ color: "var(--pl-text-muted)" }}>มาล่าสุด:</span> {selected.lastVisitAt ? fmtDateTime(selected.lastVisitAt) : "—"}</div>
                <div><span style={{ color: "var(--pl-text-muted)" }}>Consent:</span> {selected.consentAt ? `ใช่ · ${fmtDate(selected.consentAt)}` : "ไม่"}</div>
                <div><span style={{ color: "var(--pl-text-muted)" }}>Loyalty:</span> {selected.loyalty?.points ?? 0} แต้ม</div>
              </div>

              {branchId && (
                <div style={{ marginTop: 12 }}>
                  <CheckinExistingButton
                    branchId={branchId}
                    memberId={selected.id}
                    memberName={selected.name}
                    packages={packages.map((p) => ({ id: p.id, name: p.name, price: p.price, minutes: p.minutes ?? 0, type: p.type }))}
                  />
                </div>
              )}

              {selected.familyMemberships.length > 0 && (
                <>
                  <div className="pl-divider" />
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>ครอบครัว</div>
                  {selected.familyMemberships.map((fm) => (
                    <div key={fm.id} style={{ fontSize: 13 }}>
                      <div style={{ fontWeight: 500 }}>{fm.familyGroup.displayName}</div>
                      <div style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>
                        สมาชิก: {fm.familyGroup.members.map((m) => m.member.name).join(" · ")}
                      </div>
                    </div>
                  ))}
                </>
              )}

              <div className="pl-divider" />
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>ประวัติเข้าใช้ล่าสุด</div>
              {selected.sessions.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>ยังไม่เคยเข้า</div>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 12 }}>
                  {selected.sessions.slice(0, 10).map((s) => (
                    <li key={s.id} style={{ padding: "4px 0", borderBottom: "1px dashed var(--pl-line)" }}>
                      {fmtDateTime(s.checkInAt)} · {s.package?.name ?? "—"} · <span style={{ color: "var(--pl-text-muted)" }}>{s.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
