// Playland · จัดโปรโมชั่น (ส่วนกลาง) — หลังบ้าน · พื้นขาว · LOCKED tokens · สไตล์ Play a lot
// CEO policy: ส่วนลดทั้งหมดมาจากที่นี่ · แคชเชียร์ลดเองไม่ได้ (CRUD เท่านั้น · enforcement = Wave 3)
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandManager } from "@/lib/playland/role-guard";
import { getPlaylandRole } from "@/lib/playland/position-resolve";
import { prisma } from "@/lib/prisma";
import { getBranchContext } from "@/lib/playland/branch-context";
import { listBranches } from "@/lib/playland/queries";
import { PromoManager, type PromoRow } from "@/components/playland/settings/promo-manager";
import { Tag } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "จัดโปรโมชั่น · Play a lot" };

const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", LINE = "#ece5d8";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";

export default async function PromosSettingsPage() {
  const session = await requireSession();
  requirePlaylandManager(await getPlaylandRole(session.user.id, session.user.org_id, session.user.role));
  const orgId = session.user.org_id;
  const { active } = await getBranchContext(orgId);

  const [promos, branches] = await Promise.all([
    prisma.playlandPromo.findMany({ where: { orgId }, orderBy: { createdAt: "desc" } }),
    listBranches(orgId),
  ]);

  const rows: PromoRow[] = promos.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    type: p.type,
    discountPercent: p.discountPercent,
    discountCents: p.discountCents,
    maxUses: p.maxUses,
    usesCount: p.usesCount,
    startsAt: p.startsAt ? p.startsAt.toISOString() : null,
    endsAt: p.endsAt ? p.endsAt.toISOString() : null,
    branchId: p.branchId,
    active: p.active,
  }));
  const branchOpts = branches.map((b) => ({ id: b.id, name: b.name }));

  return (
    <div className="pl-scroll" style={{ background: "#fbfbf9", fontFamily: MITR, color: INK }}>
      {/* header strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 28px", background: "#fff", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: "1.25rem", fontFamily: FREDOKA, display: "flex", alignItems: "center", gap: 8 }}>
            <Tag size={20} color={BLUE} /> จัดโปรโมชั่น · ส่วนลด
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            ส่วนลดทั้งหมดมาจากที่นี่ (ส่วนกลาง) · แคชเชียร์ลดเองไม่ได้{active && <> · <span style={{ color: BLUE }}>{active.name}</span></>}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1480, margin: "0 auto", padding: "22px 28px 40px" }}>
        <PromoManager promos={rows} branches={branchOpts} />
      </div>
    </div>
  );
}
