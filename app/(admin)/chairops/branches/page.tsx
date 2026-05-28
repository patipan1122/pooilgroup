// ChairOps · Branches 3-pane workspace (Gmail/Linear-style split view)
// SPEC §B/Branches · mockup screens/branches.jsx
//
// Server Component · all state lives in the URL searchParams:
//   ?branch=<id>  selected branch (right detail pane)
//   ?view=all|critical|warn|ok|missed   left-rail status filter
//   ?mall=<key>|all                      left-rail mall filter
//   ?tab=overview|timeline|chairs|damage|cleanliness|cost|notes  detail tab
//   ?sort=priority|drift|missed|pos|profit|name
//   ?q=<search>
//
// No 'use client': every interactive element is a <Link> that mutates the URL.
// Multi-pane · NEVER forces list→detail page navigation ([[ceo-prefers-multi-pane-workspace]]).

import Link from "next/link";
import {
  Phone,
  MoreHorizontal,
  Search,
  Clock,
  LayoutGrid,
  Armchair,
  AlertTriangle,
} from "lucide-react";
import "@/components/chairops/redesign/branches.css";
import { requireRole } from "@/lib/chairops/auth/session";
import { rankOf } from "@/lib/chairops/auth/role-guards";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import { baht } from "@/lib/chairops/utils/format";
import { MALL_GROUPS, MALL_RAIL_ORDER } from "@/lib/chairops/utils/mall-groups";
import {
  getBranchesWorkspace,
  getBranchDetail,
  type BranchRowVM,
  type BranchDetailVM,
  type WorkspaceStatus,
  type WorkspaceView,
  type WorkspaceSort,
} from "@/lib/chairops/queries/branches-workspace";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "ภาพรวม" },
  { key: "timeline", label: "Timeline" },
  { key: "chairs", label: "เก้าอี้" },
  { key: "damage", label: "ของเสีย" },
  { key: "cleanliness", label: "ความสะอาด" },
  { key: "cost", label: "ต้นทุน" },
  { key: "notes", label: "บันทึก" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const VIEW_DEFS: { key: WorkspaceView; label: string; sev?: "crit" | "warn" }[] = [
  { key: "all", label: "ทั้งหมด" },
  { key: "critical", label: "วิกฤต", sev: "crit" },
  { key: "warn", label: "เฝ้าระวัง", sev: "warn" },
  { key: "ok", label: "ปกติ" },
  { key: "missed", label: "ยังไม่ส่งวันนี้", sev: "warn" },
];

function statusLabel(s: WorkspaceStatus): string {
  return s === "critical"
    ? "วิกฤต"
    : s === "warn"
      ? "เฝ้าระวัง"
      : s === "missed"
        ? "ยังไม่ส่ง"
        : "ปกติ";
}

function driftClass(n: number): string {
  if (n < -1000) return "crit";
  if (n < -100) return "warn";
  if (n > 0) return "ok";
  return "muted";
}

function bahtSigned(n: number): string {
  const abs = Math.abs(n);
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${abs.toLocaleString("en-US")} ฿`;
}

function relThai(d: Date | null): string {
  if (!d) return "—";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "วันนี้";
  if (days === 1) return "เมื่อวาน";
  return `${days} วันก่อน`;
}

// Build a query string preserving existing params while overriding some.
function hrefWith(
  base: Record<string, string | undefined>,
  override: Record<string, string | undefined>,
): string {
  const merged = { ...base, ...override };
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v != null && v !== "") sp.set(k, v);
  }
  const q = sp.toString();
  return `/chairops/branches${q ? `?${q}` : ""}`;
}

function StatusDot({ status }: { status: WorkspaceStatus }) {
  return <span className="co-dot" data-status={status} aria-hidden />;
}

function Sparkbar({ data, tone }: { data: number[]; tone: string }) {
  const max = Math.max(...data, 1);
  const color =
    tone === "crit"
      ? "var(--crit)"
      : tone === "warn"
        ? "var(--warn)"
        : "var(--text-muted)";
  return (
    <span className="co-sparkbar" style={{ height: 12 }} aria-hidden>
      {data.map((v, i) => (
        <i
          key={i}
          style={{
            height: `${Math.max(2, (v / max) * 12)}px`,
            background: color,
          }}
        />
      ))}
    </span>
  );
}

export default async function BranchesWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // OFFICE+ may view the workspace (reconcile across branches).
  const session = await requireRole("OFFICE");
  const orgId = session.user.orgId;
  const rank = rankOf(session.user.role);
  // Cost = admin-tier only (ADMIN/CEO). Maid phone = MANAGER+.
  const canViewCost = rank >= rankOf(ChairopsUserRole.CEO);
  const canViewMaidPhone = rank >= rankOf(ChairopsUserRole.MANAGER);

  const sp = await searchParams;
  const first = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]);

  const view = (first("view") as WorkspaceView) || "all";
  const mall = first("mall") || "all";
  const sortBy = (first("sort") as WorkspaceSort) || "priority";
  const query = (first("q") || "").trim();
  const tab = (first("tab") as TabKey) || "overview";

  const { rows, counts, mallCounts } = await getBranchesWorkspace({
    orgId,
    view,
    mall,
    sortBy,
  });

  // Apply free-text search server-side (kept out of the query for clean counts).
  const visible = query
    ? rows.filter(
        (r) =>
          r.name.toLowerCase().includes(query.toLowerCase()) ||
          r.maidName.toLowerCase().includes(query.toLowerCase()),
      )
    : rows;

  // Selected branch: explicit ?branch= or first visible row.
  const selectedId = first("branch") || visible[0]?.branchId;
  const detail = selectedId
    ? await getBranchDetail({ orgId, branchId: selectedId })
    : null;

  // Group rows by status (mockup default grouping).
  const groups: { key: string; label: string; items: BranchRowVM[] }[] = [
    {
      key: "critical",
      label: "วิกฤต · ต้องดูทันที",
      items: visible.filter((r) => r.status === "critical"),
    },
    {
      key: "missed",
      label: "ยังไม่ส่งวันนี้",
      items: visible.filter((r) => r.status === "missed"),
    },
    {
      key: "warn",
      label: "เฝ้าระวัง",
      items: visible.filter((r) => r.status === "warn"),
    },
    { key: "ok", label: "ปกติ", items: visible.filter((r) => r.status === "ok") },
  ].filter((g) => g.items.length);

  const baseParams = {
    view: view !== "all" ? view : undefined,
    mall: mall !== "all" ? mall : undefined,
    sort: sortBy !== "priority" ? sortBy : undefined,
    q: query || undefined,
    branch: selectedId,
    tab: tab !== "overview" ? tab : undefined,
  };

  return (
    <div className="co-branches" data-pane="detail">
      {/* ──── LEFT rail ──── */}
      <aside className="co-br-rail" aria-label="ตัวกรองสาขา">
        <div className="co-br-rail-section">
          <div className="co-br-rail-title">มุมมอง</div>
          {VIEW_DEFS.map((v) => {
            const count =
              v.key === "all" ? counts.all : counts[v.key as keyof typeof counts];
            return (
              <Link
                key={v.key}
                className="co-br-rail-item"
                data-active={view === v.key || undefined}
                href={hrefWith(baseParams, {
                  view: v.key === "all" ? undefined : v.key,
                  branch: undefined,
                })}
              >
                {v.key === "all" ? (
                  <LayoutGrid size={13} />
                ) : v.key === "missed" ? (
                  <Clock size={13} />
                ) : (
                  <StatusDot status={v.key as WorkspaceStatus} />
                )}
                <span>{v.label}</span>
                <span className="co-br-rail-count" data-sev={v.sev}>
                  {count}
                </span>
              </Link>
            );
          })}
        </div>

        <div className="co-br-rail-section">
          <div className="co-br-rail-title">ห้าง</div>
          <Link
            className="co-br-rail-item"
            data-active={mall === "all" || undefined}
            href={hrefWith(baseParams, { mall: undefined, branch: undefined })}
          >
            <span style={{ width: 8 }} />
            <span>ทั้งหมด</span>
          </Link>
          {MALL_RAIL_ORDER.map((key) => {
            const m = MALL_GROUPS[key];
            const cnt = mallCounts[key] ?? 0;
            return (
              <Link
                key={key}
                className="co-br-rail-item"
                data-active={mall === key || undefined}
                href={hrefWith(baseParams, { mall: key, branch: undefined })}
              >
                <span className="co-mall-dot" style={{ background: m.color }} />
                <span>{m.label}</span>
                <span className="co-br-rail-count">{cnt}</span>
              </Link>
            );
          })}
        </div>

        <div className="co-br-rail-section">
          <div className="co-br-rail-title">จัดกลุ่ม</div>
          <div className="co-segmented">
            <Link data-active href={hrefWith(baseParams, {})}>
              สถานะ
            </Link>
            <Link href={hrefWith(baseParams, { mall: mall })}>ห้าง</Link>
            <Link href={hrefWith(baseParams, {})}>ปิด</Link>
          </div>
        </div>
      </aside>

      {/* ──── MIDDLE list ──── */}
      <section className="co-br-list" aria-label="รายการสาขา">
        <div className="co-br-list-head">
          <form className="row gap-2 grow" action="/chairops/branches" method="get">
            {view !== "all" && <input type="hidden" name="view" value={view} />}
            {mall !== "all" && <input type="hidden" name="mall" value={mall} />}
            {sortBy !== "priority" && (
              <input type="hidden" name="sort" value={sortBy} />
            )}
            <label className="co-br-search">
              <Search size={13} />
              <input
                name="q"
                defaultValue={query}
                placeholder="ค้นหาสาขา / แม่บ้าน…"
                aria-label="ค้นหาสาขา"
              />
            </label>
          </form>
          <div className="co-br-sort">
            <span className="text-3" style={{ fontSize: 11.5 }}>
              เรียง:
            </span>
            <SortLinks baseParams={baseParams} current={sortBy} />
          </div>
        </div>

        <div className="co-br-list-body">
          {groups.length === 0 && (
            <div className="co-br-empty">ไม่พบสาขาที่ตรงเงื่อนไข</div>
          )}
          {groups.map((g) => (
            <div key={g.key} className="co-br-group">
              <div className="co-br-group-head">
                <span>{g.label}</span>
                <span className="text-3 mono">{g.items.length}</span>
              </div>
              {g.items.map((b) => (
                <Link
                  key={b.branchId}
                  className="co-br-row"
                  data-active={b.branchId === selectedId || undefined}
                  href={hrefWith(baseParams, { branch: b.branchId })}
                >
                  <div className="co-br-row-l">
                    <StatusDot status={b.status} />
                  </div>
                  <div className="co-br-row-main">
                    <div className="row gap-2" style={{ alignItems: "center" }}>
                      <span className="co-br-row-name">{b.name}</span>
                      <span
                        className="co-mall-pill"
                        style={{
                          background: b.mallColor + "12",
                          color: b.mallColor,
                          borderColor: b.mallColor + "33",
                        }}
                      >
                        {b.mallLabel}
                      </span>
                    </div>
                    <div className="co-br-row-sub">
                      <span>{b.maidName}</span>
                      <span className="text-muted">·</span>
                      <span>{b.chairs} เก้าอี้</span>
                      <span className="text-muted">·</span>
                      <span>
                        {b.lastCollectionAt ? (
                          "เก็บ " + relThai(b.lastCollectionAt)
                        ) : (
                          <span style={{ color: "var(--crit)" }}>ไม่เคยเก็บ</span>
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="co-br-row-r">
                    <span
                      className={"mono co-drift " + driftClass(b.drift)}
                      style={{ fontSize: 12.5, fontWeight: 500 }}
                    >
                      {bahtSigned(b.drift)}
                    </span>
                    <Sparkbar data={b.series} tone={driftClass(b.drift)} />
                  </div>
                </Link>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* ──── RIGHT detail ──── */}
      <section className="co-br-detail" aria-label="รายละเอียดสาขา">
        {detail ? (
          <BranchDetail
            detail={detail}
            tab={tab}
            baseParams={baseParams}
            canViewCost={canViewCost}
            canViewMaidPhone={canViewMaidPhone}
            orgId={orgId}
          />
        ) : (
          <div className="co-br-empty" style={{ marginTop: 80 }}>
            เลือกสาขาจากรายการเพื่อดูรายละเอียด
          </div>
        )}
      </section>
    </div>
  );
}

// ---------- Sort dropdown rendered as links (no client JS) ----------
const SORT_OPTS: { key: WorkspaceSort; label: string }[] = [
  { key: "priority", label: "ความสำคัญ" },
  { key: "drift", label: "Drift มากสุด" },
  { key: "missed", label: "ไม่ส่งนานสุด" },
  { key: "pos", label: "POS สูงสุด" },
  { key: "profit", label: "กำไรสูงสุด" },
  { key: "name", label: "ชื่อ" },
];

function SortLinks({
  baseParams,
  current,
}: {
  baseParams: Record<string, string | undefined>;
  current: WorkspaceSort;
}) {
  return (
    <div className="row gap-1" style={{ flexWrap: "wrap" }}>
      {SORT_OPTS.map((o) => (
        <Link
          key={o.key}
          href={hrefWith(baseParams, {
            sort: o.key === "priority" ? undefined : o.key,
          })}
          className="btn btn-sm"
          data-active={current === o.key || undefined}
          style={
            current === o.key
              ? {
                  background: "var(--accent-soft)",
                  color: "var(--accent-text)",
                  borderColor: "var(--accent-soft-border)",
                }
              : undefined
          }
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}

// ---------- Detail panel ----------
async function BranchDetail({
  detail: b,
  tab,
  baseParams,
  canViewCost,
  canViewMaidPhone,
  orgId,
}: {
  detail: BranchDetailVM;
  tab: TabKey;
  baseParams: Record<string, string | undefined>;
  canViewCost: boolean;
  canViewMaidPhone: boolean;
  orgId: string;
}) {
  const dc = driftClass(b.drift);

  return (
    <>
      <div className="co-br-detail-head">
        <div className="row gap-3" style={{ alignItems: "flex-start" }}>
          <div
            className="co-br-avatar"
            style={{
              background: b.mallColor + "18",
              color: b.mallColor,
              borderColor: b.mallColor + "44",
            }}
          >
            {b.name.charAt(0)}
          </div>
          <div className="grow">
            <div className="row gap-2" style={{ alignItems: "center" }}>
              <h2 className="co-br-detail-name">{b.name}</h2>
              <span className={"chip chip-" + (b.status === "critical" || b.status === "missed" ? "crit" : b.status === "warn" ? "warn" : "ok")}>
                <StatusDot status={b.status} />
                {statusLabel(b.status)}
              </span>
            </div>
            <div className="co-br-detail-meta">
              <span className="mono text-3">{b.branchSlug}</span>
              <span className="text-muted">·</span>
              <span>{b.mallLabel}</span>
              <span className="text-muted">·</span>
              <span>{b.province ?? "—"}</span>
              <span className="text-muted">·</span>
              <span>{b.chairs} เก้าอี้</span>
            </div>
          </div>
          <div className="row gap-2">
            {canViewMaidPhone && b.maid?.phone ? (
              <a className="btn btn-sm" href={`tel:${b.maid.phone}`}>
                <Phone size={12} /> ติดต่อแม่บ้าน
              </a>
            ) : (
              <span className="btn btn-sm" style={{ opacity: 0.6 }}>
                <Phone size={12} /> ติดต่อแม่บ้าน
              </span>
            )}
            <Link className="btn btn-sm" href={`/chairops/dashboard/${b.branchSlug}`}>
              <MoreHorizontal size={13} />
            </Link>
          </div>
        </div>

        <nav className="co-br-tabs" aria-label="แท็บรายละเอียดสาขา">
          {TABS.map((t) => {
            const count =
              t.key === "timeline"
                ? 42
                : t.key === "chairs"
                  ? b.chairs
                  : t.key === "damage"
                    ? b.openDamageCount
                    : null;
            return (
              <Link
                key={t.key}
                className="co-br-tab"
                data-active={tab === t.key || undefined}
                href={hrefWith(baseParams, {
                  tab: t.key === "overview" ? undefined : t.key,
                })}
              >
                {t.label}
                {count != null && <span className="text-3"> · {count}</span>}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="co-br-detail-body">
        {tab === "overview" && (
          <OverviewTab b={b} dc={dc} canViewCost={canViewCost} canViewMaidPhone={canViewMaidPhone} />
        )}
        {tab === "timeline" && <TimelineTab branchId={b.branchId} orgId={orgId} />}
        {tab === "chairs" && <ChairsTab b={b} />}
        {tab === "damage" && <DamageTab branchId={b.branchId} orgId={orgId} />}
        {tab === "cleanliness" && (
          <CleanlinessTab branchId={b.branchId} orgId={orgId} />
        )}
        {tab === "cost" && <CostTab b={b} canViewCost={canViewCost} />}
        {tab === "notes" && <NotesTab branchId={b.branchId} orgId={orgId} />}
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  unit,
  intent,
  muted,
}: {
  label: string;
  value: string;
  unit?: string;
  intent?: string;
  muted?: boolean;
}) {
  return (
    <div className="co-stat" data-intent={intent} data-muted={muted || undefined}>
      <div className="co-stat-label">{label}</div>
      <div className="co-stat-value">
        <span>{value}</span>
        {unit && <span className="co-stat-unit">{unit}</span>}
      </div>
    </div>
  );
}

function OverviewTab({
  b,
  dc,
  canViewCost,
  canViewMaidPhone,
}: {
  b: BranchDetailVM;
  dc: string;
  canViewCost: boolean;
  canViewMaidPhone: boolean;
}) {
  return (
    <>
      <div className="co-br-stats">
        <Stat label="POS วันนี้" value={baht(b.posToday)} unit="" />
        <Stat
          label="ฝากแม่บ้าน"
          value={b.depositToday ? baht(b.depositToday) : "—"}
          muted={!b.depositToday}
        />
        <Stat label="Drift" value={bahtSigned(b.drift)} intent={dc === "muted" ? undefined : dc} />
        <Stat
          label="กำไร 30 วัน"
          value={canViewCost ? bahtSigned(b.profit30d) : "ซ่อน"}
          intent={canViewCost ? (b.profit30d < 0 ? "crit" : "ok") : undefined}
          muted={!canViewCost}
        />
        <Stat
          label="เก็บล่าสุด"
          value={b.lastCollectionAt ? relThai(b.lastCollectionAt) : "—"}
          muted={!b.lastCollectionAt}
        />
        <Stat
          label="Shortage ค้าง"
          value={String(b.shortageDays)}
          unit="วัน"
          intent={b.shortageDays > 5 ? "crit" : b.shortageDays > 0 ? "warn" : undefined}
          muted={b.shortageDays === 0}
        />
      </div>

      {b.alerts.length > 0 && (
        <div className="co-br-section">
          <div className="co-br-section-head">
            <span>Alerts ที่ค้างอยู่</span>
            <span className="text-3">{b.alerts.length} รายการ</span>
          </div>
          <div className="card co-br-alerts">
            {b.alerts.map((a) => (
              <div key={a.id} className="co-alert-row" data-sev={a.severity}>
                <div className="co-alert-sev">
                  <AlertTriangle size={13} />
                </div>
                <div className="grow">
                  <div className="co-alert-title">{a.title}</div>
                  <div className="text-3" style={{ fontSize: 11.5 }}>
                    {a.detail}
                  </div>
                </div>
                <span className="text-muted mono" style={{ fontSize: 11 }}>
                  {a.age}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="co-br-section">
        <div className="co-br-section-head">
          <span>เงินสด 7 วันล่าสุด</span>
          <div className="co-chart-legend">
            <span className="row gap-1">
              <span className="co-legend-dot" style={{ background: "var(--text-muted)" }} /> POS
            </span>
            <span className="row gap-1">
              <span className="co-legend-dot" style={{ background: "var(--accent)" }} /> ฝากแม่บ้าน
            </span>
          </div>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <CashflowChart pos={b.series.pos} deposit={b.series.deposit} />
        </div>
      </div>

      <div className="co-br-grid">
        <div className="co-br-section">
          <div className="co-br-section-head">
            <span>แม่บ้านประจำ</span>
          </div>
          <div className="card" style={{ padding: 14 }}>
            {b.maid ? (
              <div className="row gap-3">
                <div className="co-avatar" style={{ width: 40, height: 40, fontSize: 14 }}>
                  {b.maid.name.slice(0, 2)}
                </div>
                <div className="grow">
                  <div style={{ fontWeight: 500 }}>{b.maid.name}</div>
                  <div className="text-3 mono" style={{ fontSize: 12 }}>
                    {canViewMaidPhone ? (b.maid.phone ?? "—") : "•••••••••"}
                  </div>
                </div>
                <div className="col gap-1" style={{ alignItems: "flex-end" }}>
                  <span className="chip">
                    {b.shortageDays === 0 ? "ส่งครบ" : `Shortage ${b.shortageDays} วัน`}
                  </span>
                  <span className="text-3" style={{ fontSize: 11 }}>
                    {b.maid.sinceLabel}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-muted" style={{ fontSize: 12.5 }}>
                ยังไม่ได้ผูกแม่บ้านกับสาขานี้
              </div>
            )}
          </div>
        </div>

        <div className="co-br-section">
          <div className="co-br-section-head">
            <span>ต้นทุนต่อเดือน</span>
          </div>
          <CostCard cost={b.cost} canViewCost={canViewCost} />
        </div>
      </div>

      <div className="co-br-section">
        <div className="co-br-section-head">
          <span>เก้าอี้ในสาขา</span>
          <span className="text-3">
            {b.chairs} ตัว ·{" "}
            {b.openDamageCount === 0
              ? "ทุกตัวยังใช้งานได้"
              : `${b.openDamageCount} แจ้งซ่อม`}
          </span>
        </div>
        <ChairGrid chairs={b.chairList} />
      </div>
    </>
  );
}

function CostCard({
  cost,
  canViewCost,
}: {
  cost: BranchDetailVM["cost"];
  canViewCost: boolean;
}) {
  if (!canViewCost) {
    return (
      <div className="card co-cost-locked">
        ต้นทุนสาขาแสดงเฉพาะผู้ดูแลระบบ (ADMIN/CEO)
      </div>
    );
  }
  const total = cost.total || 1;
  const rows = [
    { label: "ค่าเช่าห้าง", value: cost.rent },
    { label: "ค่าไฟ-น้ำ", value: cost.util },
    { label: "ค่าคน (แม่บ้าน)", value: cost.payroll },
    { label: "เบ็ดเตล็ด", value: cost.misc },
  ];
  return (
    <div className="card co-cost-card">
      {rows.map((r) => (
        <div key={r.label} className="co-cost-row">
          <span className="co-cost-label">{r.label}</span>
          <div className="co-cost-bar">
            <i style={{ width: `${(r.value / total) * 100}%` }} />
          </div>
          <span className="co-cost-value">{r.value.toLocaleString("en-US")}</span>
        </div>
      ))}
      <div className="co-cost-total">
        <span>รวม / เดือน</span>
        <span className="mono">{cost.total.toLocaleString("en-US")} ฿</span>
      </div>
      <div className="co-cost-daily">
        <span className="text-3">เฉลี่ย / วัน</span>
        <span className="mono">{cost.daily.toLocaleString("en-US")} ฿</span>
      </div>
    </div>
  );
}

function ChairGrid({ chairs }: { chairs: BranchDetailVM["chairList"] }) {
  if (chairs.length === 0) {
    return (
      <div className="card co-br-empty">ยังไม่มีข้อมูลเก้าอี้ในสาขานี้</div>
    );
  }
  return (
    <div className="card co-chair-grid">
      {chairs.map((c) => (
        <div key={c.code} className="co-chair-card" data-damaged={c.isDamaged || undefined}>
          <Armchair size={22} />
          <div className="mono" style={{ fontSize: 11, marginTop: 4 }}>
            {c.code}
          </div>
          <div className="text-3" style={{ fontSize: 10.5 }}>
            {c.isDamaged ? (
              <span style={{ color: "var(--crit)" }}>● แจ้งซ่อม</span>
            ) : (
              <span style={{ color: "var(--ok)" }}>● ใช้งานได้</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// SVG cashflow chart (7-day POS dashed + deposit solid + drift fill)
function CashflowChart({ pos, deposit }: { pos: number[]; deposit: number[] }) {
  const all = [...pos, ...deposit];
  const max = Math.max(...all, 1);
  const min = Math.min(...all, 0);
  const W = 600;
  const H = 120;
  const P = 8;
  const x = (i: number, len: number) => P + (i / Math.max(1, len - 1)) * (W - P * 2);
  const y = (v: number) => H - P - ((v - min) / (max - min || 1)) * (H - P * 2);
  const path = (data: number[]) =>
    data.map((v, i) => (i === 0 ? "M" : "L") + x(i, data.length) + " " + y(v)).join(" ");
  const days = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];
  return (
    <svg
      viewBox={`0 0 ${W} ${H + 16}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: 160 }}
      role="img"
      aria-label="กราฟเงินสด 7 วันล่าสุด"
    >
      {[0.25, 0.5, 0.75].map((g, i) => (
        <line
          key={i}
          x1={P}
          x2={W - P}
          y1={P + (H - P * 2) * g}
          y2={P + (H - P * 2) * g}
          stroke="var(--border-subtle)"
          strokeWidth="1"
        />
      ))}
      <path d={path(pos)} fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="3 3" />
      <path d={path(deposit)} fill="none" stroke="var(--accent)" strokeWidth="2" />
      {deposit.map((v, i) => (
        <circle key={i} cx={x(i, deposit.length)} cy={y(v)} r="2.5" fill="var(--accent)" />
      ))}
      {days.map((d, i) => (
        <text
          key={i}
          x={x(i, days.length)}
          y={H + 12}
          fontSize="9"
          fill="var(--text-muted)"
          textAnchor="middle"
        >
          {d}
        </text>
      ))}
    </svg>
  );
}

