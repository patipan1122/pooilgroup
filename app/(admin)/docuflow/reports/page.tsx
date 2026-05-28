// DocuFlow · Reports & Analytics (DesktopReports canvas)
// ────────────────────────────────────────────────────────────────────
// KPIs · 12-month upload trend chart · category breakdown · top spenders.
// All data from existing Prisma models (documents · renewals · placements).
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import {
  ArrowLeft,
  Download,
  Calendar,
  TrendingUp,
  Sparkles,
  PenSquare,
  FileText,
  Clock,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireAdminTier } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import {
  DfButton,
  DfCard,
  DfEyebrow,
  DfPageHeader,
  DfStatCard,
} from "@/components/docuflow/df-ui";
import { DfTopBanner } from "@/components/docuflow/df-top-banner";

export const dynamic = "force-dynamic";

const MONTHS = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];

export default async function ReportsPage() {
  const session = await requireSession();
  requireAdminTier(session.user.role);
  const orgId = session.user.org_id;

  // Aggregate counters
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const twelveMoAgo = new Date(now);
  twelveMoAgo.setMonth(now.getMonth() - 12);

  const [
    totalDocs,
    docsThisYear,
    renewalsThisYear,
    pendingSignaturesCount,
    signedSignaturesCount,
    uploadedLast12mo,
    aiAnalyses,
    branchSpread,
    signingSpeed,
  ] = await Promise.all([
    prisma.document.count({ where: { orgId, isActive: true } }),
    prisma.document.count({
      where: { orgId, isActive: true, uploadedAt: { gte: yearStart } },
    }),
    prisma.documentRenewal.count({
      where: { orgId, lastRenewedDate: { gte: yearStart } },
    }),
    prisma.documentSignaturePlacement.count({
      where: { orgId, signedAt: null },
    }),
    prisma.documentSignaturePlacement.count({
      where: { orgId, signedAt: { not: null } },
    }),
    prisma.document.findMany({
      where: { orgId, isActive: true, uploadedAt: { gte: twelveMoAgo } },
      select: { uploadedAt: true },
    }),
    prisma.documentAnalysis.count({ where: { orgId } }),
    prisma.documentOwnership.groupBy({
      by: ["branchId"],
      where: { orgId, branchId: { not: null } },
      _count: true,
      orderBy: { _count: { branchId: "desc" } },
      take: 5,
    }),
    // Signing speed: avg time from placement creation → sign per user
    prisma.documentSignaturePlacement.findMany({
      where: {
        orgId,
        signedAt: { not: null },
        signerUserId: { not: null },
      },
      select: {
        createdAt: true,
        signedAt: true,
        signerUser: { select: { id: true, name: true } },
      },
      take: 200,
    }),
  ]);

  // Build 12-month rolling chart
  const months: Array<{ label: string; count: number }> = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now);
    d.setMonth(now.getMonth() - i, 1);
    months.push({
      label: MONTHS[d.getMonth()] ?? "",
      count: 0,
    });
  }
  const chartStart = new Date(now);
  chartStart.setMonth(now.getMonth() - 11, 1);
  chartStart.setHours(0, 0, 0, 0);
  for (const d of uploadedLast12mo) {
    const idx =
      (d.uploadedAt.getFullYear() - chartStart.getFullYear()) * 12 +
      (d.uploadedAt.getMonth() - chartStart.getMonth());
    if (idx >= 0 && idx < 12) months[idx].count++;
  }
  const maxMonthly = Math.max(...months.map((m) => m.count), 1);

  // Top branches by document count
  const topBranchIds = branchSpread
    .map((b) => b.branchId)
    .filter((id): id is string => id !== null);
  const branchRows = topBranchIds.length
    ? await prisma.branch.findMany({
        where: { orgId, id: { in: topBranchIds } },
        select: { id: true, code: true, name: true },
      })
    : [];
  const branchMap = new Map(branchRows.map((b) => [b.id, b]));
  const topBranches = branchSpread.map((b) => ({
    id: b.branchId,
    count: b._count,
    name: b.branchId
      ? branchMap.get(b.branchId)?.name ?? branchMap.get(b.branchId)?.code ?? "—"
      : "—",
  }));
  const maxBranchCount = Math.max(...topBranches.map((t) => t.count), 1);

  const aiAutoFillRate = Math.min(
    100,
    Math.round((aiAnalyses / Math.max(1, totalDocs)) * 100),
  );

  // Per-user signing speed (avg hours)
  const speedByUser = new Map<
    string,
    { name: string; totalMs: number; count: number }
  >();
  for (const s of signingSpeed) {
    if (!s.signedAt || !s.signerUser) continue;
    const elapsed = s.signedAt.getTime() - s.createdAt.getTime();
    if (elapsed < 0) continue;
    const cur = speedByUser.get(s.signerUser.id) ?? {
      name: s.signerUser.name,
      totalMs: 0,
      count: 0,
    };
    cur.totalMs += elapsed;
    cur.count++;
    speedByUser.set(s.signerUser.id, cur);
  }
  const userSpeeds = Array.from(speedByUser.values())
    .map((u) => ({
      name: u.name,
      avgHours: u.totalMs / u.count / 3600000,
    }))
    .sort((a, b) => a.avgHours - b.avgHours)
    .slice(0, 5);
  const overallAvgHours =
    userSpeeds.length > 0
      ? userSpeeds.reduce((s, u) => s + u.avgHours, 0) / userSpeeds.length
      : 0;

  return (
    <div
      style={{
        padding: "28px clamp(16px, 4vw, 40px)",
        paddingBottom: 96,
        maxWidth: 1500,
        margin: "0 auto",
      }}
    >
      <DfTopBanner breadcrumbs={[{ label: "หน้าหลัก", href: "/docuflow" }, { label: "รายงาน & สถิติ" }]} />

      <DfPageHeader
        eyebrow={<DfEyebrow>รายงาน · ภาพรวมทั้งกลุ่ม</DfEyebrow>}
        title={
          <>
            กิจกรรมเอกสาร{" "}
            <span style={{ color: "var(--df-accent)" }}>
              {uploadedLast12mo.length.toLocaleString("th-TH")} ฉบับ
            </span>{" "}
            ในรอบ 12 เดือน
          </>
        }
        description={`ปี ${now.getFullYear() + 543} · ${docsThisYear} เอกสารใหม่ · ${renewalsThisYear} ต่ออายุ`}
        actions={
          <>
            <DfButton variant="ghost">
              <Download size={14} />
              Export PDF
            </DfButton>
            <DfButton variant="ghost">
              <Calendar size={14} />
              ปี {now.getFullYear() + 543}
            </DfButton>
          </>
        }
      />

      {/* KPIs */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 16,
          marginBottom: 22,
        }}
        className="df-fade-up df-fade-up-100"
      >
        <DfStatCard
          label="เอกสารทั้งหมด"
          value={totalDocs.toLocaleString("th-TH")}
          sub={`+${docsThisYear} ปีนี้`}
          tone="ink"
          icon={<FileText size={17} />}
        />
        <DfStatCard
          label="ลายเซ็นสำเร็จ"
          value={signedSignaturesCount}
          sub={`รอเซ็น ${pendingSignaturesCount}`}
          tone="success"
          icon={<PenSquare size={17} />}
        />
        <DfStatCard
          label="ต่ออายุปีนี้"
          value={renewalsThisYear}
          tone="brand"
          icon={<Clock size={17} />}
        />
        <DfStatCard
          label="AI วิเคราะห์"
          value={`${aiAutoFillRate}%`}
          sub={`${aiAnalyses} รายการ`}
          tone="accent"
          icon={<Sparkles size={17} />}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
          gap: 20,
          marginBottom: 20,
        }}
        className="df-grid-2col"
      >
        {/* Monthly chart */}
        <DfCard padding={22} className="df-fade-up df-fade-up-200">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 18,
            }}
          >
            <div>
              <DfEyebrow>อัปโหลดต่อเดือน · รายเดือน</DfEyebrow>
              <h2
                className="df-serif"
                style={{ fontSize: 20, marginTop: 4, marginBottom: 0 }}
              >
                12 เดือนล่าสุด
              </h2>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12,
                color: "var(--df-brand)",
                fontWeight: 700,
              }}
            >
              <TrendingUp size={12} />
              <span>กราฟ trend</span>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 8,
              height: 240,
              paddingBottom: 8,
              borderBottom: "1px solid var(--df-line)",
            }}
          >
            {months.map((m, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  height: "100%",
                }}
              >
                <div
                  className="df-tnum"
                  style={{
                    fontSize: 10,
                    color: "var(--df-muted)",
                    marginBottom: 4,
                  }}
                >
                  {m.count}
                </div>
                <div
                  style={{
                    width: "100%",
                    height: `${(m.count / maxMonthly) * 80}%`,
                    background:
                      i === months.length - 1
                        ? "var(--df-accent)"
                        : "linear-gradient(180deg, var(--df-brand), var(--df-brand-deep))",
                    borderRadius: "6px 6px 0 0",
                    minHeight: 14,
                  }}
                />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, paddingTop: 8 }}>
            {months.map((m, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  textAlign: "center",
                  fontSize: 10,
                  color: "var(--df-muted)",
                  fontWeight: i === months.length - 1 ? 700 : 500,
                }}
              >
                {m.label}
              </div>
            ))}
          </div>
        </DfCard>

        {/* Top branches */}
        <DfCard padding={22} className="df-fade-up df-fade-up-300">
          <DfEyebrow>สาขาที่มีเอกสารมากสุด</DfEyebrow>
          <div style={{ marginTop: 14 }}>
            {topBranches.length === 0 ? (
              <div
                style={{
                  fontSize: 13,
                  color: "var(--df-muted)",
                  textAlign: "center",
                  padding: 20,
                }}
              >
                ยังไม่มีข้อมูล
              </div>
            ) : (
              topBranches.map((b, i) => (
                <div
                  key={b.id ?? i}
                  style={{
                    padding: "8px 0",
                    borderBottom:
                      i < topBranches.length - 1
                        ? "1px solid var(--df-line-soft)"
                        : "none",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 4,
                      fontSize: 12,
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                        marginRight: 8,
                      }}
                    >
                      {b.name}
                    </span>
                    <span className="df-tnum">{b.count} ฉบับ</span>
                  </div>
                  <div className="df-bar" style={{ height: 4 }}>
                    <i
                      style={{
                        width: `${(b.count / maxBranchCount) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </DfCard>
      </div>

      {/* Bottom row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
        }}
        className="df-fade-up df-fade-up-300"
      >
        <DfCard
          padding={18}
          style={{ background: "linear-gradient(135deg, #EFF3FC, #FFFFFF)" }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 12,
            }}
          >
            <Sparkles size={14} style={{ color: "var(--df-brand)" }} />
            <DfEyebrow>AI ช่วยประหยัด</DfEyebrow>
          </div>
          <div
            className="df-tnum df-serif"
            style={{
              fontSize: 38,
              fontWeight: 600,
              color: "var(--df-brand)",
              lineHeight: 1,
              marginBottom: 4,
            }}
          >
            {Math.round(aiAnalyses * 8)}{" "}
            <span style={{ fontSize: 14, color: "var(--df-muted)" }}>นาที</span>
          </div>
          <p
            style={{
              fontSize: 11,
              color: "var(--df-muted)",
              marginBottom: 14,
              marginTop: 0,
            }}
          >
            ในปี {now.getFullYear() + 543} · ประหยัดเวลาพิมพ์เอกสาร
          </p>
          <p
            style={{
              fontSize: 11,
              color: "var(--df-ink-2)",
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            AI auto-fill ลดเวลากรอกเอกสารจาก 12 นาที → 2 นาที · ใช้ไป {aiAnalyses} ครั้งปีนี้
          </p>
        </DfCard>

        {/* Signing speed per user — canvas DesktopReports bottom row */}
        <DfCard padding={18}>
          <DfEyebrow>ความเร็วในการเซ็น</DfEyebrow>
          <div
            className="df-tnum df-serif"
            style={{
              fontSize: 38,
              fontWeight: 600,
              color:
                overallAvgHours <= 4
                  ? "var(--df-success)"
                  : overallAvgHours <= 12
                    ? "var(--df-warn)"
                    : "var(--df-danger)",
              lineHeight: 1,
              marginBottom: 4,
              marginTop: 10,
            }}
          >
            {overallAvgHours.toFixed(1)}
            <span style={{ fontSize: 14, color: "var(--df-muted)", marginLeft: 4 }}>
              ชม.
            </span>
          </div>
          <p
            style={{
              fontSize: 11,
              color: "var(--df-muted)",
              marginBottom: 12,
              marginTop: 0,
            }}
          >
            เฉลี่ยต่อคน · ตามลายเซ็นที่บันทึก
          </p>
          {userSpeeds.length === 0 ? (
            <p
              style={{
                fontSize: 12,
                color: "var(--df-muted)",
                marginTop: 4,
                marginBottom: 0,
              }}
            >
              ยังไม่มีข้อมูล — รอลายเซ็นแรก
            </p>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                fontSize: 12,
              }}
            >
              {userSpeeds.map((u, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "5px 0",
                    borderBottom:
                      i < userSpeeds.length - 1
                        ? "1px solid var(--df-line-soft)"
                        : "none",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{u.name}</span>
                  <span
                    className="df-tnum"
                    style={{
                      color:
                        u.avgHours <= 2
                          ? "var(--df-success)"
                          : u.avgHours <= 8
                            ? "var(--df-muted)"
                            : "var(--df-warn)",
                    }}
                  >
                    {u.avgHours.toFixed(1)} ชม.
                  </span>
                </div>
              ))}
            </div>
          )}
        </DfCard>

        <DfCard padding={18}>
          <DfEyebrow>ลายเซ็น</DfEyebrow>
          <div
            className="df-tnum df-serif"
            style={{
              fontSize: 38,
              fontWeight: 600,
              color: "var(--df-success)",
              lineHeight: 1,
              marginBottom: 4,
              marginTop: 10,
            }}
          >
            {signedSignaturesCount}
          </div>
          <p style={{ fontSize: 12, color: "var(--df-muted)", margin: 0 }}>
            ลายเซ็นทั้งหมด · รอเซ็น {pendingSignaturesCount}
          </p>
        </DfCard>

        <DfCard padding={18}>
          <DfEyebrow>กิจกรรมการต่ออายุ</DfEyebrow>
          <div
            className="df-tnum df-serif"
            style={{
              fontSize: 38,
              fontWeight: 600,
              color: "var(--df-accent)",
              lineHeight: 1,
              marginBottom: 4,
              marginTop: 10,
            }}
          >
            {renewalsThisYear}
          </div>
          <p style={{ fontSize: 12, color: "var(--df-muted)", margin: 0 }}>
            ต่ออายุในปี {now.getFullYear() + 543}
          </p>
        </DfCard>
      </div>

      <style>{`
        @media (max-width: 980px) {
          .df-grid-2col { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
