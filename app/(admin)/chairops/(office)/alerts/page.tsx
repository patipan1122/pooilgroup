// ChairOps Alerts · 3-pane master-detail workspace (Wave-1 W4)
// Spec: /tmp/claude-design_chairops_plan.md §W4 + AUDIT_chairops_2026-05-25.md §3.354
//
// Layout:
//   Sidebar (260) → severity filter (P0 red · P1 amber · P2 zinc) + alert-kind chips
//   Main           → filtered alert table with bulk selection + per-row actions
//   Right rail (360) → selected alert detail (ShortageDriftCell · context · LINE history)
//
// Bulk action bar appears sticky-bottom whenever ≥1 row is selected (client state).
// LINE Notify per-event toggle rendered inline in the right rail (Wave-1 stub).
//
// IMPORTANT: This route lives under the `(office)` route group which is a URL-
// transparent grouping (per Next.js docs). It resolves to `/chairops/alerts`.
// The old `app/(admin)/chairops/alerts/page.tsx` MUST be deleted to avoid the
// "two pages resolve to same route" build error. (W4 cleanup task.)
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import {
  MasterDetailShell,
  ShortageDriftCell,
  LineNotifyToggle,
  ChairCodeChip,
} from "@/components/chairops/_kit";
import { asEngineDrift, toCellDrift } from "@/lib/chairops/types/drift";
import { StatusPill } from "@/components/ui/status-pill";
import { thaiDateTime, thaiRelative, ageHours } from "@/lib/chairops/utils/format";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  ChairopsAlertKind,
  ChairopsAlertLevel,
  ChairopsAlertStatus,
} from "@/lib/generated/prisma/enums";
import {
  ackAlertAction,
  resolveAlertAction,
} from "@/app/(admin)/chairops/alerts/actions";
import { AlertSelectionShell } from "./alert-selection-shell";

// ---------- copy / config ----------------------------------------------------

const SEVERITY_LABELS: Record<ChairopsAlertLevel, { label: string; tone: "danger" | "warning" | "neutral"; tier: "P0" | "P1" | "P2" }> = {
  CRITICAL: { label: "วิกฤต", tone: "danger", tier: "P0" },
  WARN: { label: "เตือน", tone: "warning", tier: "P1" },
  INFO: { label: "แจ้ง", tone: "neutral", tier: "P2" },
};

const KIND_LABELS: Record<ChairopsAlertKind, string> = {
  SHORTAGE: "เงินขาด",
  MISSED_COLLECTION: "ไม่ส่งยอด",
  POS_NOT_INGESTED: "POS ยังไม่นำเข้า",
  CHAIR_OFFLINE: "เก้าอี้ออฟไลน์",
  CLEANLINESS_FAIL: "ตรวจสภาพไม่ผ่าน",
  REPAIR_OVERDUE: "ซ่อมเกิน SLA",
  WRITE_OFF_REQUESTED: "ขอตัดเงินขาด",
};

const STATUS_LABELS: Record<ChairopsAlertStatus, { label: string; tone: "danger" | "warning" | "success" | "neutral" }> = {
  OPEN: { label: "เปิด", tone: "danger" },
  ACK: { label: "รับทราบ", tone: "warning" },
  RESOLVED: { label: "ปิด", tone: "success" },
  IGNORED: { label: "ละเลย", tone: "neutral" },
};

// Default LINE channel per alert kind — UI seed for the right-rail toggle.
// TODO[claude-design]: move to `ChairopsLineEventChannel` table (Wave 2).
const DEFAULT_CHANNEL_PER_KIND: Record<ChairopsAlertKind, string> = {
  SHORTAGE: "finance",
  MISSED_COLLECTION: "ops",
  POS_NOT_INGESTED: "finance",
  CHAIR_OFFLINE: "ops",
  CLEANLINESS_FAIL: "ops",
  REPAIR_OVERDUE: "repair",
  WRITE_OFF_REQUESTED: "ceo",
};

const CHANNEL_LABEL: Record<string, string> = {
  finance: "LINE · ห้องบัญชี",
  ops: "LINE · ห้องปฏิบัติการ",
  repair: "LINE · ห้องช่างซ่อม",
  branch: "LINE · ห้องสาขา",
  ceo: "LINE · CEO",
};

