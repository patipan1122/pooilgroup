// ClawHub (JOLLY PLAY) — refund review queue + history.
//
// The PENDING_REVIEW tab is the staff's daily work: each card shows the machine
// screenshot, what the customer claimed vs what AI read, the member's history, and
// อนุมัติ/ปฏิเสธ buttons. Other tabs are read-only history with search.
//
// SCREENSHOT DISPLAY (PDPA): refund photos are private member data. We do NOT expose
// the public R2 url; instead we mint a short-lived (15 min) SIGNED GET url server-side
// via getSignedDownloadUrl (lib/docuflow/r2.ts, the repo's private-evidence pattern)
// and pass only that signed url to the client card.

import { prisma } from "@/lib/prisma";
import { clawhubOrgId } from "@/lib/clawhub/org";
import { getSignedDownloadUrl } from "@/lib/docuflow/r2";
import { ClawhubRefundStatus } from "@/lib/generated/prisma/client";
import { PageHeader, FilterTabs, EmptyState } from "../_components/ui";
import { fmtDateTime, fmtConfidence } from "../_lib";
import { RefundCard, type RefundCardData } from "./_refund-card";

export const dynamic = "force-dynamic";

const TAB_VALUES: (ClawhubRefundStatus | "")[] = [
  "PENDING_REVIEW",
  "",
  "AUTO_APPROVED",
  "APPROVED",
  "REJECTED",
];

function isRefundStatus(v: string): v is ClawhubRefundStatus {
  return (Object.values(ClawhubRefundStatus) as string[]).includes(v);
}

/** Best-effort signed URL for a screenshot key; null on any failure (never throws). */
async function signedUrl(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  try {
    return await getSignedDownloadUrl(key, 900); // 15 min
  } catch {
    return null;
  }
}

export default async function ClawhubRefundsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const orgId = await clawhubOrgId();
  const current = sp.status && isRefundStatus(sp.status) ? sp.status : "PENDING_REVIEW";
  const q = (sp.q ?? "").trim();
  // The "all history" tab uses status="" → no status filter.
  const statusFilter = sp.status === "" ? undefined : current;

  const [counts, rows] = await Promise.all([
    prisma.clawhubRefundRequest.groupBy({
      by: ["status"],
      where: { orgId },
      _count: { _all: true },
    }),
    prisma.clawhubRefundRequest.findMany({
      where: {
        orgId,
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(q
          ? {
              member: {
                OR: [
                  { displayName: { contains: q, mode: "insensitive" } },
                  { memberCode: { contains: q, mode: "insensitive" } },
                  { phone: { contains: q } },
                ],
              },
            }
          : {}),
      },
      orderBy: { createdAt: current === "PENDING_REVIEW" ? "asc" : "desc" },
      take: 100,
      include: {
        member: {
          select: {
            displayName: true,
            memberCode: true,
            refundCount: true,
            pointsBalance: true,
          },
        },
      },
    }),
  ]);

  const countByStatus = new Map(counts.map((c) => [c.status, c._count._all]));
  const totalAll = counts.reduce((s, c) => s + c._count._all, 0);

  const tabs = TAB_VALUES.map((v) => {
    if (v === "")
      return { value: "", label: "ทั้งหมด", count: totalAll };
    const label =
      v === "PENDING_REVIEW"
        ? "รอตรวจ"
        : v === "AUTO_APPROVED"
          ? "อัตโนมัติ"
          : v === "APPROVED"
            ? "อนุมัติ"
            : "ปฏิเสธ";
    return { value: v, label, count: countByStatus.get(v) ?? 0 };
  });

  const cards: RefundCardData[] = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      status: r.status,
      screenshotUrl: await signedUrl(r.screenshotR2Key),
      claimedBaht: r.claimedBaht,
      aiReadBaht: r.aiReadBaht,
      aiConfidence: fmtConfidence(r.aiConfidence),
      machineCode: r.machineCode,
      branchId: r.branchId,
      decisionReason: r.decisionReason,
      createdAt: fmtDateTime(r.createdAt),
      pointsAwarded: r.pointsAwarded,
      reviewNote: r.reviewNote,
      member: {
        name: r.member.displayName ?? "(ไม่มีชื่อ)",
        code: r.member.memberCode,
        refundCount: r.member.refundCount,
        pointsBalance: r.member.pointsBalance,
      },
    })),
  );

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="คำขอ"
        accent="คืนแต้ม"
        subtitle="ตรวจคำขอคืนแต้มตู้คีบ · เทียบยอดที่ลูกค้ากรอกกับที่ AI อ่านได้"
      />

      <FilterTabs tabs={tabs} current={sp.status === "" ? "" : current} basePath="/clawhub/refunds" />

      {/* Search (history search by member) */}
      <form className="mb-4" action="/clawhub/refunds" method="get">
        {sp.status !== undefined ? (
          <input type="hidden" name="status" value={sp.status} />
        ) : null}
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="ค้นหาสมาชิก (ชื่อ / รหัส CH- / เบอร์)"
          className="w-full max-w-md rounded-full border px-4 py-2.5 text-sm"
          style={{ borderColor: "var(--cw-border)", background: "var(--cw-surface)" }}
        />
      </form>

      {cards.length === 0 ? (
        <EmptyState>
          {current === "PENDING_REVIEW"
            ? "ไม่มีคำขอรอตรวจ — เคลียร์หมดแล้ว 🎉"
            : "ไม่พบรายการตามเงื่อนไข"}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {cards.map((c) => (
            <RefundCard key={c.id} data={c} />
          ))}
        </div>
      )}
    </div>
  );
}
