// ChairOps Wave-1 W5 · Write-offs maker-checker workspace
// Spec: /tmp/claude-design_chairops_plan.md §W5 + AUDIT_chairops_2026-05-25.md §3.355 (BR3 · BR7 · BR15)
//
// Layout (3-pane master-detail):
//   Sidebar (260) → status filter (PENDING/APPROVED/REJECTED/RESOLVED-DRIFT) + amount-range chips
//   Main           → write-off table with MakerCheckerBadge + ShortageDriftCell
//   Right rail (360) → selected write-off audit chain + approval threshold + photo proof
//
// IMPORTANT (route collision): This route lives in the `(office)` route group
// (URL-transparent). It resolves to `/chairops/write-offs`. The old
// `app/(admin)/chairops/write-offs/page.tsx` has been DELETED in this commit.
//
// BR3 thresholds enforced server-side via `canWriteOff`:
//   - amount < 500 → MANAGER+ may approve
//   - amount ≥ 500 → CEO+ may approve (no MANAGER override)
// BR7 maker-checker: actor never approves a row they themselves created.
// BR15 atomic chain: after approve, we recompute drift + re-evaluate alerts
// (post-commit best-effort · Wave-2 will lift into 1-TX cascade — see
// TODO[claude-design] in actions.ts).

import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { canWriteOff } from "@/lib/chairops/auth/role-guards";
import { rankOf } from "@/lib/chairops/auth/role-guards";
import {
  MasterDetailShell,
  MakerCheckerBadge,
  ShortageDriftCell,
  PhotoProofPanel,
  ChairCodeChip,
} from "@/components/chairops/_kit";
import { StatusPill } from "@/components/ui/status-pill";
import {
  baht,
  thaiDateTime,
  thaiRelative,
} from "@/lib/chairops/utils/format";
import {
  approveWriteOff,
  rejectWriteOff,
} from "@/app/(admin)/chairops/reconcile/actions";
import { WriteOffSelectionShell, type WriteOffRowVM } from "./write-off-selection-shell";

// ---------- copy / config ----------------------------------------------------

const STATUS_LABELS: Record<
  "PENDING" | "APPROVED" | "REJECTED",
  { label: string; tone: "danger" | "warning" | "success" | "neutral" }
> = {
  PENDING: { label: "รออนุมัติ", tone: "warning" },
  APPROVED: { label: "อนุมัติแล้ว", tone: "success" },
  REJECTED: { label: "ปฏิเสธ", tone: "danger" },
};

type StatusFilter = "PENDING" | "APPROVED" | "REJECTED" | "RESOLVED_DRIFT" | "ALL";

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: "PENDING", label: "รออนุมัติ" },
  { key: "APPROVED", label: "อนุมัติแล้ว" },
  { key: "REJECTED", label: "ปฏิเสธ" },
  { key: "RESOLVED_DRIFT", label: "ปิด drift สำเร็จ" },
  { key: "ALL", label: "ทั้งหมด" },
];

type AmountBucket = "ANY" | "LT_100" | "LT_500" | "GTE_500" | "GTE_2000";

const AMOUNT_CHIPS: Array<{ key: AmountBucket; label: string; max?: number; min?: number }> = [
  { key: "ANY", label: "ทุกยอด" },
  { key: "LT_100", label: "< 100฿", max: 99 },
  { key: "LT_500", label: "< 500฿ (MGR)", max: 499 },
  { key: "GTE_500", label: "≥ 500฿ (CEO)", min: 500 },
  { key: "GTE_2000", label: "≥ 2,000฿", min: 2000 },
];

// ---------- helpers ----------------------------------------------------------

function buildHref(
  base: Record<string, string | undefined>,
  patch: Record<string, string | undefined>,
): string {
  const next = { ...base, ...patch };
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) {
    if (v !== undefined && v !== null && v !== "") usp.set(k, v);
  }
  const qs = usp.toString();
  return qs ? `/chairops/write-offs?${qs}` : "/chairops/write-offs";
}

