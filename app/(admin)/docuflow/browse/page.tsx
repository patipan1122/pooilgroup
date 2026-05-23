// DocuFlow — /docuflow/browse
// ────────────────────────────────────────────────────────────────────
// Redesign 2026-05-21 — matches DesktopStructure canvas:
//   8 category tiles · organization tree · search w/ AI badge.
// Data source unchanged — buildDocumentTree() still drives.
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import {
  ArrowLeft,
  Upload,
  Search,
  Scale,
  Wallet,
  Shield,
  Fuel,
  Car,
  TreePine,
  FileText,
  Stamp,
  Settings,
  Building2,
  Sparkles,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { isAdminTier } from "@/lib/auth/module-access";
import { buildDocumentTree } from "@/lib/docuflow/tree";
import { TreeBrowser } from "@/components/docuflow/tree-browser";
import {
  DfButton,
  DfCard,
  DfPill,
  DfEyebrow,
  DfPageHeader,
  DfSection,
} from "@/components/docuflow/df-ui";
import { DfTopBanner } from "@/components/docuflow/df-top-banner";

export const dynamic = "force-dynamic";

const CATEGORIES: Array<{
  id: string;
  name: string;
  color: string;
  icon: React.ReactNode;
  bucket: "keep" | "signoff";
  /** Tag value the category routes to via `?tag=` filter (must exist on Document rows) */
  tag: string;
}> = [
  { id: "legal", name: "เอกสารนิติบุคคล", color: "#1B47B5", icon: <Scale size={20} />, bucket: "keep", tag: "นิติบุคคล" },
  { id: "tax", name: "ภาษี & การเงิน", color: "#15803D", icon: <Wallet size={20} />, bucket: "keep", tag: "ภาษี" },
  { id: "insurance", name: "ประกัน", color: "#7C3AED", icon: <Shield size={20} />, bucket: "keep", tag: "ประกัน" },
  { id: "station", name: "เอกสารปั๊ม / สถานี", color: "#C46A3D", icon: <Fuel size={20} />, bucket: "keep", tag: "ใบอนุญาตหลัก" },
  { id: "vehicle", name: "ทะเบียนรถ", color: "#0EA5A4", icon: <Car size={20} />, bucket: "keep", tag: "ทะเบียนรถ" },
  { id: "land", name: "ที่ดิน · สัญญาที่ดิน", color: "#B45309", icon: <TreePine size={20} />, bucket: "keep", tag: "สัญญาที่ดิน" },
  { id: "contract", name: "สัญญา", color: "#0E2D7A", icon: <FileText size={20} />, bucket: "keep", tag: "สัญญา" },
  { id: "signoff", name: "เซ็นทิ้ง · ไม่เก็บ", color: "#6B7488", icon: <Stamp size={20} />, bucket: "signoff", tag: "มอบอำนาจ" },
];

export default async function DocuFlowBrowsePage() {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const orgId = session.user.org_id;
  const adminTier = isAdminTier(session.user.role);

  const tree = await buildDocumentTree(orgId);

  return (
    <div
      style={{
        padding: "28px clamp(16px, 4vw, 40px)",
        paddingBottom: 96,
        maxWidth: 1400,
        margin: "0 auto",
      }}
    >
      <DfTopBanner
        breadcrumbs={[
          { label: "หน้าหลัก", href: "/docuflow" },
          { label: "เอกสารทั้งหมด" },
        ]}
      />

      <DfPageHeader
        eyebrow={<DfEyebrow>โครงสร้าง · จัดการ</DfEyebrow>}
        title={
          <>
            เอกสาร{" "}
            <span style={{ color: "var(--df-brand)" }}>
              {CATEGORIES.length} ประเภท
            </span>{" "}
            ·{" "}
            <span style={{ color: "var(--df-ink-2)" }}>
              {tree.totals.docCount.toLocaleString("th-TH")} รายการ
            </span>
          </>
        }
        description="เลือกประเภทเพื่อดู/แก้ไขโครงสร้างและกฎการเก็บ"
        actions={
          <>
            <div className="df-seg" aria-label="มุมมอง">
              <button className="df-on">ตามประเภท</button>
              <button>ตามบริษัท</button>
              <button>รายการ</button>
            </div>
            {adminTier ? (
              <DfButton
                href="/docuflow/documents/upload/template"
                variant="brand"
              >
                <Upload size={15} />
                อัปโหลดเอกสาร
              </DfButton>
            ) : null}
          </>
        }
      />

      <div
        style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}
        className="df-fade-up df-fade-up-100"
      >
        <label
          className="df-input"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flex: "1 1 360px",
            padding: "0 14px",
            minHeight: 44,
          }}
        >
          <Search size={15} style={{ color: "var(--df-muted)" }} />
          <input
            style={{
              border: "none",
              outline: "none",
              background: "transparent",
              flex: 1,
              fontFamily: "inherit",
              fontSize: 14,
              color: "inherit",
            }}
            placeholder="ค้นหาเอกสาร · เช่น 'ใบอนุญาตถัง KKN' หรือ 'ใกล้หมดอายุ ขอนแก่น'"
          />
          <DfPill tone="brand" small>
            <Sparkles size={11} /> AI
          </DfPill>
        </label>
      </div>

      <div
        style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}
      >
        <DfPill tone="brand" small>
          <Building2 size={11} /> {tree.companies.length} บริษัท
        </DfPill>
        <DfPill tone="outline" small>
          <FileText size={11} /> {tree.totals.docCount.toLocaleString("th-TH")} เอกสาร
        </DfPill>
        {tree.totals.expiringCount > 0 && (
          <DfPill tone="warn" small>
            ต้องต่ออายุ {tree.totals.expiringCount}
          </DfPill>
        )}
      </div>

      <DfSection number="A" label="ประเภทเอกสาร" className="df-fade-up df-fade-up-200">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          {CATEGORIES.map((c) => (
            <Link
              key={c.id}
              href={`/docuflow/documents?tag=${encodeURIComponent(c.tag)}`}
              className="df-card"
              style={{
                padding: 16,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  marginBottom: 12,
                }}
              >
                <span
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: c.color + "18",
                    color: c.color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {c.icon}
                </span>
                {c.bucket === "signoff" && (
                  <DfPill tone="outline" small>
                    เซ็นทิ้ง
                  </DfPill>
                )}
              </div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--df-ink)",
                  marginBottom: 4,
                }}
              >
                {c.name}
              </div>
              <div
                className="df-tnum df-serif"
                style={{ fontSize: 20, fontWeight: 600, color: "var(--df-ink-2)" }}
              >
                —
              </div>
              <div style={{ fontSize: 12, color: "var(--df-muted)" }}>
                ใช้ filter
              </div>
            </Link>
          ))}
          {adminTier && (
            <Link
              href="/docuflow/settings"
              style={{
                padding: 16,
                borderRadius: 18,
                border: "1.5px dashed var(--df-line)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--df-muted)",
                minHeight: 138,
                textDecoration: "none",
                background: "transparent",
              }}
            >
              <Settings size={20} />
              <div style={{ fontSize: 13, marginTop: 6, fontWeight: 600 }}>
                ตั้งค่าประเภทเอกสาร
              </div>
            </Link>
          )}
        </div>
      </DfSection>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)",
          gap: 22,
        }}
        className="df-grid-2col"
      >
        <DfSection
          number="B"
          label="เอกสารตามบริษัท / สาขา"
          className="df-fade-up df-fade-up-300"
        >
          <DfCard padding={0} style={{ overflow: "hidden" }}>
            <TreeBrowser tree={tree} />
          </DfCard>
        </DfSection>

        {/* RIGHT detail panel — canvas DesktopStructure */}
        <DfSection
          number="C"
          label="รายละเอียดประเภท · ตัวอย่าง"
          className="df-fade-up df-fade-up-300"
        >
          <DfCard padding={22}>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                marginBottom: 16,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    background: "#C46A3D18",
                    color: "#C46A3D",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <FileText size={24} />
                </div>
                <div>
                  <h3 className="df-serif" style={{ fontSize: 20, margin: 0 }}>
                    เอกสารปั๊ม / สถานี
                  </h3>
                  <p
                    style={{
                      fontSize: 12,
                      color: "var(--df-muted)",
                      margin: 0,
                      marginTop: 2,
                    }}
                  >
                    ตัวอย่างประเภทที่ครอบคลุมที่สุด
                  </p>
                </div>
              </div>
            </div>

            {/* Storage rule */}
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 10,
                background: "var(--df-bg-warm)",
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "var(--df-success-soft)",
                  color: "var(--df-success)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                }}
              >
                ✓
              </div>
              <div style={{ flex: 1, fontSize: 13 }}>
                <div style={{ fontWeight: 600, color: "var(--df-ink)" }}>
                  เก็บถาวร + ติดตามวันหมดอายุ
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--df-muted)",
                    marginTop: 2,
                  }}
                >
                  ระบบจะเตือนต่ออายุล่วงหน้า 90/30/7 วัน
                </div>
              </div>
            </div>

            {/* Required fields */}
            <div style={{ marginBottom: 16 }}>
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--df-muted)",
                  letterSpacing: "0.08em",
                  marginBottom: 8,
                }}
              >
                FIELDS · ข้อมูลที่ต้องกรอก
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <DfPill tone="default" small>
                  เลขที่เอกสาร
                </DfPill>
                <DfPill tone="default" small>
                  วันออก
                </DfPill>
                <DfPill tone="default" small>
                  วันหมดอายุ
                </DfPill>
                <DfPill tone="default" small>
                  สาขา
                </DfPill>
                <DfPill tone="default" small>
                  ค่าธรรมเนียม
                </DfPill>
                <DfPill tone="default" small>
                  ผู้รับผิดชอบ
                </DfPill>
              </div>
            </div>

            {/* Sample docs */}
            <p
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--df-muted)",
                letterSpacing: "0.08em",
                marginBottom: 8,
              }}
            >
              ตัวอย่างเอกสารในหมวดนี้
            </p>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                maxHeight: 280,
                overflow: "auto",
              }}
            >
              {[
                { name: "ใบอนุญาตประกอบกิจการน้ำมัน KKN-002", days: 0 },
                { name: "ใบรับรองถังเชื้อเพลิง KKN-002", days: 22 },
                { name: "ใบ อบต. สิ่งแวดล้อม KKN-002", days: 60 },
                { name: "ใบอนุญาตเก่า KKN-005 (หมดแล้ว)", days: -15 },
                { name: "เอกสารเปลี่ยนมาตรวัด KKN-003", days: 60 },
              ].map((d, i) => {
                const tone =
                  d.days < 0
                    ? "danger"
                    : d.days <= 30
                      ? "warn"
                      : "outline";
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 10px",
                      borderRadius: 8,
                      background: "var(--df-surface-soft)",
                    }}
                  >
                    <FileText size={14} style={{ color: "var(--df-muted)" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {d.name}
                      </div>
                    </div>
                    <DfPill tone={tone} small>
                      {d.days < 0 ? "หมดแล้ว" : `${d.days} วัน`}
                    </DfPill>
                  </div>
                );
              })}
            </div>
            <DfButton
              href="/docuflow/documents?category=station"
              variant="ghost"
              size="sm"
              style={{
                marginTop: 12,
                width: "100%",
                justifyContent: "center",
              }}
            >
              ดูทั้งหมดในประเภทนี้
            </DfButton>
          </DfCard>
        </DfSection>
      </div>

      <style>{`
        @media (max-width: 1100px) {
          .df-grid-2col { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
