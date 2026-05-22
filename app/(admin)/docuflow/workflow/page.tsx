// DocuFlow · Workflow Builder (canvas DesktopWorkflow)
// ────────────────────────────────────────────────────────────────────
// Multi-signer approval chain UI · driven by real signature placements
// (DocumentSignaturePlacement) — most-recent doc's chain shown as live
// example. Templates list shown for reference.
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  Check,
  Clock,
  PenSquare,
  CheckCircle2,
  Settings,
  FileText,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole, isAdminTier } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { bkkRelative } from "@/lib/utils/format";
import {
  DfButton,
  DfCard,
  DfEyebrow,
  DfPageHeader,
  DfPill,
  DfAvatar,
  DfSection,
} from "@/components/docuflow/df-ui";
import { DfTopBanner } from "@/components/docuflow/df-top-banner";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  org_admin: "Admin",
  admin: "Admin",
  area_manager: "Area Manager",
  branch_manager: "Branch Manager",
  staff: "Staff",
  driver: "Driver",
  viewer: "Viewer",
};

const TEMPLATES = [
  {
    name: "อนุมัติเร็ว · 1 คนเซ็น",
    desc: "ผู้บริหาร 1 คน · วงเงิน ≤ ฿10k",
    used: 142,
  },
  {
    name: "อนุมัติมาตรฐาน · 3 คน",
    desc: "ผจก. → ฝ่ายบัญชี → CEO",
    used: 38,
  },
  {
    name: "อนุมัติสัญญาใหญ่ · 4 คน",
    desc: "ที่ใช้อยู่ในเอกสารนี้",
    used: 12,
    active: true,
  },
  {
    name: "เซ็นทิ้ง · ไม่บันทึก",
    desc: "ใบเสร็จย่อย · ไม่ต้องเก็บ",
    used: 891,
  },
];

