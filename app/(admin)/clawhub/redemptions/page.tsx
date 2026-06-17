// ClawHub (JOLLY PLAY) — redemption fulfilment. Staff finds a PENDING redemption
// (filter or pickup-code lookup) and marks it จ่ายแล้ว.

import { prisma } from "@/lib/prisma";
import { clawhubOrgId } from "@/lib/clawhub/org";
import { ClawhubRedemptionStatus } from "@/lib/generated/prisma/client";
import { PageHeader, FilterTabs, EmptyState, RedemptionStatusBadge } from "../_components/ui";
import { fmtDateTime, fmtNum } from "../_lib";
import { FulfillButton } from "./_fulfill-button";

export const dynamic = "force-dynamic";

function isRedemptionStatus(v: string): v is ClawhubRedemptionStatus {
  return (Object.values(ClawhubRedemptionStatus) as string[]).includes(v);
}

export default async function ClawhubRedemptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; code?: string }>;
}) {
  const sp = await searchParams;
  const orgId = await clawhubOrgId();
  const code = (sp.code ?? "").trim().toUpperCase();
  const current =
    sp.status && isRedemptionStatus(sp.status) ? sp.status : sp.status === "" ? "" : "PENDING";
  const statusFilter = current === "" ? undefined : (current as ClawhubRedemptionStatus);

  const [counts, rows] = await Promise.all([
    prisma.clawhubRedemption.groupBy({
      by: ["status"],
      where: { orgId },
      _count: { _all: true },
    }),
    prisma.clawhubRedemption.findMany({
      where: {
        orgId,
        ...(code ? { pickupCode: { equals: code, mode: "insensitive" } } : {}),
        ...(!code && statusFilter ? { status: statusFilter } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 150,
      include: {
        member: { select: { displayName: true, memberCode: true, phone: true } },
      },
    }),
  ]);

  const countByStatus = new Map(counts.map((c) => [c.status, c._count._all]));
  const totalAll = counts.reduce((s, c) => s + c._count._all, 0);

  const tabs = [
    { value: "PENDING", label: "รอจ่ายของ", count: countByStatus.get("PENDING") ?? 0 },
    { value: "FULFILLED", label: "จ่ายแล้ว", count: countByStatus.get("FULFILLED") ?? 0 },
    { value: "CANCELLED", label: "ยกเลิก", count: countByStatus.get("CANCELLED") ?? 0 },
    { value: "", label: "ทั้งหมด", count: totalAll },
  ];

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="การ"
        accent="แลกของ"
        subtitle="ค้นรหัสรับของจากลูกค้า แล้วกดจ่ายของ"
      />

      {/* Pickup-code lookup */}
      <form className="mb-4 flex gap-2" action="/clawhub/redemptions" method="get">
        <input
          type="text"
          name="code"
          defaultValue={code}
          placeholder="พิมพ์รหัสรับของ เช่น JP-7K3Q"
          className="w-full max-w-xs rounded-full border px-4 py-2.5 text-sm uppercase"
          style={{ borderColor: "var(--cw-border)", background: "var(--cw-surface)" }}
        />
        <button type="submit" className="cw-btn">
          ค้นหา
        </button>
      </form>

      {!code ? (
        <FilterTabs tabs={tabs} current={current} basePath="/clawhub/redemptions" />
      ) : (
        <p className="mb-3 text-sm" style={{ color: "var(--cw-text-2)" }}>
          ผลค้นหารหัส <b>{code}</b>
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState>{code ? "ไม่พบรหัสรับของนี้" : "ไม่มีรายการ"}</EmptyState>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="cw-card flex flex-wrap items-center gap-4 p-4">
              {r.productImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={r.productImageUrl}
                  alt={r.productName ?? "ของรางวัล"}
                  className="h-16 w-16 rounded-lg border object-cover"
                  style={{ borderColor: "var(--cw-border)" }}
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="cw-tnum text-lg font-extrabold" style={{ color: "var(--cw-brand-700)" }}>
                    {r.pickupCode}
                  </span>
                  <RedemptionStatusBadge status={r.status} />
                </div>
                <div className="mt-1 text-sm font-semibold">{r.productName ?? "—"}</div>
                <div className="text-xs" style={{ color: "var(--cw-text-2)" }}>
                  {r.member.displayName ?? "—"} · {r.member.memberCode}
                  {r.member.phone ? ` · ${r.member.phone}` : ""} · ใช้{" "}
                  <span className="cw-tnum">{fmtNum(r.pointsSpent)}</span> แต้ม ·{" "}
                  {fmtDateTime(r.createdAt)}
                </div>
                {r.status === "FULFILLED" && r.fulfilledAt ? (
                  <div className="text-xs" style={{ color: "var(--cw-ok)" }}>
                    จ่ายเมื่อ {fmtDateTime(r.fulfilledAt)}
                  </div>
                ) : null}
              </div>
              <div className="ml-auto">
                {r.status === "PENDING" ? (
                  <FulfillButton redemptionId={r.id} />
                ) : (
                  <RedemptionStatusBadge status={r.status} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
