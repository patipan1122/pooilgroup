// Applications Inbox — 3-pane workspace
// Filters (left) | List (middle) | Detail (right)
// Mobile: stack to single pane with breadcrumb back

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  STATUS_TONE,
  type ApplicationStatus,
} from "@/lib/recruit/types";
import { ApplicationDetail } from "./application-detail";
import { thaiDateLong } from "@/lib/utils/format";

interface Props {
  orgId: string;
  currentStatus: ApplicationStatus | null;
  currentPosting: string | null;
  currentQuery: string;
  currentSelectedId: string | null;
  countMap: Record<ApplicationStatus, number>;
  postings: Array<{ id: string; title: string }>;
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

  // Auto-select first app if none selected
  const selectedId = currentSelectedId ?? apps[0]?.id ?? null;
  const selected =
    selectedId && apps.find((a) => a.id === selectedId)
      ? apps.find((a) => a.id === selectedId)!
      : null;

  return (
    <div className="flex h-[calc(100vh-60px)]">
      {/* PANE 1: Filters (left) */}
      <aside className="hidden lg:flex flex-col w-56 shrink-0 border-r border-zinc-200 bg-white overflow-y-auto">
        <div className="p-4 border-b border-zinc-100">
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-bold">
            ใบสมัคร
          </p>
          <p className="text-xl font-extrabold text-zinc-900 mt-1 tabular-num">
            {Object.values(countMap).reduce((s, n) => s + n, 0).toLocaleString("th-TH")}
          </p>
        </div>

        {/* Status filters */}
        <div className="p-3">
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-400 font-bold px-2 mb-1.5">
            STATUS
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
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-400 font-bold px-2 mb-1.5">
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
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-400 font-bold px-2 mb-1.5">
            ลิ้งค์ด่วน
          </p>
          <Link
            href="/recruit/postings"
            className="block text-xs text-zinc-600 hover:text-[var(--color-brand-700)] px-2 py-1.5 rounded hover:bg-zinc-50"
          >
            📋 ประกาศทั้งหมด
          </Link>
          <Link
            href="/recruit/pipeline"
            className="block text-xs text-zinc-600 hover:text-[var(--color-brand-700)] px-2 py-1.5 rounded hover:bg-zinc-50"
          >
            📊 Pipeline view
          </Link>
          <Link
            href="/recruit/tasks"
            className="block text-xs text-zinc-600 hover:text-[var(--color-brand-700)] px-2 py-1.5 rounded hover:bg-zinc-50"
          >
            ✓ งานต้องตาม
          </Link>
        </div>
      </aside>

      {/* PANE 2: List (middle) */}
      <section className="flex flex-col w-full lg:w-[380px] shrink-0 border-r border-zinc-200 bg-white overflow-hidden">
        <div className="p-3 border-b border-zinc-100">
          <SearchBar defaultValue={currentQuery} />
          <div className="flex items-center justify-between mt-3 text-xs">
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
                className="text-[var(--color-brand-700)] font-bold hover:underline"
              >
                + ประกาศใหม่
              </Link>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {apps.length === 0 ? (
            <div className="p-10 text-center text-sm text-zinc-500">
              ยังไม่มีใบสมัครที่ตรงเงื่อนไข
            </div>
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
                      <span className="text-[10px] font-bold text-red-600">⚠ BL</span>
                    )}
                    {app.starRating != null && (
                      <span className="text-xs text-amber-500">
                        {"★".repeat(app.starRating)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Badge tone={STATUS_TONE[app.status as ApplicationStatus]}>
                    <span className="size-1.5 rounded-full bg-current opacity-60" />
                    {STATUS_LABELS[app.status as ApplicationStatus]}
                  </Badge>
                  <span className="text-[10px] text-zinc-400">
                    {app.submittedAt
                      ? thaiDateLong(app.submittedAt)
                      : "ยังไม่ส่ง"}
                  </span>
                </div>
              </Link>
            ))
          )}
        </div>
      </section>

      {/* PANE 3: Detail (right) */}
      <main className="flex-1 overflow-y-auto bg-zinc-50/50 hidden lg:block">
        {selected ? (
          <ApplicationDetail
            applicationId={selected.id}
            canWrite={canWrite}
          />
        ) : (
          <div className="p-20 text-center text-sm text-zinc-400">
            เลือกใบสมัครจากรายการ
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
  tone,
  truncate,
}: {
  href: string;
  label: string;
  count?: number;
  active?: boolean;
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
        <span className="text-[10px] tabular-num text-zinc-400 shrink-0">{count}</span>
      )}
    </Link>
  );
}

function SearchBar({ defaultValue }: { defaultValue: string }) {
  return (
    <form action="" method="GET">
      <input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder="ค้นชื่อ / เบอร์ / เลขใบสมัคร..."
        className="w-full text-xs rounded-xl border border-zinc-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)]"
      />
    </form>
  );
}

function buildUrl(params: {
  status?: ApplicationStatus | null;
  posting?: string | null;
  q?: string;
  selected?: string;
}): string {
  const sp = new URLSearchParams();
  if (params.status) sp.set("status", params.status);
  if (params.posting) sp.set("posting", params.posting);
  if (params.q) sp.set("q", params.q);
  if (params.selected) sp.set("selected", params.selected);
  const qs = sp.toString();
  return `/recruit${qs ? `?${qs}` : ""}`;
}