// ---------- types ------------------------------------------------------------

type AlertRow = Prisma.ChairopsAlertGetPayload<{
  include: { branch: { select: { id: true; name: true; slug: true } } };
}>;

// ---------- data loader ------------------------------------------------------

async function loadAlerts(params: {
  status: ChairopsAlertStatus | "ALL_OPEN";
  branchId: string | null;
  kind: ChairopsAlertKind | null;
  level: ChairopsAlertLevel | null;
}) {
  const where: Prisma.ChairopsAlertWhereInput = {};
  if (params.status === "ALL_OPEN") {
    where.status = { in: [ChairopsAlertStatus.OPEN, ChairopsAlertStatus.ACK] };
  } else {
    where.status = params.status;
  }
  if (params.branchId) where.branchId = params.branchId;
  if (params.kind) where.kind = params.kind;
  if (params.level) where.level = params.level;

  const [alerts, branches] = await Promise.all([
    prisma.chairopsAlert.findMany({
      where,
      orderBy: [{ level: "desc" }, { createdAt: "desc" }],
      take: 200,
      include: { branch: { select: { id: true, name: true, slug: true } } },
    }),
    prisma.chairopsBranch.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  // B10: only resolve display-names for users actually referenced in this
  // result set (was: full table scan to build a lookup map).
  const ackedByIds = Array.from(
    new Set(alerts.map((a) => a.ackedById).filter((id): id is string => Boolean(id))),
  );
  const ackers = ackedByIds.length
    ? await prisma.chairopsUser.findMany({
        where: { id: { in: ackedByIds } },
        select: { id: true, displayName: true },
      })
    : [];
  const ackerMap = new Map(ackers.map((u) => [u.id, u.displayName]));

  return { alerts, branches, ackerMap };
}

// ---------- sidebar helpers --------------------------------------------------

function buildHref(base: Record<string, string | undefined>, patch: Record<string, string | undefined>): string {
  const next = { ...base, ...patch };
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) {
    if (v !== undefined && v !== null && v !== "") usp.set(k, v);
  }
  const qs = usp.toString();
  return qs ? `/chairops/alerts?${qs}` : "/chairops/alerts";
}

// ---------- page -------------------------------------------------------------

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{
    branchId?: string;
    kind?: string;
    level?: string;
    status?: string;
    selectedId?: string;
    acked?: string;
    resolved?: string;
    error?: string;
  }>;
}) {
  const session = await requireRole("OFFICE");
  const sp = await searchParams;

  const statusFilter = (sp.status ?? "ALL_OPEN") as ChairopsAlertStatus | "ALL_OPEN";
  const branchFilter = sp.branchId || null;
  const kindFilter = (sp.kind && (sp.kind in ChairopsAlertKind) ? (sp.kind as ChairopsAlertKind) : null);
  const levelFilter = (sp.level && (sp.level in ChairopsAlertLevel) ? (sp.level as ChairopsAlertLevel) : null);

  // (requireRole throws on missing session — defense-in-depth redirect removed
  //  per B16 since it can never fire.)

  const { alerts, branches, ackerMap } = await loadAlerts({
    status: statusFilter,
    branchId: branchFilter,
    kind: kindFilter,
    level: levelFilter,
  });

  const selectedAlert = sp.selectedId
    ? alerts.find((a) => a.id === sp.selectedId) ?? alerts[0] ?? null
    : alerts[0] ?? null;

  // ---------- counts (for sidebar pills) ----------
  // Run cheap counts across the *unfiltered open universe* so the sidebar shows
  // accurate totals regardless of currently applied filters (CEO requirement
  // from AUDIT §3.354 row 3: "filter pills always show real totals").
  const [openCounts, kindCounts] = await Promise.all([
    prisma.chairopsAlert.groupBy({
      by: ["level"],
      where: { status: { in: [ChairopsAlertStatus.OPEN, ChairopsAlertStatus.ACK] } },
      _count: { _all: true },
    }),
    prisma.chairopsAlert.groupBy({
      by: ["kind"],
      where: { status: { in: [ChairopsAlertStatus.OPEN, ChairopsAlertStatus.ACK] } },
      _count: { _all: true },
    }),
  ]);

  const levelCountMap = new Map(openCounts.map((c) => [c.level, c._count._all]));
  const kindCountMap = new Map(kindCounts.map((c) => [c.kind, c._count._all]));

  const baseQuery = {
    branchId: branchFilter ?? undefined,
    kind: kindFilter ?? undefined,
    level: levelFilter ?? undefined,
    status: statusFilter,
    selectedId: undefined,
  };

  // ---------- sidebar markup ----------
  const sidebar = (
    <div className="flex flex-col gap-5 p-4">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          ความรุนแรง
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {(Object.keys(SEVERITY_LABELS) as ChairopsAlertLevel[]).map((lvl) => {
            const meta = SEVERITY_LABELS[lvl];
            const isActive = levelFilter === lvl;
            const count = levelCountMap.get(lvl) ?? 0;
            return (
              <li key={lvl}>
                <Link
                  href={buildHref(baseQuery, { level: isActive ? undefined : lvl })}
                  className={
                    "flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors " +
                    (isActive
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-700 hover:bg-white")
                  }
                  aria-pressed={isActive}
                >
                  <span className="flex items-center gap-2">
                    <StatusPill tone={meta.tone} size="xs" dot>
                      {meta.tier}
                    </StatusPill>
                    <span>{meta.label}</span>
                  </span>
                  <span className="tabular-nums text-xs opacity-80">{count}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <Link
              href={buildHref(baseQuery, { level: undefined })}
              className={
                "flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition-colors " +
                (levelFilter === null
                  ? "bg-zinc-200 text-zinc-900"
                  : "text-zinc-500 hover:bg-white")
              }
            >
              ทั้งหมด
              <span className="tabular-nums">
                {Array.from(levelCountMap.values()).reduce((a, b) => a + b, 0)}
              </span>
            </Link>
          </li>
        </ul>
      </header>

      <section>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          ประเภท Alert
        </p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {(Object.keys(KIND_LABELS) as ChairopsAlertKind[]).map((kind) => {
            const isActive = kindFilter === kind;
            const count = kindCountMap.get(kind) ?? 0;
            return (
              <li key={kind}>
                <Link
                  href={buildHref(baseQuery, { kind: isActive ? undefined : kind })}
                  className={
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors " +
                    (isActive
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400")
                  }
                  aria-pressed={isActive}
                >
                  <span>{KIND_LABELS[kind]}</span>
                  {count > 0 && (
                    <span className="rounded-full bg-rose-50 px-1.5 text-[10px] font-semibold text-rose-700">
                      {count}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          สาขา
        </p>
        <form action="/chairops/alerts" method="get" className="mt-2">
          <input type="hidden" name="status" value={statusFilter} />
          {kindFilter && <input type="hidden" name="kind" value={kindFilter} />}
          {levelFilter && <input type="hidden" name="level" value={levelFilter} />}
          {/* B11: keep selected alert open across filter changes so the
              right rail does not collapse on every submit. */}
          {selectedAlert && (
            <input type="hidden" name="selectedId" value={selectedAlert.id} />
          )}
          <select
            name="branchId"
            defaultValue={branchFilter ?? ""}
            className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs"
          >
            <option value="">ทุกสาขา</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            กรอง
          </button>
        </form>
      </section>

      <section>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          สถานะ
        </p>
        <ul className="mt-2 flex flex-col gap-1 text-xs">
          {(
            [
              { v: "ALL_OPEN", label: "เปิด + รับทราบ" },
              { v: ChairopsAlertStatus.OPEN, label: STATUS_LABELS.OPEN.label },
              { v: ChairopsAlertStatus.ACK, label: STATUS_LABELS.ACK.label },
              { v: ChairopsAlertStatus.RESOLVED, label: STATUS_LABELS.RESOLVED.label },
              { v: ChairopsAlertStatus.IGNORED, label: STATUS_LABELS.IGNORED.label },
            ] as const
          ).map((s) => {
            const isActive = statusFilter === s.v;
            return (
              <li key={s.v}>
                <Link
                  href={buildHref(baseQuery, { status: s.v })}
                  className={
                    "block rounded-md px-2.5 py-1.5 font-medium transition-colors " +
                    (isActive
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-600 hover:bg-white")
                  }
                >
                  {s.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );

  // ---------- right-rail (selected alert detail) ----------
  const meta = selectedAlert
    ? renderSelectedAlertMeta(selectedAlert, ackerMap)
    : (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm text-zinc-500">
        <p className="font-semibold text-zinc-700">ยังไม่ได้เลือก alert</p>
        <p>คลิกแถวในตาราง เพื่อดูรายละเอียด · เปลี่ยน LINE · ดูประวัติแจ้ง</p>
      </div>
    );

  // ---------- main ----------
  // Build the list rows server-side · the AlertSelectionShell (client) wraps
  // them to manage checkbox selection state + sticky bulk-action bar.
  const rows = alerts.map((a) => buildRowData(a, ackerMap, baseQuery));

  return (
    <MasterDetailShell sidebar={sidebar} meta={meta}>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            ศูนย์ Alert
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            เลือกหลายรายการเพื่อ <strong>รับทราบ</strong> หรือ <strong>ปิด</strong>{" "}
            พร้อมกัน · LINE notify ปรับช่องได้ในแถบขวา
          </p>
        </div>
      </div>

      {/* flash banners */}
      {sp.error && (
        <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-800">
          {sp.error}
        </div>
      )}
      {(sp.acked || sp.resolved) && (
        <div className="mb-3 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {sp.resolved ? `ปิด alert แล้ว · ${sp.resolved}` : `รับทราบ alert แล้ว · ${sp.acked}`}
        </div>
      )}

      <AlertSelectionShell rows={rows} />
    </MasterDetailShell>
  );

  // ---------- helpers (local closures) ----------------------------------------

  function buildRowData(
    a: AlertRow,
    ackerNames: Map<string, string>,
    base: Record<string, string | undefined>,
  ) {
    const ackedByName = a.ackedById ? ackerNames.get(a.ackedById) ?? a.ackedById.slice(0, 6) : null;
    const severity = SEVERITY_LABELS[a.level];
    const statusMeta = STATUS_LABELS[a.status];
    return {
      id: a.id,
      createdAt: a.createdAt.toISOString(),
      thaiDateTime: thaiDateTime(a.createdAt),
      thaiRelative: thaiRelative(a.createdAt),
      level: a.level,
      severityTier: severity.tier,
      severityTone: severity.tone,
      kind: a.kind,
      kindLabel: KIND_LABELS[a.kind],
      branchName: a.branch?.name ?? null,
      branchCode: a.branch?.slug ?? null,
      branchId: a.branch?.id ?? null,
      title: a.title,
      message: a.message,
      status: a.status,
      statusLabel: statusMeta.label,
      statusTone: statusMeta.tone,
      ackedByName,
      detailHref: buildHref(base, { selectedId: a.id }),
      // Pre-bound forms — the client shell renders these as-is in the actions cell.
      ackAvailable: a.status === ChairopsAlertStatus.OPEN,
      resolveAvailable:
        a.status === ChairopsAlertStatus.OPEN || a.status === ChairopsAlertStatus.ACK,
    };
  }

  function renderSelectedAlertMeta(
    a: AlertRow,
    ackerNames: Map<string, string>,
  ) {
    const ctx = (a.contextJson ?? {}) as Record<string, unknown>;
    // CEO 2026-06-01 P0: branded Drift type · the alert's context.drift is
    // engine-convention (positive = shortage); convert to cell-convention
    // before handing to ShortageDriftCell instead of magic-`-Math.abs`.
    const rawDrift = typeof ctx.drift === "number" ? Math.abs(ctx.drift as number) : 0;
    const driftAmount = toCellDrift(asEngineDrift(rawDrift));
    const ageH = typeof ctx.age_hours === "number" ? (ctx.age_hours as number) : ageHours(a.createdAt);
    const ackedByName = a.ackedById ? ackerNames.get(a.ackedById) ?? a.ackedById.slice(0, 6) : null;
    const channelKey = DEFAULT_CHANNEL_PER_KIND[a.kind] ?? "ops";
    const channelLabel = CHANNEL_LABEL[channelKey] ?? channelKey;

    return (
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <StatusPill tone={SEVERITY_LABELS[a.level].tone} size="xs" dot>
              {SEVERITY_LABELS[a.level].tier} · {SEVERITY_LABELS[a.level].label}
            </StatusPill>
            <StatusPill tone={STATUS_LABELS[a.status].tone} size="xs">
              {STATUS_LABELS[a.status].label}
            </StatusPill>
          </div>
          <h2 className="text-base font-semibold leading-tight text-zinc-900">
            {a.title}
          </h2>
          <p className="text-xs text-zinc-500">
            {thaiDateTime(a.createdAt)} · {thaiRelative(a.createdAt)}
          </p>
        </header>

        {a.branch && (
          <ChairCodeChip
            code={a.branch.slug}
            branch={a.branch.name}
            size="md"
            href={`/chairops/reconcile/${a.branch.id}`}
          />
        )}

        {/* Signature drift cell — only meaningful for SHORTAGE kind, but
            shown for all kinds because the context shape is normalised. */}
        {a.kind === ChairopsAlertKind.SHORTAGE && (
          <section className="rounded-xl border border-rose-200 bg-rose-50/60 p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-rose-700">
              ขาดสะสม
            </p>
            <ShortageDriftCell
              amount={driftAmount}
              ageHours={ageH}
              cumulativeDays={typeof ctx.cumulative_days === "number" ? (ctx.cumulative_days as number) : 0}
              escalation={ageH > 72 ? "ceo" : ageH > 24 ? "mgr" : "none"}
            />
          </section>
        )}

        <section className="rounded-xl border border-zinc-200 bg-white p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            รายละเอียด
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-zinc-800">{a.message}</p>
        </section>

        {ackedByName && (
          <section className="rounded-xl border border-zinc-200 bg-white p-3 text-xs text-zinc-600">
            <p>
              <strong className="text-zinc-800">รับทราบโดย:</strong> {ackedByName}
            </p>
            {a.ackedAt && (
              <p className="mt-0.5">
                <strong className="text-zinc-800">เวลา:</strong> {thaiDateTime(a.ackedAt)}
              </p>
            )}
            {a.resolvedAt && (
              <p className="mt-0.5">
                <strong className="text-zinc-800">ปิดเมื่อ:</strong>{" "}
                {thaiDateTime(a.resolvedAt)}
              </p>
            )}
          </section>
        )}

        {/* LINE notify toggle (Wave-1 stub — see actions.ts) */}
        <section>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            LINE สำหรับ alert ประเภทนี้
          </p>
          <LineNotifyToggle
            eventLabel={`${KIND_LABELS[a.kind]} · ${a.kind}`}
            channelLabel={channelLabel}
            enabled={true /* TODO[claude-design]: read from ChairopsLineEventChannel · Wave 2 */}
            sendCount={0}
            disabledReason={undefined}
          />
          <p className="mt-1.5 px-0.5 text-[10px] italic leading-snug text-zinc-500">
            สวิตช์นี้ยังเป็น stub Wave-1 · จะเชื่อม LINE Messaging API จริงเมื่อ
            migrate จาก LINE Notify (D-NEW-3)
          </p>
        </section>

        {/* Per-row quick actions in right rail */}
        <section className="flex flex-col gap-2">
          {a.status === ChairopsAlertStatus.OPEN && (
            <form action={ackAlertAction}>
              <input type="hidden" name="alertId" value={a.id} />
              <button
                type="submit"
                className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
              >
                รับทราบ alert นี้
              </button>
            </form>
          )}
          {(a.status === ChairopsAlertStatus.OPEN || a.status === ChairopsAlertStatus.ACK) && (
            <form action={resolveAlertAction}>
              <input type="hidden" name="alertId" value={a.id} />
              <button
                type="submit"
                className="w-full rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
              >
                ปิด alert นี้
              </button>
            </form>
          )}
        </section>
      </div>
    );
  }
}
