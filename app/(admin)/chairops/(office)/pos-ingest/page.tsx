// W3 (claude-design) · POS Ingest list — recent uploads + bucket summary.
//
// Replaces legacy `app/(admin)/chairops/pos-ingest/page.tsx`. The old route
// now redirects here (see legacy file). New shell wraps content in
// `.chairops-scope` so kit primitives render with ChairOps tokens.
//
// Pattern: header → primary CTA → recent imports table.
// Each row shows MakerCheckerBadge (uploader vs committer) per BR16.
//
// Per memory [[pool-csv-import-must-diff-before-write]] — every row links
// to the preview where the 4-bucket diff lives.
//
// NOTE: parent `(office)/layout.tsx` (built by W1 agent) supplies top-nav.
// While W1 is still in flight this page works under the existing
// `app/(admin)/chairops/layout.tsx` entitlement gate — no behaviour change.

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import {
  DiffBucketPills,
  MakerCheckerBadge,
  type DiffBucketCounts,
} from "@/components/chairops/_kit";
import { thaiDateTime } from "@/lib/chairops/utils/format";

interface Search {
  committed?: string;
  error?: string;
}

interface PersistedDiffCounts {
  new?: number;
  same?: number;
  changed?: number;
  error?: number;
}

interface PersistedDiffSummary {
  counts?: PersistedDiffCounts;
}

function bucketCounts(summary: PersistedDiffSummary | null): DiffBucketCounts {
  const c = summary?.counts ?? {};
  return {
    new: c.new ?? 0,
    same: c.same ?? 0,
    changed: c.changed ?? 0,
    bad: c.error ?? 0,
  };
}

export default async function PosIngestListPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requireRole("OFFICE");
  const params = await searchParams;

  const imports = await prisma.chairopsPosImport.findMany({
    orderBy: { uploadedAt: "desc" },
    take: 50,
  });

  const uploaderIds = [...new Set(imports.map((i) => i.uploadedById))];
  const uploaders = uploaderIds.length
    ? await prisma.chairopsUser.findMany({
        where: { id: { in: uploaderIds } },
        select: { id: true, displayName: true },
      })
    : [];
  const nameMap = new Map(uploaders.map((u) => [u.id, u.displayName]));

  // Aggregate bucket counts across pending imports for at-a-glance summary
  const pending = imports.filter((i) => !i.committed);
  const totalPending: DiffBucketCounts = pending.reduce(
    (acc, imp) => {
      const c = bucketCounts(imp.diffSummary as unknown as PersistedDiffSummary | null);
      return {
        new: acc.new + c.new,
        same: acc.same + c.same,
        changed: acc.changed + c.changed,
        bad: acc.bad + c.bad,
      };
    },
    { new: 0, same: 0, changed: 0, bad: 0 }
  );

  return (
    <div className="chairops-scope mx-auto max-w-screen-2xl p-4 sm:p-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">POS รายวัน</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            อัปโหลด CSV ยอดขายจาก POS · ระบบจะแสดง diff 4 กลุ่ม
            (ใหม่/เหมือนเดิม/เปลี่ยน/ผิด) ก่อน commit เสมอ
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/chairops/pos-ingest/upload"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[var(--color-brand-600)] px-5 text-base font-medium text-white shadow-soft transition-all duration-150 hover:bg-[var(--color-brand-700)] active:bg-[var(--color-brand-800)]"
          >
            + อัปโหลดเงินสด + เหรียญ (มีเวลา)
          </Link>
          <Link
            href="/chairops/pos-ingest/new"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-border bg-background px-5 text-base font-medium text-foreground transition-all duration-150 hover:bg-muted"
          >
            + อัปโหลดยอดรวมรายวัน
          </Link>
        </div>
      </div>

      {/* ── Flash messages ───────────────────────────────────────────── */}
      {params.committed && (
        <div className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          commit สำเร็จ · drift และ alert ถูก recompute แล้ว
        </div>
      )}
      {params.error && (
        <div className="mb-4 rounded-md border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-800">
          {decodeURIComponent(params.error)}
        </div>
      )}

      {/* ── Pending bucket summary ───────────────────────────────────── */}
      {pending.length > 0 && (
        <Card className="mb-6 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">รวม import ที่รอ commit</h2>
              <p className="text-xs text-muted-foreground">
                {pending.length} ไฟล์ ·{" "}
                {totalPending.new + totalPending.changed} แถวพร้อมเขียน ·{" "}
                {totalPending.bad} แถวผิด
              </p>
            </div>
            <DiffBucketPills counts={totalPending} active={null} />
          </div>
        </Card>
      )}

      {/* ── Imports table ────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="sticky top-14 z-20 bg-muted text-xs uppercase text-muted-foreground sm:top-16">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">เวลาอัปโหลด</th>
              <th className="px-3 py-2 font-medium">ชื่อไฟล์</th>
              <th className="px-3 py-2 font-medium">Maker / Checker</th>
              <th className="px-3 py-2 text-right font-medium">แถว</th>
              <th className="px-3 py-2 font-medium">สถานะ + Diff</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {imports.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-12 text-center text-muted-foreground"
                >
                  ยังไม่มี import · กดปุ่ม &quot;อัปโหลด POS CSV&quot;
                  เพื่อเริ่ม
                </td>
              </tr>
            )}
            {imports.map((imp) => {
              const counts = bucketCounts(
                imp.diffSummary as unknown as PersistedDiffSummary | null
              );
              const maker = nameMap.get(imp.uploadedById);
              // Route uses import id; filename surfaced for context only.
              return (
                <tr key={imp.id} className="hover:bg-muted/40">
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {thaiDateTime(imp.uploadedAt)}
                  </td>
                  <td className="px-3 py-2 font-medium">{imp.filename}</td>
                  <td className="px-3 py-2">
                    <MakerCheckerBadge
                      maker={
                        maker
                          ? {
                              name: maker,
                              at: thaiDateTime(imp.uploadedAt),
                            }
                          : null
                      }
                      checker={
                        imp.committed && imp.committedAt
                          ? {
                              name: "ผู้ commit",
                              at: thaiDateTime(imp.committedAt),
                            }
                          : null
                      }
                      noApprover
                      compact
                    />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {imp.rowCount}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {imp.committed ? (
                        <StatusPill tone="success">commit แล้ว</StatusPill>
                      ) : (
                        <StatusPill tone="warning">รอ commit</StatusPill>
                      )}
                      <DiffBucketPills counts={counts} active={null} />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/chairops/pos-ingest/i/${imp.id}`}
                      className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 transition-all duration-150 hover:bg-zinc-50 active:bg-zinc-100"
                    >
                      {imp.committed ? "ดูรายละเอียด" : "ตรวจ + commit"}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Logged in as {session.user.displayName} · {session.user.role}
      </p>
    </div>
  );
}
