// ClawHub (JOLLY PLAY) — members list (searchable). Click a row → detail page.

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { clawhubOrgId } from "@/lib/clawhub/org";
import { PageHeader, EmptyState } from "../_components/ui";
import { fmtDate, fmtNum } from "../_lib";

export const dynamic = "force-dynamic";

export default async function ClawhubMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const orgId = await clawhubOrgId();

  const members = await prisma.clawhubMember.findMany({
    where: {
      orgId,
      ...(q
        ? {
            OR: [
              { displayName: { contains: q, mode: "insensitive" } },
              { memberCode: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      memberCode: true,
      displayName: true,
      phone: true,
      pointsBalance: true,
      refundCount: true,
      blockedAt: true,
      createdAt: true,
    },
  });

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="สมาชิก" accent="JOLLY PLAY" subtitle={`${fmtNum(members.length)} รายแสดงผล`} />

      <form className="mb-4" action="/clawhub/members" method="get">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="ค้นหา (ชื่อ / รหัส CH- / เบอร์)"
          className="w-full max-w-md rounded-full border px-4 py-2.5 text-sm"
          style={{ borderColor: "var(--cw-border)", background: "var(--cw-surface)" }}
        />
      </form>

      {members.length === 0 ? (
        <EmptyState>ไม่พบสมาชิก</EmptyState>
      ) : (
        <div className="cw-card overflow-x-auto">
          <table className="cw-table w-full text-sm">
            <thead>
              <tr style={{ color: "var(--cw-text-2)" }}>
                <Th>รหัส</Th>
                <Th>ชื่อ</Th>
                <Th>เบอร์</Th>
                <Th right>แต้มคงเหลือ</Th>
                <Th right>คืนแต้ม</Th>
                <Th>สมัครเมื่อ</Th>
                <Th>สถานะ</Th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr
                  key={m.id}
                  className="border-t"
                  style={{ borderColor: "var(--cw-border)" }}
                >
                  <Td>
                    <Link
                      href={`/clawhub/members/${m.id}`}
                      className="font-semibold"
                      style={{ color: "var(--cw-brand-700)" }}
                    >
                      {m.memberCode}
                    </Link>
                  </Td>
                  <Td>{m.displayName ?? "—"}</Td>
                  <Td>{m.phone ?? "—"}</Td>
                  <Td right>
                    <span className="cw-tnum font-bold">{fmtNum(m.pointsBalance)}</span>
                  </Td>
                  <Td right>
                    <span className="cw-tnum">{fmtNum(m.refundCount)}</span>
                  </Td>
                  <Td>{fmtDate(m.createdAt)}</Td>
                  <Td>
                    {m.blockedAt ? (
                      <span className="cw-badge cw-badge-danger">ระงับ</span>
                    ) : (
                      <span className="cw-badge cw-badge-ok">ปกติ</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-3 py-2.5 text-xs font-semibold ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}
function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <td className={`px-3 py-2.5 ${right ? "text-right" : "text-left"}`}>{children}</td>;
}
