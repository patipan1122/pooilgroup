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
import { UndoImportButton } from "./_components/undo-import-button";
import { MultiUploader } from "./_components/multi-uploader";
import { LatestDataCards } from "./_components/latest-cards";
import { getStarThingLatest } from "@/app/(admin)/chairops/pos-ingest/multi-actions";

// Wave-2 B1: how recent a commit must be to still be undoable.
const UNDO_WINDOW_MS = 60 * 60 * 1000;

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

interface PersistedStarThing {
  dateRange?: { from?: string | null; to?: string | null } | null;
}

interface PersistedDiffSummary {
  counts?: PersistedDiffCounts;
  // CEO 2026-06-01: 3 file types stored in 2 different shapes —
  //   daily file → starThing.dateRange (lives one level deep)
  //   cash/coin  → kind="cash"|"coin" + dateRange on root
  // We sniff both here for the imports-table type pill + range column.
  starThing?: PersistedStarThing | null;
  kind?: "cash" | "coin" | null;
  dateRange?: { from?: string | null; to?: string | null } | null;
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

type ImportFileType = "daily" | "cash" | "coin" | "—";

function fileTypeOf(summary: PersistedDiffSummary | null): ImportFileType {
  if (!summary) return "—";
  if (summary.kind === "cash" || summary.kind === "coin") return summary.kind;
  if (summary.starThing || summary.counts) return "daily";
  return "—";
}

function rangeOf(summary: PersistedDiffSummary | null): { from: string | null; to: string | null } {
  if (!summary) return { from: null, to: null };
  const r = summary.starThing?.dateRange ?? summary.dateRange ?? null;
  return { from: r?.from ?? null, to: r?.to ?? null };
}

const TYPE_TONE: Record<ImportFileType, string> = {
  daily: "bg-sky-100 text-sky-800",
  cash: "bg-emerald-100 text-emerald-800",
  coin: "bg-amber-100 text-amber-800",
  "—": "bg-zinc-100 text-zinc-600",
};

const TYPE_LABEL: Record<ImportFileType, string> = {
  daily: "POS รายวัน",
  cash: "เงินสด event",
  coin: "เหรียญ event",
  "—": "ไม่ทราบ",
};

export default async function PosIngestListPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requireRole("OFFICE");
  const params = await searchParams;

  const [imports, latest] = await Promise.all([
    prisma.chairopsPosImport.findMany({
      orderBy: { uploadedAt: "desc" },
      take: 50,
    }),
    getStarThingLatest(session.user.orgId),
  ]);

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
  // Wave-2 B1: server component · capture wall-time once per request so the
  // JSX below doesn't call Date.now() inline (purity lint). Same pattern as
  // app/(admin)/chairops/reports/page.tsx.
  // eslint-disable-next-line react-hooks/purity
  const renderedAtMs = Date.now();
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
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">POS Ingest</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          อัปโหลด StarThing XLSX ได้ทั้ง 3 ชนิด (daily / cash / coin) ในช่องเดียว · ระบบเดาชนิดให้ + เตรียม diff ก่อน commit เสมอ
        </p>
      </div>

      {/* ── Latest data per type ─────────────────────────────────────── */}
      <div className="mb-6">
        <LatestDataCards data={latest} />
      </div>

      {/* ── Multi-file uploader ──────────────────────────────────────── */}
      <Card className="mb-6 p-4">
        <h2 className="mb-3 text-sm font-semibold">อัปโหลดไฟล์</h2>
        <MultiUploader />
      </Card>

      {/* ── Flash messages ───────────────────────────────────────────── */}
      {params.committed &&
        (() => {
          // Wave-2 B1: when redirected from commit, the param IS the importId.
          // Show a banner with file context + the undo button (60-min window).
          const justCommitted = imports.find((i) => i.id === params.committed);
          if (!justCommitted) {
            return (
              <div className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
                commit สำเร็จ · drift และ alert ถูก recompute แล้ว
              </div>
            );
          }
          return (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm">
              <div className="flex flex-col gap-0.5">
                <div className="font-semibold text-emerald-900">
                  commit สำเร็จ · &quot;{justCommitted.filename}&quot;
                </div>
                <div className="text-xs text-emerald-800">
                  {justCommitted.rowCount.toLocaleString("th-TH")} แถว · drift + alert
                  คำนวณใหม่แล้ว · ยกเลิกได้ภายใน 60 นาที
                </div>
              </div>
              <UndoImportButton
                importId={justCommitted.id}
                variant="banner"
                filename={justCommitted.filename}
              />
            </div>
          );
        })()}
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
        <div className="max-h-[70vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-20 bg-muted text-xs uppercase text-muted-foreground">
            <tr className="bg-muted text-left [&>th]:bg-muted">
              <th className="px-3 py-2 font-medium">เวลาอัปโหลด</th>
              <th className="px-3 py-2 font-medium">ไฟล์</th>
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
              const summary = imp.diffSummary as unknown as PersistedDiffSummary | null;
              const counts = bucketCounts(summary);
              const fileType = fileTypeOf(summary);
              const range = rangeOf(summary);
              const maker = nameMap.get(imp.uploadedById);
              // Route uses import id; filename surfaced for context only.
              return (
                <tr key={imp.id} className="hover:bg-muted/40">
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {thaiDateTime(imp.uploadedAt)}
                  </td>
                  <td className="px-3 py-2">
                    {/* Wave-2 (CEO 2026-06-01): GUID filenames are unreadable.
                        Surface (a) file type pill — daily / cash / coin —
                        (b) data date range, (c) actual filename in muted
                        small text. The CEO can now identify a row from a
                        meter away without opening preview. */}
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex h-5 items-center rounded px-1.5 text-[11px] font-semibold ${TYPE_TONE[fileType]}`}
                        >
                          {TYPE_LABEL[fileType]}
                        </span>
                        {(range.from || range.to) && (
                          <span className="text-xs text-zinc-700">
                            {range.from ?? "?"}
                            {range.from !== range.to && range.to ? ` → ${range.to}` : ""}
                          </span>
                        )}
                      </div>
                      <span className="truncate text-[11px] text-muted-foreground" title={imp.filename}>
                        {imp.filename}
                      </span>
                    </div>
                  </td>
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
                    <div className="flex items-center justify-end gap-2">
                      {imp.committed &&
                        imp.committedAt &&
                        renderedAtMs - imp.committedAt.getTime() < UNDO_WINDOW_MS && (
                          <UndoImportButton importId={imp.id} variant="row" />
                        )}
                      <Link
                        href={`/chairops/pos-ingest/i/${imp.id}`}
                        className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 transition-all duration-150 hover:bg-zinc-50 active:bg-zinc-100"
                      >
                        {imp.committed ? "ดูรายละเอียด" : "ตรวจ + commit"}
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Logged in as {session.user.displayName} · {session.user.role}
      </p>
    </div>
  );
}
