// Applications Inbox — 3-pane workspace
// Filters (left) | List (middle) | Detail (right)
// Mobile: stack to single pane with breadcrumb back

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { KpiTile } from "@/components/ui/kpi-tile";
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  STATUS_TONE,
  TAG_COLOR_CHIP,
  parseTag,
  type ApplicationStatus,
} from "@/lib/recruit/types";
import { ApplicationDetail } from "./application-detail";
import { thaiDateLong } from "@/lib/utils/format";
import { ClipboardList, KanbanSquare, ListChecks, Plus, Inbox, SearchX, CalendarCheck, Users } from "lucide-react";
import { ViewToggle } from "./view-toggle";

interface Props {
  orgId: string;
  currentStatus: ApplicationStatus | null;
  currentPosting: string | null;
  currentQuery: string;
  currentSelectedId: string | null;
  countMap: Record<ApplicationStatus, number>;
  postings: Array<{ id: string; title: string }>;
  postingsCount?: number;
  canWrite: boolean;
}

export async function ApplicationsInbox({
  orgId,
  currentStatus,
  currentPosting,
  currentQuery,
  currentSelectedId,
  countMap,
  postings,
  canWrite,
}: Props) {
  // Fetch applications based on filters
  const apps = await prisma.recruitApplication.findMany({
    where: {
      orgId,
      draft: false,
      ...(currentStatus ? { status: currentStatus } : {}),
      ...(currentPosting ? { postingId: currentPosting } : {}),
      ...(currentQuery
        ? {
            OR: [
              { applicant: { fullName: { contains: currentQuery, mode: "insensitive" } } },
              { applicant: { phone: { contains: currentQuery } } },
              { refId: { contains: currentQuery, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ submittedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 100,
    include: {
      applicant: true,
      posting: { select: { id: true, title: true } },
    },
  });

  // Selection only triggers when user explicitly picks an item (no auto-select).
  // On mobile this keeps the list as the default view; on desktop the right pane
  // shows a placeholder until something is clicked.
  const selectedId = currentSelectedId ?? null;
  const selected =
    selectedId && apps.find((a) => a.id === selectedId)
      ? apps.find((a) => a.id === selectedId)!
      : null;

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-60px)]">
      {/* PANE 1: Filters (left) — KPI strip + filters */}
      <aside className="hidden lg:flex flex-col w-56 shrink-0 border-r border-zinc-200 bg-white overflow-y-auto">
        {/* KPI strip — CEO 30-second health check · shared <KpiTile> รอบ 46 */}
        <div className="p-3 border-b border-zinc-100 grid grid-cols-2 gap-2">
          <KpiTile
            label="ทั้งหมด"
            value={Object.values(countMap).reduce((s, n) => s + n, 0)}
            accent="brand"
          />
          <KpiTile label="ใหม่" value={countMap.NEW} accent="brand" />
          <KpiTile
            label="กำลังคุย"
            value={countMap.SCREENING + countMap.INTERVIEW + countMap.OFFERED}
            accent="warning"
          />
          <KpiTile label="รับแล้ว" value={countMap.HIRED} accent="success" />
        </div>

        {/* Status filters */}
        <div className="p-3">
          <p className="text-[11px] text-zinc-500 font-bold px-2 mb-1.5">
            สถานะ
          </p>
          <FilterLink
            href={buildUrl({ status: null, posting: currentPosting, q: currentQuery })}
            label="ทั้งหมด"
            count={Object.values(countMap).reduce((s, n) => s + n, 0)}
            active={!currentStatus}
          />
          {APPLICATION_STATUSES.map((s) => (
            <FilterLink
              key={s}
              href={buildUrl({ status: s, posting: currentPosting, q: currentQuery })}
              label={STATUS_LABELS[s]}
              count={countMap[s]}
              active={currentStatus === s}
              tone={STATUS_TONE[s]}
            />
          ))}
        </div>

        {/* Posting filter */}
        {postings.length > 0 && (
          <div className="p-3 border-t border-zinc-100">
            <p className="text-[11px] text-zinc-500 font-bold px-2 mb-1.5">
              ตำแหน่ง
            </p>
            <FilterLink
              href={buildUrl({ status: currentStatus, posting: null, q: currentQuery })}
              label="ทุกตำแหน่ง"
              active={!currentPosting}
            />
            {postings.slice(0, 8).map((p) => (
              <FilterLink
                key={p.id}
                href={buildUrl({ status: currentStatus, posting: p.id, q: currentQuery })}
                label={p.title}
                active={currentPosting === p.id}
                truncate
              />
            ))}
          </div>
        )}

        {/* Quick links */}
        <div className="p-3 border-t border-zinc-100 mt-auto">
          <p className="text-[11px] text-zinc-500 font-bold px-2 mb-1.5">
            ลิ้งค์ด่วน
          </p>
          <Link
            href="/recruit/postings"
            className="flex items-center gap-2 text-sm text-zinc-700 hover:text-[var(--color-brand-700)] px-2 h-10 rounded hover:bg-zinc-50"
          >
            <ClipboardList className="size-4" />
            ประกาศทั้งหมด
          </Link>
          <Link
            href="/recruit/pipeline"
            className="flex items-center gap-2 text-sm text-zinc-700 hover:text-[var(--color-brand-700)] px-2 h-10 rounded hover:bg-zinc-50"
          >
            <KanbanSquare className="size-4" />
            ดูแบบบอร์ด (Pipeline)
          </Link>
          <Link
            href="/recruit/tasks"
            className="flex items-center gap-2 text-sm text-zinc-700 hover:text-[var(--color-brand-700)] px-2 h-10 rounded hover:bg-zinc-50"
          >
            <ListChecks className="size-4" />
            งานที่ต้องตาม
          </Link>
          <Link
            href="/recruit/calendar"
            className="flex items-center gap-2 text-sm text-zinc-700 hover:text-[var(--color-brand-700)] px-2 h-10 rounded hover:bg-zinc-50"
          >
            <CalendarCheck className="size-4" />
            ปฏิทินสัมภาษณ์
          </Link>
          <Link
            href="/recruit/talent-pool"
            className="flex items-center gap-2 text-sm text-zinc-700 hover:text-[var(--color-brand-700)] px-2 h-10 rounded hover:bg-zinc-50"
          >
            <Users className="size-4" />
            Talent Pool
          </Link>
        </div>
      </aside>

      {/* Mobile filter pills (replaces hidden desktop sidebar on <lg) */}
      <div className={`lg:hidden border-b border-zinc-200 bg-white px-3 py-2 overflow-x-auto ${
        selectedId ? "hidden" : "flex"
      }`}>
        <div className="flex items-center gap-1.5 min-w-fit">
          <Link
            href={buildUrl({ status: null, posting: currentPosting, q: currentQuery })}
            className={`h-9 px-3 inline-flex items-center rounded-lg text-xs font-bold whitespace-nowrap border ${
              !currentStatus
                ? "bg-zinc-900 text-white border-zinc-900"
                : "bg-white text-zinc-700 border-zinc-200"
            }`}
          >
            ทั้งหมด ({Object.values(countMap).reduce((s, n) => s + n, 0)})
          </Link>
          {APPLICATION_STATUSES.map((s) => (
            <Link
              key={s}
              href={buildUrl({ status: s, posting: currentPosting, q: currentQuery })}
              className={`h-9 px-3 inline-flex items-center rounded-lg text-xs font-bold whitespace-nowrap border ${
                currentStatus === s
                  ? "bg-zinc-900 text-white border-zinc-900"
                  : "bg-white text-zinc-700 border-zinc-200"
              }`}
            >
              {STATUS_LABELS[s]} ({countMap[s]})
            </Link>
          ))}
        </div>
      </div>

      {/* PANE 2: List (middle) — on mobile, hide when a row is selected so detail can take over */}
      <section className={`flex-col w-full lg:w-[380px] shrink-0 border-r border-zinc-200 bg-white overflow-hidden ${
        selectedId ? "hidden lg:flex" : "flex"
      }`}>
        <div className="p-3 border-b border-zinc-100 space-y-3">
          <div className="flex items-center gap-2">
            <SearchBar defaultValue={currentQuery} />
            <ViewToggle
              current="list"
              listHref={buildUrl({
                status: currentStatus,
                posting: currentPosting,
                q: currentQuery,
              })}
              kanbanHref={`/recruit/pipeline${
                currentPosting ? `?posting=${currentPosting}` : ""
              }`}
            />
          </div>
          <div className="flex items-center justify-between text-xs">
            <p className="text-zinc-500">
              <span className="font-bold text-zinc-900 tabular-num">{apps.length}</span> ใบสมัคร
              {currentStatus && (
                <>
                  {" · "}
                  <Badge tone={STATUS_TONE[currentStatus]}>{STATUS_LABELS[currentStatus]}</Badge>
                </>
              )}
            </p>
            {canWrite && (
              <Link
                href="/recruit/postings/new"
                className="inline-flex items-center gap-1 text-[var(--color-brand-700)] font-bold hover:underline"
              >
                <Plus className="size-3" />
                ประกาศใหม่
              </Link>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {apps.length === 0 ? (
            <EmptyListState
              hasFilter={!!(currentStatus || currentPosting || currentQuery)}
              statusLabel={currentStatus ? STATUS_LABELS[currentStatus] : null}
              query={currentQuery}
              clearHref={buildUrl({})}
            />
          ) : (
            apps.map((app) => (
              <Link
                key={app.id}
                href={buildUrl({
                  status: currentStatus,
                  posting: currentPosting,
                  q: currentQuery,
                  selected: app.id,
                })}
                className={`block px-4 py-3 border-b border-zinc-100 hover:bg-zinc-50 transition-colors ${
                  selectedId === app.id
                    ? "bg-[var(--color-brand-50)] border-l-4 border-l-[var(--color-brand-500)] pl-3"
                    : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-zinc-900 text-sm truncate">
                      {app.applicant.fullName}
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5 truncate">
                      {app.posting.title} · {app.applicant.phone}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {app.aiScore != null && (
                      <span className="text-xs font-bold tabular-num text-[var(--color-brand-700)]">
                        AI {app.aiScore}
                      </span>
                    )}
                    {app.flaggedBlacklist && (
                      <span
                        className="text-[11px] font-bold text-red-600"
                        title="ตรงกับ Blacklist"
                      >
                        ⚠ ติดบัญชี
                      </span>
                    )}
                    {app.starRating != null && (
                      <span className="text-xs text-amber-500">
                        {"★".repeat(app.starRating)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 mt-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge tone={STATUS_TONE[app.status as ApplicationStatus]}>
                      <span className="size-1.5 rounded-full bg-current opacity-60" />
                      {STATUS_LABELS[app.status as ApplicationStatus]}
                    </Badge>
                    {app.refId && (
                      <span
                        className="font-mono text-[11px] text-zinc-400 tabular-num"
                        title={app.refId}
                      >
                        #{app.refId.slice(-6)}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-zinc-400 shrink-0">
                    {app.submittedAt
                      ? thaiDateLong(app.submittedAt)
                      : "ยังไม่ส่ง"}
                  </span>
                </div>
                {/* Colored tags row */}
                {app.tags && app.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {app.tags.slice(0, 5).map((raw) => {
                      const { color, label } = parseTag(raw);
                      return (
                        <span
                          key={raw}
                          className={`inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded ${TAG_COLOR_CHIP[color]}`}
                        >
                          {label}
                        </span>
                      );
                    })}
                    {app.tags.length > 5 && (
                      <span className="text-[10px] text-zinc-400">
                        +{app.tags.length - 5}
                      </span>
                    )}
                  </div>
                )}
              </Link>
            ))
          )}
        </div>
      </section>

      {/* PANE 3: Detail (right) — on mobile, show full-screen when a row is selected */}
      <main className={`flex-1 overflow-y-auto bg-zinc-50/50 ${
        selectedId ? "block" : "hidden lg:block"
      }`}>
        {selected ? (
          <>
            {/* Mobile back-to-list bar (hidden on desktop where the list is always visible) */}
            <div className="lg:hidden sticky top-0 z-10 bg-white border-b border-zinc-200 px-3 py-2 flex items-center justify-between">
              <Link
                href={buildUrl({
                  status: currentStatus,
                  posting: currentPosting,
                  q: currentQuery,
                  selected: null,
                })}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-zinc-700 font-bold text-sm hover:bg-zinc-100"
              >
                ← กลับรายการ
              </Link>
              <span
                className="text-xs font-mono text-zinc-500"
                title={selected.refId ?? ""}
              >
                {selected.refId ? `#${selected.refId.slice(-6)}` : ""}
              </span>
            </div>
            <ApplicationDetail
              applicationId={selected.id}
              canWrite={canWrite}
            />
          </>
        ) : (
          <div className="hidden lg:flex flex-col items-center justify-center h-full p-20 text-center">
            <Inbox className="size-12 text-zinc-300" />
            <p className="mt-3 text-sm font-bold text-zinc-700">เลือกใบสมัครจากรายการ</p>
            <p className="text-xs text-zinc-500 mt-1">
              คลิกที่ชื่อในแถบกลางเพื่อดูรายละเอียด
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function FilterLink({
  href,
  label,
  count,
  active,
  truncate,
}: {
  href: string;
  label: string;
  count?: number;
  active?: boolean;
  /** Color tone — accepted by callers; currently unused by render but reserved for future styling. */
  tone?: "neutral" | "brand" | "warning" | "success" | "danger" | "info";
  truncate?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-xs font-medium ${
        active
          ? "bg-[var(--color-brand-50)] text-[var(--color-brand-800)]"
          : "text-zinc-700 hover:bg-zinc-50"
      }`}
    >
      <span className={truncate ? "truncate" : ""}>{label}</span>
      {count != null && (
        <span className="text-[11px] tabular-num text-zinc-400 shrink-0">{count}</span>
      )}
    </Link>
  );
}

// Local KpiTile removed รอบ 46 · use shared @/components/ui/kpi-tile

function SearchBar({ defaultValue }: { defaultValue: string }) {
  return (
    <form action="" method="GET" className="flex-1 min-w-0">
      <input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder="ค้นชื่อ / เบอร์ / เลขใบสมัคร..."
        className="w-full text-sm rounded-xl border border-zinc-200 h-10 px-3 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)]"
      />
    </form>
  );
}

function EmptyListState({
  hasFilter,
  statusLabel,
  query,
  clearHref,
}: {
  hasFilter: boolean;
  statusLabel: string | null;
  query: string;
  clearHref: string;
}) {
  if (!hasFilter) {
    return (
      <div className="p-10 text-center">
        <Inbox className="size-10 mx-auto text-zinc-300" />
        <p className="text-sm font-bold text-zinc-700 mt-3">ยังไม่มีใบสมัคร</p>
        <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
          แชร์ลิ้งค์ประกาศใน Facebook / LINE เพื่อให้คนสมัครเข้ามา
        </p>
        <Link
          href="/recruit/postings"
          className="inline-flex items-center justify-center mt-4 h-10 px-4 rounded-xl text-xs font-bold text-white bg-[var(--color-brand-600)] hover:bg-[var(--color-brand-700)]"
        >
          ดูประกาศทั้งหมด →
        </Link>
      </div>
    );
  }
  const filterParts: string[] = [];
  if (statusLabel) filterParts.push(`สถานะ "${statusLabel}"`);
  if (query) filterParts.push(`ค้นหา "${query}"`);
  return (
    <div className="p-10 text-center">
      <SearchX className="size-10 mx-auto text-zinc-300" />
      <p className="text-sm font-bold text-zinc-700 mt-3">ไม่พบใบสมัครที่ตรง</p>
      {filterParts.length > 0 && (
        <p className="text-xs text-zinc-500 mt-1.5">{filterParts.join(" · ")}</p>
      )}
      <Link
        href={clearHref}
        className="inline-flex items-center justify-center mt-4 h-10 px-4 rounded-xl text-xs font-bold text-[var(--color-brand-700)] border border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]"
      >
        ล้างเงื่อนไข
      </Link>
    </div>
  );
}

function buildUrl(params: {
  status?: ApplicationStatus | null;
  posting?: string | null;
  q?: string;
  selected?: string | null;
}): string {
  const sp = new URLSearchParams();
  if (params.status) sp.set("status", params.status);
  if (params.posting) sp.set("posting", params.posting);
  if (params.q) sp.set("q", params.q);
  if (params.selected) sp.set("selected", params.selected);
  const qs = sp.toString();
  return `/recruit${qs ? `?${qs}` : ""}`;
}
