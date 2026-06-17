// ClawHub (JOLLY PLAY) — member detail: profile + point history + refunds + redemptions.

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { clawhubOrgId } from "@/lib/clawhub/org";
import { availableBalance } from "@/lib/clawhub/points";
import {
  PageHeader,
  StatCard,
  RefundStatusBadge,
  RedemptionStatusBadge,
} from "../../_components/ui";
import { fmtDateTime, fmtNum } from "../../_lib";
import { BlockButton } from "./_block-button";

export const dynamic = "force-dynamic";

const POINT_KIND_LABEL: Record<string, string> = {
  EARN_REFUND: "ได้แต้ม (คืนตู้)",
  REDEEM: "ใช้แต้ม (แลกของ)",
  EXPIRE: "หมดอายุ",
  ADJUST: "ปรับมือ",
};

export default async function ClawhubMemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const orgId = await clawhubOrgId();

  const member = await prisma.clawhubMember.findUnique({ where: { id } });
  if (!member || member.orgId !== orgId) notFound();

  const [available, points, refunds, redemptions] = await Promise.all([
    availableBalance(member.id),
    prisma.clawhubPointEntry.findMany({
      where: { memberId: member.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.clawhubRefundRequest.findMany({
      where: { memberId: member.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.clawhubRedemption.findMany({
      where: { memberId: member.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  return (
    <div className="p-4 sm:p-6">
      <Link
        href="/clawhub/members"
        className="mb-3 inline-block text-sm"
        style={{ color: "var(--cw-text-2)" }}
      >
        ← กลับรายชื่อสมาชิก
      </Link>

      <PageHeader
        title={member.displayName ?? "(ไม่มีชื่อ)"}
        subtitle={`${member.memberCode}${member.phone ? ` · ${member.phone}` : ""}${
          member.blockedAt ? " · ⛔ ระงับอยู่" : ""
        }`}
        right={<BlockButton memberId={member.id} blocked={!!member.blockedAt} />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="แต้มคงเหลือ (cache)" value={fmtNum(member.pointsBalance)} tone="brand" />
        <StatCard label="แต้มใช้ได้จริง (ยังไม่หมดอายุ)" value={fmtNum(available)} tone="ok" />
        <StatCard label="คืนแต้มทั้งหมด" value={fmtNum(member.refundCount)} />
        <StatCard label="สมัครเมื่อ" value={fmtDateTime(member.createdAt)} />
      </div>

      {/* Point history */}
      <Section title="ประวัติแต้ม">
        {points.length === 0 ? (
          <Muted>ยังไม่มีรายการแต้ม</Muted>
        ) : (
          <SimpleTable
            head={["เวลา", "ประเภท", "แต้ม", "คงเหลือในล็อต", "หมายเหตุ"]}
            rows={points.map((p) => [
              fmtDateTime(p.createdAt),
              POINT_KIND_LABEL[p.kind] ?? p.kind,
              <span key="d" className={`cw-tnum font-bold`} style={{ color: p.delta >= 0 ? "var(--cw-ok)" : "var(--cw-danger)" }}>
                {p.delta >= 0 ? "+" : ""}
                {p.delta}
              </span>,
              <span key="r" className="cw-tnum">{p.remainingPoints}</span>,
              p.note ?? p.refType ?? "—",
            ])}
            right={[false, false, true, true, false]}
          />
        )}
      </Section>

      {/* Refund history */}
      <Section title="ประวัติคำขอคืนแต้ม">
        {refunds.length === 0 ? (
          <Muted>ยังไม่มีคำขอคืนแต้ม</Muted>
        ) : (
          <SimpleTable
            head={["เวลา", "สถานะ", "ลูกค้ากรอก", "AI อ่าน", "ได้แต้ม", "ตู้"]}
            rows={refunds.map((r) => [
              fmtDateTime(r.createdAt),
              <RefundStatusBadge key="s" status={r.status} />,
              <span key="c" className="cw-tnum">{r.claimedBaht}฿</span>,
              <span key="a" className="cw-tnum">{r.aiReadBaht != null ? `${r.aiReadBaht}฿` : "—"}</span>,
              <span key="p" className="cw-tnum">{r.pointsAwarded}</span>,
              r.machineCode ?? "—",
            ])}
            right={[false, false, true, true, true, false]}
          />
        )}
      </Section>

      {/* Redemptions */}
      <Section title="ประวัติการแลกของ">
        {redemptions.length === 0 ? (
          <Muted>ยังไม่มีการแลกของ</Muted>
        ) : (
          <SimpleTable
            head={["เวลา", "สถานะ", "ของ", "ใช้แต้ม", "รหัสรับของ"]}
            rows={redemptions.map((r) => [
              fmtDateTime(r.createdAt),
              <RedemptionStatusBadge key="s" status={r.status} />,
              r.productName ?? "—",
              <span key="p" className="cw-tnum">{r.pointsSpent}</span>,
              <span key="c" className="cw-tnum font-bold">{r.pickupCode}</span>,
            ])}
            right={[false, false, false, true, false]}
          />
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <h2 className="cw-title mb-2 text-lg">{title}</h2>
      <div className="cw-card overflow-x-auto">{children}</div>
    </div>
  );
}
function Muted({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-6 text-center text-sm" style={{ color: "var(--cw-text-3)" }}>
      {children}
    </div>
  );
}
function SimpleTable({
  head,
  rows,
  right,
}: {
  head: string[];
  rows: React.ReactNode[][];
  right?: boolean[];
}) {
  return (
    <table className="cw-table w-full text-sm">
      <thead>
        <tr style={{ color: "var(--cw-text-2)" }}>
          {head.map((h, i) => (
            <th
              key={h}
              className={`px-3 py-2.5 text-xs font-semibold ${right?.[i] ? "text-right" : "text-left"}`}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="border-t" style={{ borderColor: "var(--cw-border)" }}>
            {r.map((cell, ci) => (
              <td key={ci} className={`px-3 py-2.5 ${right?.[ci] ? "text-right" : "text-left"}`}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