function classifyAmountBucket(amount: number, bucket: AmountBucket): boolean {
  if (bucket === "ANY") return true;
  if (bucket === "LT_100") return amount < 100;
  if (bucket === "LT_500") return amount < 500;
  if (bucket === "GTE_500") return amount >= 500;
  if (bucket === "GTE_2000") return amount >= 2000;
  return true;
}

// ---------- page ------------------------------------------------------------

export default async function WriteOffsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    bucket?: string;
    selectedId?: string;
    approved?: string;
    rejected?: string;
    requested?: string;
    error?: string;
  }>;
}) {
  const session = await requireRole("OFFICE");
  if (!session) redirect("/login");
  const sp = await searchParams;

  const statusFilter: StatusFilter =
    sp.status && STATUS_FILTERS.some((f) => f.key === sp.status)
      ? (sp.status as StatusFilter)
      : "PENDING";
  const bucketFilter: AmountBucket =
    sp.bucket && AMOUNT_CHIPS.some((c) => c.key === sp.bucket)
      ? (sp.bucket as AmountBucket)
      : "ANY";

  // ---------- data load ----------
  // Note: RESOLVED_DRIFT is a UX-only synthetic filter — DB stores APPROVED.
  // We treat RESOLVED_DRIFT as "APPROVED rows for branches whose latest drift
  // is now ≥ 0 (no shortage)". For Wave-1 we approximate as APPROVED filter
  // (Wave-2 will JOIN to ChairopsDrift latest snapshot).
  const dbStatusWhere =
    statusFilter === "ALL"
      ? undefined
      : statusFilter === "RESOLVED_DRIFT"
        ? "APPROVED"
        : statusFilter;

  const [rows, branchesAll, counts] = await Promise.all([
    prisma.chairopsWriteOff.findMany({
      where: dbStatusWhere ? { status: dbStatusWhere } : {},
      orderBy:
        statusFilter === "PENDING"
          ? { makerAt: "asc" }
          : { approverAt: "desc" },
      take: 200,
      include: {
        maker: { select: { id: true, displayName: true, role: true } },
        approver: { select: { id: true, displayName: true, role: true } },
      },
    }),
    prisma.chairopsBranch.findMany({
      select: { id: true, name: true, slug: true },
    }),
    prisma.chairopsWriteOff.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
  ]);

  const branchMap = new Map(branchesAll.map((b) => [b.id, b]));
  const countMap = new Map(counts.map((c) => [c.status, c._count._all]));

  // Apply bucket filter client-side (we'd push into Prisma WHERE for big
  // datasets, but with TAKE 200 this is fine).
  const filteredRows = rows.filter((r) =>
    classifyAmountBucket(r.amount, bucketFilter),
  );

  // Build row VMs for the client shell.
  const isManagerPlus = rankOf(session.user.role) >= rankOf("MANAGER");
  const isCeoPlus = rankOf(session.user.role) >= rankOf("CEO");

  const rowVMs: WriteOffRowVM[] = filteredRows.map((w): WriteOffRowVM => {
    const status = (w.status as "PENDING" | "APPROVED" | "REJECTED") ?? "PENDING";
    const statusMeta = STATUS_LABELS[status];
    const requiredRole: "MANAGER" | "CEO" = w.amount >= 500 ? "CEO" : "MANAGER";
    const isOwn = w.makerId === session.user.id;
    const can = canWriteOff(session.user, w.amount) && !isOwn && status === "PENDING";
    const branch = branchMap.get(w.branchId);

    let disabledReason: string | null = null;
    if (!can && status === "PENDING") {
      if (isOwn) disabledReason = "ห้ามอนุมัติของตัวเอง";
      else if (w.amount >= 500 && !isCeoPlus)
        disabledReason = "ยอด ≥ 500 ต้อง CEO ขึ้นไป";
      else if (w.amount < 500 && !isManagerPlus)
        disabledReason = "ยอด < 500 ต้อง MANAGER ขึ้นไป";
    }

    return {
      id: w.id,
      thaiDateTime: thaiDateTime(w.makerAt),
      thaiRelative: thaiRelative(w.makerAt),
      branchId: w.branchId,
      branchName: branch?.name ?? w.branchId.slice(0, 8),
      amount: w.amount,
      reason: w.reason,
      status,
      statusLabel: statusMeta.label,
      statusTone: statusMeta.tone,
      requiredRole,
      makerName: w.maker.displayName,
      makerRole: w.maker.role,
      approverName: w.approver?.displayName ?? null,
      approverRole: w.approver?.role ?? null,
      approverAtLabel: w.approverAt ? thaiRelative(w.approverAt) : null,
      notes: w.notes,
      canApprove: can,
      isOwnRow: isOwn,
      approveDisabledReason: disabledReason,
      bulkEligible: can && w.amount < 500,
      detailHref: buildHref(
        { status: statusFilter, bucket: bucketFilter },
        { selectedId: w.id },
      ),
    };
  });

  const selectedRow = sp.selectedId
    ? (filteredRows.find((r) => r.id === sp.selectedId) ?? null)
    : null;
  const selectedBranch =
    selectedRow ? branchMap.get(selectedRow.branchId) ?? null : null;

  // ---------- sidebar (status + amount filters) ----------
  const baseQuery = {
    status: statusFilter === "PENDING" ? undefined : statusFilter, // PENDING is default
    bucket: bucketFilter === "ANY" ? undefined : bucketFilter,
    selectedId: undefined,
  };

  const sidebar = (
    <div className="flex flex-col gap-5 p-4">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          สถานะ
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {STATUS_FILTERS.map((f) => {
            const isActive = statusFilter === f.key;
            const dbKey =
              f.key === "ALL" || f.key === "RESOLVED_DRIFT"
                ? null
                : f.key;
            const count =
              f.key === "ALL"
                ? Array.from(countMap.values()).reduce((a, b) => a + b, 0)
                : f.key === "RESOLVED_DRIFT"
                  ? (countMap.get("APPROVED") ?? 0) // approximation
                  : (countMap.get(dbKey ?? "") ?? 0);
            return (
              <li key={f.key}>
                <Link
                  href={buildHref(baseQuery, {
                    status: f.key === "PENDING" ? undefined : f.key,
                  })}
                  className={
                    "flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors " +
                    (isActive
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-700 hover:bg-white")
                  }
                  aria-pressed={isActive}
                >
                  <span>{f.label}</span>
                  <span className="tabular-nums text-xs opacity-80">
                    {count}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </header>

      <section>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          ช่วงยอด
        </p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {AMOUNT_CHIPS.map((c) => {
            const isActive = bucketFilter === c.key;
            return (
              <li key={c.key}>
                <Link
                  href={buildHref(baseQuery, {
                    bucket: c.key === "ANY" ? undefined : c.key,
                  })}
                  className={
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors " +
                    (isActive
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400")
                  }
                  aria-pressed={isActive}
                >
                  {c.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-3 text-xs leading-relaxed text-zinc-600">
        <p className="font-semibold text-zinc-800">เกณฑ์อนุมัติ (BR3)</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>
            ยอด <strong>&lt; 500 ฿</strong> → MANAGER ขึ้นไป
          </li>
          <li>
            ยอด <strong>≥ 500 ฿</strong> → CEO เท่านั้น
          </li>
          <li>ผู้ขอ ≠ ผู้อนุมัติ (BR7)</li>
        </ul>
      </section>
    </div>
  );

  // ---------- right rail (selected detail) ----------
  const meta = selectedRow ? (
    renderSelectedMeta(selectedRow, selectedBranch, session.user.id)
  ) : (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm text-zinc-500">
      <p className="font-semibold text-zinc-700">ยังไม่ได้เลือกรายการ</p>
      <p>คลิกแถวในตาราง เพื่อดูห่วงโซ่ผู้สร้าง-อนุมัติ · หลักฐาน · ตัดสินใจ</p>
    </div>
  );

  return (
    <div className="chairops-scope min-h-screen bg-muted/40">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-3 px-4 sm:px-6">
          <Link
            href="/chairops/dashboard"
            className="text-sm font-bold text-foreground"
          >
            ChairOps · ออฟฟิศ
          </Link>
          <span className="text-zinc-300">/</span>
          <span className="text-sm font-semibold text-foreground">
            ตัดเงินขาด (Write-offs)
          </span>
          <span className="ml-auto text-xs text-muted-foreground">
            {session.user.displayName} · {session.user.role}
          </span>
        </div>
      </header>

      <MasterDetailShell sidebar={sidebar} meta={meta}>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
              ตัดเงินขาด (Write-offs)
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-zinc-600">
              ปิด drift ที่เกิดจากเงินขาด — ผู้ขอสร้างคำขอ ผู้อนุมัติคนละคน
              ยืนยัน (maker-checker) · ทุกการอนุมัติคิด drift ใหม่ทันที (BR15)
            </p>
          </div>
        </div>

        {/* flash banners */}
        {sp.error && (
          <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-800">
            {sp.error}
          </div>
        )}
        {sp.approved && (
          <div className="mb-3 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
            อนุมัติเรียบร้อย · {sp.approved} รายการ · ระบบคิด drift ใหม่แล้ว
          </div>
        )}
        {sp.rejected && (
          <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            ปฏิเสธคำขอเรียบร้อย · {sp.rejected}
          </div>
        )}
        {sp.requested && (
          <div className="mb-3 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
            ส่งคำขอเรียบร้อย · {sp.requested}
          </div>
        )}

        <WriteOffSelectionShell rows={rowVMs} />
      </MasterDetailShell>
    </div>
  );

  // ---------- right-rail renderer (closure over session/branch maps) ----------
  function renderSelectedMeta(
    w: (typeof filteredRows)[number],
    branch: { id: string; name: string; slug: string } | null,
    actorId: string,
  ) {
    const status = (w.status as "PENDING" | "APPROVED" | "REJECTED") ?? "PENDING";
    const statusMeta = STATUS_LABELS[status];
    const requiredRole: "MANAGER" | "CEO" = w.amount >= 500 ? "CEO" : "MANAGER";
    const isOwn = w.makerId === actorId;
    const can = canWriteOff(session.user, w.amount) && !isOwn && status === "PENDING";

    return (
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <StatusPill tone={statusMeta.tone} size="xs">
              {statusMeta.label}
            </StatusPill>
            <span
              className={
                "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 " +
                (requiredRole === "CEO"
                  ? "bg-rose-50 text-rose-800 ring-rose-200"
                  : "bg-violet-50 text-violet-800 ring-violet-200")
              }
            >
              เกณฑ์: {requiredRole === "CEO" ? "≥ 500 · CEO" : "< 500 · MGR"}
            </span>
          </div>
          <h2 className="text-base font-semibold leading-tight text-zinc-900">
            ขอตัด {baht(w.amount)} ที่ {branch?.name ?? "—"}
          </h2>
          <p className="text-xs text-zinc-500">
            {thaiDateTime(w.makerAt)} · {thaiRelative(w.makerAt)}
          </p>
        </header>

        {branch && (
          <ChairCodeChip
            code={branch.slug}
            branch={branch.name}
            size="md"
            href={`/chairops/reconcile/b/${branch.slug}`}
          />
        )}

        {/* Drift impact — what this write-off resolves */}
        <section className="rounded-xl border border-rose-200 bg-rose-50/60 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-rose-700">
            จำนวนที่จะตัด (ลบจาก drift)
          </p>
          <ShortageDriftCell
            amount={-Math.abs(w.amount)}
            ageHours={
              status === "APPROVED" && w.approverAt
                ? 0
                : Math.floor((Date.now() - w.makerAt.getTime()) / 3_600_000)
            }
            escalation={requiredRole === "CEO" ? "ceo" : "mgr"}
          />
          <p className="mt-2 text-xs text-zinc-600">
            BR15: เมื่ออนุมัติแล้ว ระบบจะคิด drift ของสาขา{" "}
            <strong>{branch?.name}</strong>{" "}
            ใหม่ทันที + ปลด alert ที่เกี่ยวข้อง
          </p>
        </section>

        {/* Audit chain */}
        <section className="rounded-xl border border-zinc-200 bg-white p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            ห่วงโซ่ผู้สร้าง · ผู้อนุมัติ
          </p>
          <MakerCheckerBadge
            maker={{
              name: `${w.maker.displayName} · ${w.maker.role}`,
              at: thaiRelative(w.makerAt),
            }}
            approver={
              w.approver
                ? {
                    name: `${w.approver.displayName} · ${w.approver.role}`,
                    at: w.approverAt ? thaiRelative(w.approverAt) : undefined,
                  }
                : null
            }
          />
        </section>

        {/* Reason + notes */}
        <section className="rounded-xl border border-zinc-200 bg-white p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            เหตุผลจากผู้ขอ
          </p>
          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-zinc-800">
            {w.reason}
          </p>
          {w.notes && (
            <>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                หมายเหตุผู้อนุมัติ
              </p>
              <p className="mt-1 italic text-sm text-zinc-700">
                &ldquo;{w.notes}&rdquo;
              </p>
            </>
          )}
        </section>

        {/* Photo proof — stub for Wave 1 · WriteOff schema has no photoUrl field yet */}
        {/* TODO[claude-design]: Wave 2 — add `photoUrl` column to ChairopsWriteOff + wire R2 upload in `requestWriteOff`. */}
        <PhotoProofPanel
          title="หลักฐานภาพ"
          sticky={false}
          photo={null}
        />

        {/* Action buttons — BR3 threshold + BR7 self-block */}
        {status === "PENDING" ? (
          <section className="flex flex-col gap-2">
            <form action={approveWriteOff}>
              <input type="hidden" name="writeOffId" value={w.id} />
              <button
                type="submit"
                disabled={!can}
                title={
                  !can && isOwn
                    ? "ห้ามอนุมัติของตัวเอง (BR7)"
                    : !can
                      ? `ต้อง ${requiredRole} ขึ้นไป`
                      : undefined
                }
                className={
                  "w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors " +
                  (requiredRole === "CEO"
                    ? "border border-rose-400 bg-rose-600 text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-200 disabled:text-zinc-500"
                    : "border border-emerald-400 bg-emerald-600 text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-200 disabled:text-zinc-500")
                }
              >
                {requiredRole === "CEO"
                  ? `อนุมัติ (CEO) · ${baht(w.amount)}`
                  : `อนุมัติ · ${baht(w.amount)}`}
              </button>
            </form>

            <form
              action={rejectWriteOff}
              className="flex flex-col gap-1.5 rounded-lg border border-zinc-200 bg-white p-2"
            >
              <input type="hidden" name="writeOffId" value={w.id} />
              <label
                htmlFor={`reject-reason-${w.id}`}
                className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500"
              >
                เหตุผลปฏิเสธ
              </label>
              <input
                id={`reject-reason-${w.id}`}
                name="reason"
                required
                minLength={3}
                placeholder="เช่น เอกสารไม่ครบ · ต้องเก็บใหม่"
                className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-300"
              />
              <button
                type="submit"
                disabled={!can}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ปฏิเสธคำขอ
              </button>
            </form>

            {!can && (
              <p className="text-[11px] text-zinc-500">
                {isOwn
                  ? "คุณเป็นผู้สร้างคำขอนี้ · ต้องให้คนอื่นอนุมัติ"
                  : `ต้องใช้ role ${requiredRole} ขึ้นไป อนุมัติยอด ${baht(w.amount)}`}
              </p>
            )}
          </section>
        ) : (
          <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
            <p>
              <strong className="text-zinc-800">ปิดแล้ว</strong> ·{" "}
              {w.approver?.displayName ?? "ระบบ"} ·{" "}
              {w.approverAt ? thaiDateTime(w.approverAt) : "—"}
            </p>
          </section>
        )}
      </div>
    );
  }
}