// ---------- Timeline tab ----------
async function TimelineTab({ branchId, orgId }: { branchId: string; orgId: string }) {
  const [collections, posDaily] = await Promise.all([
    prisma.chairopsCashCollection.findMany({
      where: { orgId, branchId },
      orderBy: { collectedAt: "desc" },
      take: 30,
      include: { maid: { select: { displayName: true } } },
    }),
    prisma.chairopsBranchDailyRevenue.findMany({
      where: { orgId, branchId },
      orderBy: { bizDate: "desc" },
      take: 30,
    }),
  ]);

  type Item = { at: Date; tone: string; title: string; sub: string };
  const items: Item[] = [
    ...collections.map((c) => ({
      at: c.collectedAt,
      tone: "var(--accent)",
      title: `เก็บเงิน ${baht(c.depositedAmount)}`,
      sub: `โดย ${c.maid?.displayName ?? "—"}${c.notes ? " · " + c.notes : ""}`,
    })),
    ...posDaily.map((p) => ({
      at: p.bizDate,
      tone: "var(--text-muted)",
      title: `POS ${baht(Number(p.cashTotal))} (เงินสด)`,
      sub: "นำเข้าจากไฟล์ StarThing",
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 42);

  if (items.length === 0) {
    return <div className="co-br-empty">ยังไม่มีเหตุการณ์ในสาขานี้</div>;
  }
  return (
    <div className="card" style={{ padding: "4px 16px" }}>
      {items.map((it, i) => (
        <div key={i} className="co-event-row">
          <span className="co-event-dot" style={{ background: it.tone }} />
          <div className="grow">
            <div style={{ fontSize: 12.5, fontWeight: 500 }}>{it.title}</div>
            <div className="text-3" style={{ fontSize: 11.5 }}>
              {it.sub}
            </div>
          </div>
          <span className="text-muted mono" style={{ fontSize: 11 }}>
            {relThai(it.at)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ChairsTab({ b }: { b: BranchDetailVM }) {
  return <ChairGrid chairs={b.chairList} />;
}

// ---------- Damage tab ----------
const DMG_STATUS_LABEL: Record<string, string> = {
  OPEN: "รอช่างรับ",
  ASSIGNED: "มอบหมายแล้ว",
  IN_PROGRESS: "กำลังซ่อม",
  WAITING_PARTS: "รออะไหล่",
  DONE: "เสร็จแล้ว",
  CANCELLED: "ยกเลิก",
};
const DMG_TONE: Record<string, string> = {
  OPEN: "crit",
  ASSIGNED: "warn",
  IN_PROGRESS: "warn",
  WAITING_PARTS: "warn",
  DONE: "ok",
  CANCELLED: "muted",
};

async function DamageTab({ branchId, orgId }: { branchId: string; orgId: string }) {
  const tickets = await prisma.chairopsDamageTicket.findMany({
    where: { orgId, branchId },
    orderBy: { openedAt: "desc" },
    take: 40,
    include: {
      chair: { select: { chairCode: true } },
      assignedTo: { select: { displayName: true } },
    },
  });
  if (tickets.length === 0) {
    return <div className="co-br-empty">ไม่มีรายการแจ้งซ่อมในสาขานี้</div>;
  }
  return (
    <div className="card" style={{ padding: "4px 16px" }}>
      {tickets.map((t) => (
        <div key={t.id} className="co-event-row">
          <span
            className="co-event-dot"
            style={{
              background:
                DMG_TONE[t.status] === "crit"
                  ? "var(--crit)"
                  : DMG_TONE[t.status] === "ok"
                    ? "var(--ok)"
                    : DMG_TONE[t.status] === "warn"
                      ? "var(--warn)"
                      : "var(--text-muted)",
            }}
          />
          <div className="grow">
            <div className="row gap-2" style={{ alignItems: "center" }}>
              <span className="mono" style={{ fontSize: 12 }}>
                {t.ticketCode}
              </span>
              {t.chair?.chairCode && (
                <span className="text-3" style={{ fontSize: 11.5 }}>
                  {t.chair.chairCode}
                </span>
              )}
              <span className={"chip chip-" + (DMG_TONE[t.status] === "muted" ? "info" : DMG_TONE[t.status])}>
                {DMG_STATUS_LABEL[t.status] ?? t.status}
              </span>
            </div>
            <div className="text-3" style={{ fontSize: 11.5, marginTop: 2 }}>
              {t.description}
              {t.assignedTo ? ` · ช่าง ${t.assignedTo.displayName}` : ""}
            </div>
          </div>
          <span className="text-muted mono" style={{ fontSize: 11 }}>
            {relThai(t.openedAt)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------- Cleanliness tab ----------
const CLEAN_TONE: Record<string, string> = {
  PASS: "ok",
  WARN: "warn",
  FAIL: "crit",
};

async function CleanlinessTab({ branchId, orgId }: { branchId: string; orgId: string }) {
  const reports = await prisma.chairopsCleanlinessReport.findMany({
    where: { orgId, branchId },
    orderBy: { reportedAt: "desc" },
    take: 30,
    include: { maid: { select: { displayName: true } } },
  });
  if (reports.length === 0) {
    return <div className="co-br-empty">ยังไม่มีรายงานความสะอาด</div>;
  }
  return (
    <div className="card" style={{ padding: "4px 16px" }}>
      {reports.map((r) => {
        const checklist = Array.isArray(r.checklist)
          ? (r.checklist as unknown[])
          : [];
        const passed = checklist.filter(Boolean).length;
        return (
          <div key={r.id} className="co-event-row">
            <span
              className="co-event-dot"
              style={{
                background:
                  CLEAN_TONE[r.grade] === "crit"
                    ? "var(--crit)"
                    : CLEAN_TONE[r.grade] === "warn"
                      ? "var(--warn)"
                      : "var(--ok)",
              }}
            />
            <div className="grow">
              <div className="row gap-2" style={{ alignItems: "center" }}>
                <span style={{ fontSize: 12.5, fontWeight: 500 }}>
                  {checklist.length > 0 ? `${passed}/${checklist.length} ผ่าน` : "รายงานความสะอาด"}
                </span>
                <span className={"chip chip-" + CLEAN_TONE[r.grade]}>{r.grade}</span>
              </div>
              <div className="text-3" style={{ fontSize: 11.5 }}>
                โดย {r.maid?.displayName ?? "—"}
                {r.notes ? " · " + r.notes : ""}
              </div>
            </div>
            <span className="text-muted mono" style={{ fontSize: 11 }}>
              {relThai(r.reportedAt)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Cost tab (stacked bar + 4 lines) ----------
function CostTab({ b, canViewCost }: { b: BranchDetailVM; canViewCost: boolean }) {
  if (!canViewCost) {
    return (
      <div className="card co-cost-locked">
        ต้นทุนสาขาแสดงเฉพาะผู้ดูแลระบบ (ADMIN/CEO)
      </div>
    );
  }
  const total = b.cost.total || 1;
  const segs = [
    { label: "ค่าเช่าห้าง", value: b.cost.rent, color: "var(--accent)" },
    { label: "ค่าไฟ-น้ำ", value: b.cost.util, color: "var(--info)" },
    { label: "ค่าคน (แม่บ้าน)", value: b.cost.payroll, color: "var(--warn)" },
    { label: "เบ็ดเตล็ด", value: b.cost.misc, color: "var(--text-muted)" },
  ];
  return (
    <div className="card co-cost-card">
      <div className="co-stack">
        {segs.map((s) => (
          <i key={s.label} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
        ))}
      </div>
      {segs.map((s) => (
        <div key={s.label} className="co-cost-row">
          <span className="co-cost-label">
            <span
              className="co-legend-dot"
              style={{ background: s.color, display: "inline-block", marginRight: 6 }}
            />
            {s.label}
          </span>
          <div className="co-cost-bar">
            <i style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
          </div>
          <span className="co-cost-value">{s.value.toLocaleString("en-US")}</span>
        </div>
      ))}
      <div className="co-cost-total">
        <span>รวม / เดือน</span>
        <span className="mono">{b.cost.total.toLocaleString("en-US")} ฿</span>
      </div>
      <div className="co-cost-daily">
        <span className="text-3">เฉลี่ย / วัน</span>
        <span className="mono">{b.cost.daily.toLocaleString("en-US")} ฿</span>
      </div>
    </div>
  );
}

// ---------- Notes tab ----------
async function NotesTab({ branchId, orgId }: { branchId: string; orgId: string }) {
  // Surface free-text notes captured across collections (closest to "บันทึก").
  const collections = await prisma.chairopsCashCollection.findMany({
    where: { orgId, branchId, notes: { not: null } },
    orderBy: { collectedAt: "desc" },
    take: 30,
    include: { maid: { select: { displayName: true } } },
  });
  if (collections.length === 0) {
    return <div className="co-br-empty">ยังไม่มีบันทึกในสาขานี้</div>;
  }
  return (
    <div className="card" style={{ padding: "4px 16px" }}>
      {collections.map((c) => (
        <div key={c.id} className="co-event-row">
          <span className="co-event-dot" style={{ background: "var(--accent)" }} />
          <div className="grow">
            <div style={{ fontSize: 12.5 }}>{c.notes}</div>
            <div className="text-3" style={{ fontSize: 11.5 }}>
              {c.maid?.displayName ?? "—"}
            </div>
          </div>
          <span className="text-muted mono" style={{ fontSize: 11 }}>
            {relThai(c.collectedAt)}
          </span>
        </div>
      ))}
    </div>
  );
}
