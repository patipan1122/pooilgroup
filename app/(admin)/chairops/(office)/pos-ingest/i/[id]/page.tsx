// W3 (claude-design) · POS preview · 4-bucket diff + maker-checker commit gate.
//
// Spec: plan §W3 + AUDIT_chairops_2026-05-25 §3.
//
// Two main pieces (client components):
//   1) <DiffTable> — filterable preview using `DiffBucketPills` click-to-filter
//   2) <CommitCard> — 3-checkbox checklist → maker-checker enforced submit
//
// Server-side guards still apply (canEditPastDay, etc) — UI mirrors them.
// Per memory [[pool-csv-import-must-diff-before-write]] the user MUST see
// these buckets before any commit possible.

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { canEditPastDay } from "@/lib/chairops/auth/role-guards";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { MakerCheckerBadge } from "@/components/chairops/_kit";
import { thaiDateTime } from "@/lib/chairops/utils/format";
import type {
  DiffSummary,
  DiffRow,
} from "@/app/(admin)/chairops/pos-ingest/actions";
import { DiffTable } from "./diff-table";
import { CommitCard } from "./commit-card";
import { UnknownBranchesCard, type UnknownBranchGroup } from "./unknown-branches-card";

export default async function PosPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireRole("OFFICE");
  const { id } = await params;
  const sp = await searchParams;

  const imp = await prisma.chairopsPosImport.findUnique({ where: { id } });
  if (!imp) notFound();

  const uploader = await prisma.chairopsUser.findUnique({
    where: { id: imp.uploadedById },
    select: { id: true, displayName: true, role: true },
  });

  const diff = imp.diffSummary as unknown as DiffSummary;
  const counts = {
    new: diff.counts.new,
    same: diff.counts.same,
    changed: diff.counts.changed,
    bad: diff.counts.error,
  };
  const rows: DiffRow[] = Array.isArray(diff.rows) ? diff.rows : [];

  const isSelfCommit = uploader?.id === session.user.id;
  const role = session.user.role;
  const isManagerOrAbove =
    role === "MANAGER" || role === "CEO" || role === "ADMIN";
  // BR16: uploader cannot self-commit unless MANAGER+
  const makerCheckerBlocker = isSelfCommit && !isManagerOrAbove;

  const hasPastDayWrite = rows.some(
    (r) => (r.status === "changed" || r.status === "new") && r.isPastDay
  );
  const ceoOnlyBlocker = hasPastDayWrite && !canEditPastDay(session.user);

  // CEO 2026-06-01: surface unmatched storeNames + chair samples for one-
  // click branch creation. A row is "unmatched" when status==="error" AND
  // it has a shopName (other error types like bad-date still get the row
  // dropped but don't fit this UI). Group + sample at most 5 chair codes
  // per storeName so the card stays compact.
  const unknownGroupsMap = new Map<string, UnknownBranchGroup>();
  for (const r of rows) {
    if (r.status !== "error") continue;
    const name = (r.shopName ?? "").trim();
    if (!name) continue;
    // Only count rows that are "unmatched branch" specifically — the
    // existing error pipeline tags this via `errors` containing the Thai
    // phrase the row card surfaces.
    const isUnmatchedBranch = r.errors.some((e) => /สาขา|ระบุสาขา/.test(e));
    if (!isUnmatchedBranch) continue;
    let g = unknownGroupsMap.get(name);
    if (!g) {
      g = { storeName: name, rowCount: 0, chairCodeSamples: [] };
      unknownGroupsMap.set(name, g);
    }
    g.rowCount += 1;
    if (r.chairCode && g.chairCodeSamples.length < 5 && !g.chairCodeSamples.includes(r.chairCode)) {
      g.chairCodeSamples.push(r.chairCode);
    }
  }
  const unknownGroups = Array.from(unknownGroupsMap.values()).sort(
    (a, b) => b.rowCount - a.rowCount,
  );

  return (
    <div className="chairops-scope mx-auto max-w-screen-2xl p-4 sm:p-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="mb-4">
        <Link
          href="/chairops/pos-ingest"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← กลับรายการ import
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Preview · {imp.filename}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            อัปโหลด {thaiDateTime(imp.uploadedAt)} · {imp.rowCount} แถว
            {imp.notes ? ` · "${imp.notes}"` : ""}
          </p>
        </div>
        {imp.committed ? (
          <StatusPill tone="success">
            commit แล้วเมื่อ{" "}
            {imp.committedAt ? thaiDateTime(imp.committedAt) : "—"}
          </StatusPill>
        ) : (
          <StatusPill tone="warning">รอยืนยัน commit</StatusPill>
        )}
      </div>

      {/* ── Maker / Checker badge ────────────────────────────────────── */}
      <Card className="mb-4 p-3">
        <MakerCheckerBadge
          maker={
            uploader
              ? {
                  name: `${uploader.displayName} · ${uploader.role}`,
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
        />
      </Card>

      {/* ── Warnings ────────────────────────────────────────────────── */}
      <div className="mb-4 space-y-2">
        {sp.error && (
          <div className="rounded-md border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-800">
            {decodeURIComponent(sp.error)}
          </div>
        )}
        {counts.bad > 0 && (
          <div className="rounded-md border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-800">
            มี {counts.bad} แถวที่อ่านไม่ออก (วันที่ผิด · สาขา map ไม่เจอ ·
            ตัวเลขผิด) — แถวเหล่านี้จะถูกข้ามตอน commit
          </div>
        )}
        {makerCheckerBlocker && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            ⚠ <strong>Maker-Checker block:</strong> คุณเป็นผู้ upload ไฟล์นี้เอง ·
            ต้องให้ผู้ใช้คนอื่น (OFFICE/MANAGER) เป็นผู้ commit
            <br />
            <span className="text-xs">
              (BR16 · เพื่อป้องกัน fraud · ถ้า role ของคุณ ≥ MANAGER จะข้ามได้)
            </span>
          </div>
        )}
        {diff.pastDayWarning && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            ⚠ มีแถวที่แก้ไขย้อนหลัง &gt; 1 วัน
            {ceoOnlyBlocker
              ? " · ต้องให้ CEO เป็นผู้ commit เท่านั้น (คุณกด commit ไม่ได้)"
              : " · ระบบจะอนุญาตเฉพาะเมื่อคุณมี role CEO หรือ ADMIN"}
          </div>
        )}
      </div>

      {/* ── Unknown branches (CEO 2026-06-01) ──────────────────────── */}
      {!imp.committed && unknownGroups.length > 0 && (
        <UnknownBranchesCard groups={unknownGroups} />
      )}

      {/* ── 4-bucket DiffTable ──────────────────────────────────────── */}
      <DiffTable counts={counts} rows={rows} />

      {/* ── Commit card ────────────────────────────────────────────── */}
      {!imp.committed && (
        <CommitCard
          importId={imp.id}
          appliedRowCount={counts.new + counts.changed}
          badRowCount={counts.bad}
          disabled={makerCheckerBlocker || ceoOnlyBlocker}
          makerCheckerBlocker={makerCheckerBlocker}
          ceoOnlyBlocker={ceoOnlyBlocker}
        />
      )}
    </div>
  );
}