export default async function DocuFlowWorkflowPage() {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const orgId = session.user.org_id;
  const adminTier = isAdminTier(session.user.role);

  // Pick the most-recent doc that has signature placements as the live example
  const recentDoc = await prisma.document.findFirst({
    where: {
      orgId,
      isActive: true,
      signaturePlacements: { some: {} },
    },
    select: {
      id: true,
      name: true,
      uploadedAt: true,
      signaturePlacements: {
        orderBy: { ordering: "asc" },
        include: {
          signerUser: { select: { id: true, name: true, role: true } },
        },
      },
    },
    orderBy: { uploadedAt: "desc" },
  });

  const placements = recentDoc?.signaturePlacements ?? [];
  const totalSteps = placements.length;
  const signedSteps = placements.filter((p) => p.signedAt).length;
  const allSigned = totalSteps > 0 && signedSteps === totalSteps;
  // Find the first unsigned placement → that's the current step
  const firstUnsigned = placements.findIndex((p) => !p.signedAt);
  const currentStep = firstUnsigned === -1 ? totalSteps : firstUnsigned;

  const userColor = (id: string) => {
    const colors = ["#0E2D7A", "#1B47B5", "#1F7A4D", "#C46A3D", "#7C3AED"];
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return colors[h % colors.length];
  };
  const initials = (name: string | null) => {
    if (!name) return "??";
    const parts = name.trim().split(/\s+/);
    return (
      (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")
    ).toUpperCase();
  };

  return (
    <div
      style={{
        padding: "28px clamp(16px, 4vw, 40px)",
        paddingBottom: 96,
        maxWidth: 1400,
        margin: "0 auto",
      }}
    >
      <DfTopBanner breadcrumbs={[{ label: "หน้าหลัก", href: "/docuflow" }, { label: "Workflow ลายเซ็น" }]} />

      <DfPageHeader
        eyebrow={<DfEyebrow>Workflow · ลำดับเซ็น</DfEyebrow>}
        title={
          <>
            สัญญาเซ็น{" "}
            <span style={{ color: "var(--df-brand)" }}>{totalSteps}</span>{" "}
            ขั้นตอน
            {allSigned ? (
              <span style={{ color: "var(--df-success)", fontSize: "0.7em" }}>
                {" "}· เสร็จสมบูรณ์
              </span>
            ) : totalSteps > 0 ? (
              <span style={{ color: "var(--df-warn)", fontSize: "0.7em" }}>
                {" "}· {signedSteps}/{totalSteps} เสร็จ
              </span>
            ) : null}
          </>
        }
        description="กำหนดให้ใครเซ็นก่อน-หลัง · ระบบส่งให้บุคคลในลำดับเมื่อขั้นก่อนเซ็นเสร็จ"
        actions={
          adminTier && recentDoc ? (
            <>
              <DfButton
                href={`/docuflow/documents/${recentDoc.id}/signatures`}
                variant="ghost"
              >
                <Settings size={14} />
                แก้ไข workflow
              </DfButton>
              <DfButton href={`/docuflow/documents/${recentDoc.id}`} variant="brand">
                <FileText size={14} />
                ดูเอกสาร
              </DfButton>
            </>
          ) : null
        }
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: 22,
        }}
        className="df-grid-2col"
      >
        {/* LEFT — current workflow */}
        <DfCard padding={24} className="df-fade-up df-fade-up-100">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 18,
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <div>
              <DfEyebrow>ลำดับเซ็น · ตามคิว</DfEyebrow>
              <h2
                className="df-serif"
                style={{ fontSize: 20, marginTop: 4, marginBottom: 0 }}
              >
                {recentDoc
                  ? `${totalSteps} ขั้นตอน · ${signedSteps} เสร็จแล้ว`
                  : "ยังไม่มี workflow ที่เซ็นอยู่"}
              </h2>
              {recentDoc && (
                <div style={{ fontSize: 12, color: "var(--df-muted)", marginTop: 4 }}>
                  จาก: <b>{recentDoc.name}</b> · {bkkRelative(recentDoc.uploadedAt)}
                </div>
              )}
            </div>
            <div className="df-seg">
              <button className="df-on">ลำดับ</button>
              <button>พร้อมกัน</button>
            </div>
          </div>

          {totalSteps === 0 ? (
            <div
              style={{
                padding: 36,
                borderRadius: 12,
                background: "var(--df-surface-soft)",
                color: "var(--df-muted)",
                textAlign: "center",
                fontSize: 14,
              }}
            >
              <PenSquare
                size={28}
                style={{ color: "var(--df-muted-2)", margin: "0 auto 10px" }}
              />
              ยังไม่มีเอกสารที่ตั้งจุดเซ็น
              <br />
              <span style={{ fontSize: 12 }}>
                อัปโหลด PDF แล้วตั้ง workflow จาก document detail page
              </span>
            </div>
          ) : (
            <div>
              {placements.map((p, i) => {
                const status: "done" | "current" | "pending" = p.signedAt
                  ? "done"
                  : i === currentStep
                    ? "current"
                    : "pending";
                const userName = p.signerUser?.name ?? p.signerName ?? "ระบบ";
                const role =
                  p.signerUser?.role ?? p.signerRole ?? "approver";
                const color = p.signerUser
                  ? userColor(p.signerUser.id)
                  : "#9AA1B2";
                const isLast = i === placements.length - 1;
                return (
                  <div
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "stretch",
                      gap: 14,
                      position: "relative",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        flexShrink: 0,
                      }}
                    >
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 12,
                          background:
                            status === "done"
                              ? "var(--df-success)"
                              : status === "current"
                                ? "var(--df-brand)"
                                : "var(--df-surface)",
                          color: status === "pending" ? "var(--df-muted)" : "#fff",
                          border:
                            status === "pending"
                              ? "2px dashed var(--df-line)"
                              : "none",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 700,
                          fontSize: 16,
                          boxShadow:
                            status === "current"
                              ? "0 0 0 4px var(--df-brand-soft)"
                              : "none",
                        }}
                      >
                        {status === "done" ? <Check size={20} /> : i + 1}
                      </div>
                      {!isLast && (
                        <div
                          style={{
                            width: 2,
                            flex: 1,
                            background:
                              status === "done"
                                ? "var(--df-success)"
                                : "var(--df-line)",
                            marginTop: 4,
                          }}
                        />
                      )}
                    </div>
                    <div
                      style={{
                        flex: 1,
                        padding: 16,
                        marginBottom: 16,
                        background:
                          status === "current"
                            ? "linear-gradient(135deg, #EFF3FC, #FFFFFF)"
                            : "var(--df-surface)",
                        borderRadius: 12,
                        border: `1px solid ${status === "current" ? "var(--df-brand-soft)" : "var(--df-line)"}`,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: 10,
                          gap: 12,
                          flexWrap: "wrap",
                        }}
                      >
                        <div
                          style={{ display: "flex", alignItems: "center", gap: 10 }}
                        >
                          <DfAvatar
                            initials={initials(userName)}
                            color={color}
                            size="md"
                          />
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 600 }}>
                              {userName}
                            </div>
                            <div
                              style={{ fontSize: 12, color: "var(--df-muted)" }}
                            >
                              {ROLE_LABEL[role] ?? role}
                            </div>
                          </div>
                        </div>
                        {status === "done" && (
                          <DfPill tone="success" small>
                            <Check size={11} /> เซ็นแล้ว
                          </DfPill>
                        )}
                        {status === "current" && (
                          <DfPill tone="brand" small>
                            <Clock size={11} /> รอเซ็น
                          </DfPill>
                        )}
                        {status === "pending" && (
                          <DfPill tone="outline" small>
                            รอ
                          </DfPill>
                        )}
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(3, 1fr)",
                          gap: 8,
                          fontSize: 11,
                        }}
                      >
                        <div>
                          <div style={{ color: "var(--df-muted)" }}>
                            ยืนยันด้วย
                          </div>
                          <div style={{ fontWeight: 600 }}>OTP + Session</div>
                        </div>
                        <div>
                          <div style={{ color: "var(--df-muted)" }}>
                            หน้าที่ลงเซ็น
                          </div>
                          <div style={{ fontWeight: 600 }}>
                            หน้า {p.pageNumber} · จุด {i + 1}
                          </div>
                        </div>
                        <div>
                          <div style={{ color: "var(--df-muted)" }}>
                            เวลาที่ใช้
                          </div>
                          <div className="df-tnum" style={{ fontWeight: 600 }}>
                            {p.signedAt
                              ? bkkRelative(p.signedAt)
                              : status === "current"
                                ? "รออยู่"
                                : "—"}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {adminTier && (
                <div
                  style={{
                    marginTop: 8,
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1.5px dashed var(--df-line)",
                    color: "var(--df-muted)",
                    fontSize: 13,
                    textAlign: "center",
                  }}
                >
                  <Plus
                    size={14}
                    style={{ display: "inline-block", marginRight: 6 }}
                  />
                  เพิ่มขั้นตอน — แก้ไขจากหน้า /signatures
                </div>
              )}
            </div>
          )}
        </DfCard>

        {/* RIGHT — settings + templates */}
        <div
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
          className="df-fade-up df-fade-up-200"
        >
          <DfCard padding={22}>
            <DfEyebrow>ตั้งค่า Workflow</DfEyebrow>
            <div style={{ marginTop: 14, marginBottom: 14 }}>
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--df-muted)",
                  letterSpacing: "0.05em",
                  marginBottom: 8,
                }}
              >
                ใช้กับประเภทเอกสาร
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <DfPill tone="brand" small>
                  สัญญาเช่า
                </DfPill>
                <DfPill tone="brand" small>
                  สัญญาซื้อขาย
                </DfPill>
                <DfPill tone="outline" small>
                  + เพิ่ม
                </DfPill>
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--df-muted)",
                  letterSpacing: "0.05em",
                  marginBottom: 8,
                }}
              >
                เงื่อนไขเริ่ม workflow
              </p>
              <div
                className="df-input"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                }}
              >
                วงเงิน &gt; ฿50,000
              </div>
              <div className="df-hint">ถ้าวงเงินต่ำกว่า — workflow แบบเร็ว 1 คนเซ็น</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--df-muted)",
                  letterSpacing: "0.05em",
                  marginBottom: 8,
                }}
              >
                ระยะเวลาที่ให้แต่ละขั้น
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <div className="df-input" style={{ flex: 1, fontSize: 13 }}>
                  3 วันทำการ
                </div>
                <div className="df-input" style={{ flex: 1, fontSize: 13 }}>
                  ส่งเตือนสำรอง
                </div>
              </div>
            </div>
            <div>
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--df-muted)",
                  letterSpacing: "0.05em",
                  marginBottom: 8,
                }}
              >
                การส่งแจ้งเตือน
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  ["Line", true],
                  ["Email", true],
                  ["SMS", false],
                ].map(([n, on], i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 12px",
                      background: "var(--df-surface-soft)",
                      borderRadius: 8,
                    }}
                  >
                    <span style={{ fontSize: 13 }}>{n as string}</span>
                    <div
                      style={{
                        width: 36,
                        height: 20,
                        borderRadius: 99,
                        background: on
                          ? "var(--df-success)"
                          : "var(--df-line)",
                        position: "relative",
                      }}
                    >
                      <div
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 99,
                          background: "#fff",
                          position: "absolute",
                          top: 2,
                          left: on ? 18 : 2,
                          boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </DfCard>

          {/* Templates */}
          <DfCard padding={18}>
            <DfEyebrow>เทมเพลต workflow</DfEyebrow>
            <div style={{ marginTop: 12 }}>
              {TEMPLATES.map((t, i) => (
                <div
                  key={i}
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    marginBottom: 6,
                    background: t.active
                      ? "var(--df-brand-soft)"
                      : "var(--df-surface-soft)",
                    border: t.active
                      ? "1px solid var(--df-brand)"
                      : "1px solid transparent",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  {t.active ? (
                    <CheckCircle2
                      size={16}
                      style={{ color: "var(--df-brand)" }}
                    />
                  ) : (
                    <FileText size={16} style={{ color: "var(--df-muted)" }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>
                      {t.name}
                    </div>
                    <div
                      style={{ fontSize: 10, color: "var(--df-muted)" }}
                    >
                      {t.desc}
                    </div>
                  </div>
                  <div
                    className="df-tnum"
                    style={{ fontSize: 10, color: "var(--df-muted)" }}
                  >
                    ใช้ {t.used}
                  </div>
                </div>
              ))}
            </div>
          </DfCard>
        </div>
      </div>

      <style>{`
        @media (max-width: 980px) {
          .df-grid-2col { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
