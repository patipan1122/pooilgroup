import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { listBranches, searchMembers, getMemberDetail, listPackages } from "@/lib/playland/queries";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtDateTime, memberTypeLabel } from "@/lib/playland/format";
import { CheckinExistingButton } from "@/components/playland/checkin-existing-button";
import { NavSelect } from "@/components/playland/nav-select";
import { Users, ScanFace, ArrowLeft, Search, Phone, Calendar } from "lucide-react";

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
          <Link href="/playland" className="pl-eyebrow" style={{ textDecoration: "none" }}><ArrowLeft size={11} /> Workspace</Link>
          <h1>สมาชิก · <span style={{ fontFamily: "var(--pl-font-mono)", fontSize: "0.85rem", color: "var(--pl-text-muted)", fontWeight: 400 }}>{members.length} ราย</span></h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <form style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--pl-text-muted)" }} />
            <input className="pl-input" name="q" placeholder="ค้น ชื่อ · เบอร์ · code" defaultValue={query} style={{ width: 280, paddingLeft: 32 }} />
            {sp.branch && <input type="hidden" name="branch" value={sp.branch} />}
          </form>
          {branches.length > 1 && <NavSelect param="branch" value={branchId ?? ""} options={branches.map((b) => ({ value: b.id, label: b.name }))} style={{ width: 160 }} />}
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
                <th>มาล่าสุด</th>
              </tr>
            </thead>
            <tbody className="pl-stagger">
              {members.length === 0 ? (
                <tr><td colSpan={4}>
                  <div className="pl-empty">
                    <div className="pl-empty-icon"><Users size={22} /></div>
                    <div className="pl-empty-title">{query ? "ไม่พบผู้ตรงกับ" : "ยังไม่มีสมาชิก"}</div>
                    <div className="pl-empty-message">{query ? `ค้น "${query}"` : "ลงทะเบียนคนแรกที่ Workspace"}</div>
                    <Link href={`/playland?branch=${branchId ?? ""}`} className="pl-btn pl-btn-primary" style={{ marginTop: 8 }}>
                      <ScanFace size={14} /> ลงทะเบียนสมาชิก
                    </Link>
                  </div>
                </td></tr>
              ) : members.map((m) => (
                <tr key={m.id} className={selectedId === m.id ? "is-selected" : ""}>
                  <td>
                    <Link href={`/playland/members?selected=${m.id}${branchId ? `&branch=${branchId}` : ""}${query ? `&q=${query}` : ""}`} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                      <div style={{ fontWeight: 600 }}>{m.name} {m.nickname && <span style={{ color: "var(--pl-text-muted)", fontWeight: 400 }}>· {m.nickname}</span>}</div>
                      <div style={{ fontSize: 11, color: "var(--pl-text-muted)", fontFamily: "var(--pl-font-mono)" }}>{m.memberCode ?? "—"}</div>
                    </Link>
                  </td>
                  <td><span className="pl-chip pl-chip-brand">{memberTypeLabel(m.type)}</span></td>
                  <td className="pl-num" style={{ color: "var(--pl-text-muted)" }}>{m.phone ?? "—"}</td>
                  <td className="pl-num" style={{ color: "var(--pl-text-muted)" }}>{m.lastVisitAt ? fmtDate(m.lastVisitAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="pl-pane">
          {!selected ? (
            <div className="pl-empty">
              <div className="pl-empty-icon"><Users size={22} /></div>
              <div className="pl-empty-title">เลือกสมาชิก</div>
              <div className="pl-empty-message">คลิกแถวซ้ายเพื่อดู profile + check-in</div>
            </div>
          ) : (
            <div style={{ padding: 20 }}>
              <div style={{ display: "flex", gap: 14, marginBottom: 16 }}>
                {selected.photoR2Path ? (
                  <img src={selected.photoR2Path} alt={selected.name} style={{ width: 88, height: 88, borderRadius: 14, objectFit: "cover" }} />
                ) : (
                  <div style={{
                    width: 88, height: 88, borderRadius: 14,
                    background: "linear-gradient(135deg, var(--pl-amber-100), var(--pl-amber-200))",
                    display: "grid", placeItems: "center",
                    fontFamily: "var(--pl-font-display)", fontSize: 36, fontWeight: 500,
                    color: "var(--pl-amber-900)",
                  }}>{selected.name[0]}</div>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontFamily: "var(--pl-font-display)", fontSize: "1.25rem", fontWeight: 500, letterSpacing: "-0.02em" }}>{selected.name}</div>
                  {selected.nickname && <div style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>· {selected.nickname}</div>}
                  <div style={{ fontFamily: "var(--pl-font-mono)", fontSize: 11, color: "var(--pl-text-muted)", marginTop: 2 }}>{selected.memberCode ?? "—"}</div>
                  <span className="pl-chip pl-chip-brand" style={{ marginTop: 6 }}>{memberTypeLabel(selected.type)}</span>
                </div>
              </div>

              <div style={{ display: "grid", gap: 6, fontSize: 13, marginBottom: 14 }}>
                {selected.phone && <Detail icon={<Phone size={11} />} label="โทร" value={selected.phone} />}
                {selected.dateOfBirth && <Detail icon={<Calendar size={11} />} label="วันเกิด" value={fmtDate(selected.dateOfBirth)} />}
                <Detail icon={<ScanFace size={11} />} label="Face ID" value={selected.faceId ?? "ยังไม่มี"} />
                <Detail label="สมัครเมื่อ" value={fmtDateTime(selected.createdAt)} />
                <Detail label="มาล่าสุด" value={selected.lastVisitAt ? fmtDateTime(selected.lastVisitAt) : "—"} />
                <Detail label="Loyalty" value={`${selected.loyalty?.points ?? 0} แต้ม`} />
              </div>

              {branchId && (
                <CheckinExistingButton
                  branchId={branchId}
                  memberId={selected.id}
                  memberName={selected.name}
                  packages={packages.map((p) => ({ id: p.id, name: p.name, price: p.price, minutes: p.minutes ?? 0, type: p.type }))}
                />
              )}

              {selected.familyMemberships.length > 0 && (
                <>
                  <div className="pl-divider" />
                  <div className="pl-eyebrow" style={{ marginBottom: 8 }}>ครอบครัว</div>
                  {selected.familyMemberships.map((fm) => (
                    <div key={fm.id} className="pl-card" style={{ padding: 10, marginBottom: 6 }}>
                      <div style={{ fontWeight: 500 }}>{fm.familyGroup.displayName}</div>
                      <div style={{ fontSize: 12, color: "var(--pl-text-muted)", marginTop: 2 }}>
                        {fm.familyGroup.members.map((m) => m.member.name).join(" · ")}
                      </div>
                    </div>
                  ))}
                </>
              )}

              <div className="pl-divider" />
              <div className="pl-eyebrow" style={{ marginBottom: 8 }}>ประวัติเข้าใช้</div>
              {selected.sessions.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>ยังไม่เคยเข้า</div>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 12 }}>
                  {selected.sessions.slice(0, 10).map((s) => (
                    <li key={s.id} style={{ padding: "6px 0", borderBottom: "1px dashed var(--pl-line)", display: "flex", justifyContent: "space-between" }}>
                      <span>{fmtDateTime(s.checkInAt)}</span>
                      <span style={{ color: "var(--pl-text-muted)" }}>{s.package?.name} · {s.status}</span>
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

function Detail({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      {icon && <span style={{ color: "var(--pl-text-muted)" }}>{icon}</span>}
      <span style={{ color: "var(--pl-text-muted)", fontFamily: "var(--pl-font-mono)", fontSize: 11 }}>{label}</span>
      <span style={{ marginLeft: "auto", textAlign: "right" }}>{value}</span>
    </div>
  );
}
