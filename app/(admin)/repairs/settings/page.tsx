// /repairs/settings — Pooil App vocab (.panel .btn)
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRepairAdmin } from "@/lib/repair/role-guard";
import {
  listCategories,
  listTechnicians,
  listCompanies,
} from "@/lib/repair/queries";
import { prisma } from "@/lib/prisma";
import {
  Settings,
  Wrench,
  ListChecks,
  ExternalLink,
  Globe,
  Building2,
  Link as LinkIcon,
  QrCode,
  Copy,
} from "lucide-react";
import { RepairSubHeader } from "@/components/repair/sub-header";

export const dynamic = "force-dynamic";

export default async function RepairSettingsPage() {
  const session = await requireSession();
  requireRepairAdmin(session.user.role);
  const orgId = session.user.org_id;

  const [cats, techs, companies, branchCount] = await Promise.all([
    listCategories(orgId),
    listTechnicians(orgId, false),
    listCompanies(orgId),
    prisma.branch.count({ where: { orgId, isActive: true } }),
  ]);
  const activeTechs = techs.filter((t) => t.isActive).length;

  return (
    <>
      <RepairSubHeader
        icon={Settings}
        eyebrow="Setup · Configuration"
        title="ตั้งค่าระบบแจ้งซ่อม"
        subtitle="หมวดงาน · ช่าง · ลิงก์สาธารณะ · พรีวิวฟอร์ม"
        stats={[
          { label: "หมวดงาน", value: cats.length },
          { label: "ช่าง active", value: activeTechs, tone: "success" },
          { label: "สาขา active", value: branchCount },
          { label: "บริษัท", value: companies.length },
        ]}
      />

      <div className="repair-content" style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 1000 }}>
        {/* Resource management */}
        <section>
          <div className="section-h" style={{ marginTop: 0 }}>จัดการทรัพยากร</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <SettingCard
              href="/repairs/technicians"
              icon={<Wrench size={18} />}
              tone="brand"
              title="จัดการช่าง"
              subtitle={`${activeTechs} active · ${techs.length} ทั้งหมด`}
              cta="เปิดหน้า Technicians"
            />
            <SettingCard
              href="/repairs/categories"
              icon={<ListChecks size={18} />}
              tone="warn"
              title="หมวดงานซ่อม"
              subtitle={`${cats.length} หมวด · ผู้แจ้งเลือกได้`}
              cta="เปิดหน้า Categories"
            />
          </div>
        </section>

        {/* Public link */}
        <section className="panel" style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: "#ECFDF5", color: "var(--good)",
              display: "grid", placeItems: "center", flexShrink: 0,
            }}>
              <LinkIcon size={18} />
            </div>
            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "var(--ink-900)" }}>
                ลิงก์ฟอร์มสาธารณะ
              </h3>
              <p style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>
                ใช้แปะหน้าร้าน · LINE · QR code · ใครก็แจ้งซ่อมได้
              </p>
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                <Link
                  href="/r"
                  target="_blank"
                  className="btn btn-primary btn-sm"
                  style={{ background: "var(--ink-900)", borderColor: "var(--ink-1000)" }}
                >
                  <Globe />
                  หน้าหลัก /r
                  <ExternalLink size={11} />
                </Link>
                <Link
                  href="/r/new"
                  target="_blank"
                  className="btn btn-primary btn-sm"
                >
                  <ExternalLink />
                  ฟอร์มแจ้งซ่อม /r/new
                </Link>
                <Link href="/r/track" target="_blank" className="btn btn-sm">
                  <ExternalLink />
                  หน้าติดตาม /r/track
                </Link>
              </div>
              <div style={{
                marginTop: 10, display: "inline-flex", alignItems: "center", gap: 8,
                padding: "4px 12px",
                background: "var(--surface-2)", border: "1px solid var(--line)",
                borderRadius: 6,
                fontSize: 11.5, color: "var(--ink-700)",
                fontFamily: "var(--font-mono)",
              }}>
                <Copy size={11} style={{ color: "var(--ink-400)" }} />
                /r/new
                <span style={{ color: "var(--ink-400)" }}>·</span>
                <QrCode size={11} style={{ color: "var(--ink-400)" }} />
                แชร์ในกรุ๊ปไลน์สาขา
              </div>
            </div>
          </div>
        </section>

        {/* Company list */}
        {companies.length > 0 && (
          <section className="panel" style={{ padding: 18 }}>
            <h3 style={{
              fontSize: 14, fontWeight: 700, margin: 0, color: "var(--ink-900)",
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <Building2 size={14} style={{ color: "var(--ink-500)" }} />
              บริษัทในระบบ
            </h3>
            <p style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>
              ใช้แยก ticket ตามบริษัท · biz tab ในหน้าภาพรวม / Triage / Kanban / ตาราง
              จะกรองตามบริษัทนี้
            </p>
            <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0 }}>
              {companies.map((c, i) => (
                <li
                  key={c.id}
                  style={{
                    display: "flex", alignItems: "center", padding: "10px 0",
                    borderBottom: i === companies.length - 1 ? 0 : "1px solid var(--line-2)",
                  }}
                >
                  <span style={{
                    width: 28, height: 28, borderRadius: 14,
                    background: "var(--brand-50)", color: "var(--brand-700)",
                    display: "grid", placeItems: "center",
                    fontWeight: 700, marginRight: 12,
                  }}>
                    {c.code.charAt(0)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-900)" }}>
                      {c.name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ink-500)", fontFamily: "var(--font-mono)" }}>
                      {c.code}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* SLA reference */}
        <section className="panel" style={{
          padding: 18, background: "var(--surface-2)",
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "var(--ink-900)" }}>
            SLA เริ่มต้น
          </h3>
          <p style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>
            ระยะเวลาที่ระบบใช้ในการตั้งวันต้องเสร็จ (อ้างอิงจาก urgency ที่ผู้แจ้งเลือก)
          </p>
          <div style={{
            marginTop: 12, display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr", gap: 8,
          }}>
            <SlaTile label="ด่วนมาก" response="4 ชม." resolve="24 ชม." tone="red" />
            <SlaTile label="ปานกลาง" response="24 ชม." resolve="72 ชม." tone="amber" />
            <SlaTile label="ไม่เร่งด่วน" response="72 ชม." resolve="7 วัน" tone="zinc" />
          </div>
        </section>
      </div>
    </>
  );
}

function SettingCard({
  href, icon, tone, title, subtitle, cta,
}: {
  href: string;
  icon: React.ReactNode;
  tone: "brand" | "warn" | "good";
  title: string;
  subtitle: string;
  cta: string;
}) {
  const toneBg: Record<typeof tone, string> = {
    brand: "var(--brand-50)",
    warn: "#FFFBEB",
    good: "#ECFDF5",
  };
  const toneColor: Record<typeof tone, string> = {
    brand: "var(--brand-700)",
    warn: "var(--warn)",
    good: "var(--good)",
  };
  return (
    <Link href={href} className="panel" style={{
      padding: 16, textDecoration: "none", color: "inherit",
      display: "flex", alignItems: "flex-start", gap: 12,
      cursor: "pointer",
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: toneBg[tone], color: toneColor[tone],
        display: "grid", placeItems: "center", flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <p style={{ fontWeight: 700, color: "var(--ink-900)", margin: 0 }}>{title}</p>
        <p style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>{subtitle}</p>
        <p style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: "var(--brand-700)" }}>
          {cta} →
        </p>
      </div>
    </Link>
  );
}

function SlaTile({
  label, response, resolve, tone,
}: {
  label: string;
  response: string;
  resolve: string;
  tone: "red" | "amber" | "zinc";
}) {
  const map: Record<typeof tone, { bg: string; border: string; color: string }> = {
    red:   { bg: "#FEF2F2", border: "#FECACA", color: "var(--bad)" },
    amber: { bg: "#FFFBEB", border: "#FDE68A", color: "var(--warn)" },
    zinc:  { bg: "var(--surface)", border: "var(--line)", color: "var(--ink-700)" },
  };
  const m = map[tone];
  return (
    <div style={{
      background: m.bg, border: `1px solid ${m.border}`,
      borderRadius: 10, padding: 12,
      color: m.color,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div style={{ marginTop: 6, fontSize: 11.5, display: "flex", flexDirection: "column", gap: 2 }} className="num">
        <div><b style={{ fontWeight: 700 }}>ตอบ:</b> {response}</div>
        <div><b style={{ fontWeight: 700 }}>ปิด:</b> {resolve}</div>
      </div>
    </div>
  );
}
