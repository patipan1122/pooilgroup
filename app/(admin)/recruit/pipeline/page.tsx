// /recruit/pipeline — Kanban view (3-pane workspace per [[ceo-prefers-multi-pane-workspace]])
// Layout: filters (left) | Kanban (middle) | detail (right · auto-opens on card click)

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRecruitAccess, canRecruitWrite } from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import { type ApplicationStatus } from "@/lib/recruit/types";
import { PipelineColumn } from "@/components/recruit/pipeline-column";
import { ApplicationDetail } from "@/components/recruit/application-detail";
import { ViewToggle } from "@/components/recruit/view-toggle";
import {
  ClipboardList,
  Inbox as InboxIcon,
  ListChecks,
  Plus,
} from "lucide-react";

export const dynamic = "force-dynamic";

interface SearchParams {
  posting?: string;
  company?: string;
  selected?: string;
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireSession();
  requireRecruitAccess(session.user.role);
  const params = await searchParams;
  const postingFilter = params.posting ?? null;
  const companyFilter = params.company ?? null;
  const selectedId = params.selected ?? null;

  const [postings, companies, apps, countsByStatus] = await Promise.all([
    prisma.recruitJobPosting.findMany({
      where: {
        orgId: session.user.org_id,
        status: { in: ["OPEN", "CLOSED"] },
        ...(companyFilter ? { companyId: companyFilter } : {}),
      },
      select: { id: true, title: true, companyId: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.company.findMany({
      where: { orgId: session.user.org_id, isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: { code: "asc" },
    }),
    prisma.recruitApplication.findMany({
      where: {
        orgId: session.user.org_id,
        draft: false,
        ...(postingFilter ? { postingId: postingFilter } : {}),
        ...(companyFilter
          ? { posting: { companyId: companyFilter } }
          : {}),
        status: { notIn: ["WITHDRAWN"] },
      },
      include: {
        applicant: { select: { fullName: true, phone: true } },
        posting: { select: { title: true, companyId: true } },
      },
      orderBy: { submittedAt: "desc" },
      take: 300,
    }),
    prisma.recruitApplication.groupBy({
      by: ["status"],
      where: { orgId: session.user.org_id, draft: false },
      _count: { _all: true },
    }),
  ]);

  const grouped: Record<ApplicationStatus, typeof apps> = {
    NEW: [],
    SCREENING: [],
    INTERVIEW: [],
    OFFERED: [],
    HIRED: [],
    REJECTED: [],
    WITHDRAWN: [],
  };
  for (const a of apps) grouped[a.status as ApplicationStatus].push(a);

  const countMap: Record<ApplicationStatus, number> = {
    NEW: 0,
    SCREENING: 0,
    INTERVIEW: 0,
    OFFERED: 0,
    HIRED: 0,
    REJECTED: 0,
    WITHDRAWN: 0,
  };
  for (const c of countsByStatus)
    countMap[c.status as ApplicationStatus] = c._count._all;

  const canWrite = canRecruitWrite(session.user.role);
  const showStatuses: ApplicationStatus[] = [
    "NEW",
    "SCREENING",
    "INTERVIEW",
    "OFFERED",
    "HIRED",
    "REJECTED",
  ];

  const buildUrl = (next: SearchParams) => {
    const sp = new URLSearchParams();
    if (next.posting) sp.set("posting", next.posting);
    if (next.company) sp.set("company", next.company);
    if (next.selected) sp.set("selected", next.selected);
    const qs = sp.toString();
    return `/recruit/pipeline${qs ? `?${qs}` : ""}`;
  };

  const listHref = (() => {
    const sp = new URLSearchParams();
    if (postingFilter) sp.set("posting", postingFilter);
    const qs = sp.toString();
    return `/recruit${qs ? `?${qs}` : ""}`;
  })();

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-60px)]">
      {/* PANE 1: Filters (left) */}
      <aside className="hidden lg:flex flex-col w-56 shrink-0 border-r border-zinc-200 bg-white overflow-y-auto">
        {/* KPI strip */}
        <div className="p-3 border-b border-zinc-100 grid grid-cols-2 gap-2">
          <KpiTile
            label="ทั้งหมด"
            value={Object.values(countMap).reduce((s, n) => s + n, 0)}
            tone="brand"
          />
          <KpiTile label="ใหม่" value={countMap.NEW} tone="brand" />
          <KpiTile
            label="กำลังคุย"
            value={countMap.SCREENING + countMap.INTERVIEW + countMap.OFFERED}
            tone="warning"
          />
          <KpiTile label="รับแล้ว" value={countMap.HIRED} tone="success" />
        </div>

        {/* Company filter */}
        {companies.length > 1 && (
          <div className="p-3 border-b border-zinc-100">
            <p className="text-[11px] text-zinc-500 font-bold px-2 mb-1.5">
              บริษัท
            </p>
            <FilterRow
              href={buildUrl({ posting: postingFilter ?? undefined })}
              label="ทุกบริษัท"
              active={!companyFilter}
            />
            {companies.map((c) => (
              <FilterRow
                key={c.id}
                href={buildUrl({
                  company: c.id,
                  posting: postingFilter ?? undefined,
                })}
                label={c.name}
                active={companyFilter === c.id}
              />
            ))}
          </div>
        )}

        {/* Posting filter */}
        {postings.length > 0 && (
          <div className="p-3 border-b border-zinc-100">
            <p className="text-[11px] text-zinc-500 font-bold px-2 mb-1.5">
              ตำแหน่ง
            </p>
            <FilterRow
              href={buildUrl({ company: companyFilter ?? undefined })}
              label="ทุกตำแหน่ง"
              active={!postingFilter}
            />
            {postings.slice(0, 12).map((p) => (
              <FilterRow
                key={p.id}
                href={buildUrl({
                  posting: p.id,
                  company: companyFilter ?? undefined,
                })}
                label={p.title}
                active={postingFilter === p.id}
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
            className="flex items-center gap-2 text-xs text-zinc-600 hover:text-[var(--color-brand-700)] px-2 py-1.5 rounded hover:bg-zinc-50"
          >
            <ClipboardList className="size-3.5" />
            ประกาศทั้งหมด
          </Link>
          <Link
            href="/recruit/tasks"
            className="flex items-center gap-2 text-xs text-zinc-600 hover:text-[var(--color-brand-700)] px-2 py-1.5 rounded hover:bg-zinc-50"
          >
            <ListChecks className="size-3.5" />
            งานต้องตาม
          </Link>
        </div>
      </aside>

      {/* PANE 2: Kanban (middle) — hide on mobile when detail is open */}
      <section
        className={`flex flex-col flex-1 min-w-0 bg-zinc-50/30 overflow-hidden ${
          selectedId ? "hidden lg:flex" : "flex"
        }`}
      >
        {/* Toolbar */}
        <div className="border-b border-zinc-200 bg-white p-3 sm:p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-bold">
              Pipeline
            </p>
            <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-zinc-900 font-display">
              ใบสมัครงาน
            </h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ViewToggle
              current="kanban"
              listHref={listHref}
              kanbanHref="/recruit/pipeline"
            />
            {canWrite && (
              <Link
                href="/recruit/postings/new"
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-[var(--color-brand-600)] text-white text-xs font-bold hover:bg-[var(--color-brand-700)]"
              >
                <Plus className="size-3.5" />
                ประกาศใหม่
              </Link>
            )}
          </div>
        </div>

        {/* Mobile filter pills (replaces hidden desktop sidebar on <lg) */}
        {(companies.length > 1 || postings.length > 0) && (
          <div className="lg:hidden border-b border-zinc-200 bg-white px-3 py-2 overflow-x-auto">
            <div className="flex items-center gap-1.5 min-w-fit">
              <Link
                href={buildUrl({ posting: postingFilter ?? undefined })}
                className={`h-9 px-3 inline-flex items-center rounded-lg text-xs font-bold whitespace-nowrap border ${
                  !companyFilter
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "bg-white text-zinc-700 border-zinc-200"
                }`}
              >
                ทุกบริษัท
              </Link>
              {companies.slice(0, 4).map((c) => (
                <Link
                  key={c.id}
                  href={buildUrl({
                    company: c.id,
                    posting: postingFilter ?? undefined,
                  })}
                  className={`h-9 px-3 inline-flex items-center rounded-lg text-xs font-bold whitespace-nowrap border ${
                    companyFilter === c.id
                      ? "bg-zinc-900 text-white border-zinc-900"
                      : "bg-white text-zinc-700 border-zinc-200"
                  }`}
                >
                  {c.name}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Kanban board */}
        <div className="flex-1 overflow-auto p-3 sm:p-5">
          {apps.length === 0 ? (
            <div className="rounded-3xl border-2 border-dashed border-zinc-200 bg-white p-12 text-center max-w-2xl mx-auto mt-10">
              <InboxIcon className="size-12 mx-auto text-zinc-300" />
              <p className="mt-4 font-bold text-zinc-900">ยังไม่มีใบสมัคร</p>
              <p className="text-sm text-zinc-500 mt-1.5 max-w-md mx-auto">
                {postingFilter || companyFilter
                  ? "ไม่พบใบสมัครที่ตรงเงื่อนไข · ลองล้างตัวกรอง"
                  : "เผยแพร่ประกาศ → แชร์ลิ้งค์ใน Facebook/LINE → ใบสมัครจะโผล่ที่นี่"}
              </p>
              <Link
                href="/recruit/postings"
                className="inline-flex items-center gap-1.5 mt-5 text-sm font-bold text-[var(--color-brand-700)] hover:underline"
              >
                ดูประกาศทั้งหมด →
              </Link>
            </div>
          ) : (
            <div className="flex gap-3 min-w-max lg:min-w-0 lg:grid lg:grid-cols-3 xl:grid-cols-6">
              {showStatuses.map((s) => (
                <PipelineColumn
                  key={s}
                  status={s}
                  applications={grouped[s].map((a) => ({
                    id: a.id,
                    applicantName: a.applicant.fullName,
                    phone: a.applicant.phone,
                    posting: a.posting.title,
                    aiScore: a.aiScore,
                    starRating: a.starRating,
                    flagged: a.flaggedBlacklist,
                    refId: a.refId,
                    tags: a.tags ?? [],
                    updatedAt: (a.updatedAt ?? a.submittedAt ?? a.createdAt)?.toISOString() ?? null,
                  }))}
                  canWrite={canWrite}
                  selectHref={(id) =>
                    buildUrl({
                      posting: postingFilter ?? undefined,
                      company: companyFilter ?? undefined,
                      selected: id,
                    })
                  }
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* PANE 3: Detail (right · slide-in on mobile) */}
      {selectedId && (
        <main className="flex-1 lg:flex-none lg:w-[480px] xl:w-[560px] overflow-y-auto bg-white border-l border-zinc-200">
          <div className="sticky top-0 z-10 bg-white border-b border-zinc-200 px-3 py-2 flex items-center justify-between">
            <Link
              href={buildUrl({
                posting: postingFilter ?? undefined,
                company: companyFilter ?? undefined,
              })}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-zinc-700 font-bold text-sm hover:bg-zinc-100"
            >
              ← ปิด
            </Link>
            <Link
              href={`/recruit/applications/${selectedId}`}
              className="text-xs text-[var(--color-brand-700)] font-bold hover:underline"
            >
              เปิดเต็มหน้า →
            </Link>
          </div>
          <ApplicationDetail applicationId={selectedId} canWrite={canWrite} />
        </main>
      )}
    </div>
  );
}

function KpiTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "brand" | "warning" | "success";
}) {
  const toneClass =
    tone === "warning"
      ? "text-amber-700"
      : tone === "success"
        ? "text-green-700"
        : "text-[var(--color-brand-700)]";
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/40 p-2.5">
      <p className="text-[9px] uppercase tracking-[0.16em] text-zinc-500 font-bold leading-tight">
        {label}
      </p>
      <p
        className={`mt-1 text-xl font-extrabold tabular-num leading-none ${toneClass}`}
      >
        {value.toLocaleString("th-TH")}
      </p>
    </div>
  );
}

function FilterRow({
  href,
  label,
  active,
  truncate,
}: {
  href: string;
  label: string;
  active?: boolean;
  truncate?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center px-2 py-1.5 rounded-lg text-xs font-medium ${
        active
          ? "bg-[var(--color-brand-50)] text-[var(--color-brand-800)]"
          : "text-zinc-700 hover:bg-zinc-50"
      }`}
    >
      <span className={truncate ? "truncate" : ""}>{label}</span>
    </Link>
  );
}
