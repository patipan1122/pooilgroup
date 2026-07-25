// /recruit/table — Excel-style table view (มุมมองที่ 3 ต่อจาก List/Kanban)
// เห็นผู้สมัครทุกคนเป็นแถว · กดเปลี่ยนสถานะ/คัดกรองในตาราง · สรุปคะแนนแถบบน
// แบ่งหน้า 50/หน้า + ค้นหา + กรองสถานะ + เรียงคอลัมน์ (server-side)

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import {
  requireRecruitAccess,
  canRecruitWrite,
} from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  FormSchemaSchema,
  parseScreeningVerdict,
  parseGender,
  type ApplicationStatus,
} from "@/lib/recruit/types";
import {
  getAnswerColumns,
  formatAnswerValue,
  parsePostingAiBrief,
  type AppFileMeta,
} from "@/lib/recruit/answers";
import { computeIqStats } from "@/lib/recruit/iq";
import { thaiDateLong } from "@/lib/utils/format";
import { ViewToggle } from "@/components/recruit/view-toggle";
import { PostingSelect } from "@/components/recruit/posting-select";
import { resolveCompanyFilter } from "@/lib/auth/company-context";
import {
  ApplicationsTable,
  type TableRow,
  type AnswerColumnMeta,
} from "@/components/recruit/applications-table";
import { ChevronLeft, ChevronRight, Plus, SearchX } from "lucide-react";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const SORTS = ["recent", "name", "ai", "star"] as const;
type Sort = (typeof SORTS)[number];

interface SearchParams {
  status?: string;
  posting?: string;
  q?: string;
  sort?: string;
  page?: string;
  gender?: string; // male | female | other
  ageMin?: string;
  ageMax?: string;
  highlight?: string; // "1" = เฉพาะที่เล็งไว้ (👍 น่าสนใจ)
  company?: string; // จาก "ตัวสลับบริษัทด้านบน"
}

const GENDERS = ["male", "female", "other"] as const;
const GENDER_FILTER_LABELS: Record<string, string> = {
  male: "ชาย",
  female: "หญิง",
  other: "อื่นๆ",
};

export default async function RecruitTablePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireSession();
  requireRecruitAccess(session.user.role);
  const orgId = session.user.org_id;
  const canWrite = canRecruitWrite(session.user.role);

  const params = await searchParams;
  const statusFilter =
    params.status && (APPLICATION_STATUSES as readonly string[]).includes(params.status)
      ? (params.status as ApplicationStatus)
      : null;
  const postingFilter = params.posting ?? null;
  const companyFilter = await resolveCompanyFilter(params.company);
  const query = (params.q ?? "").trim();
  const sort: Sort = (SORTS as readonly string[]).includes(params.sort ?? "")
    ? (params.sort as Sort)
    : "recent";
  const pageRaw = parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  // Filter ใหม่ — เพศ (โครง DB) · อายุ (จากคำตอบในฟอร์ม) · ไฮไลต์ (เฉพาะที่เล็งไว้)
  const genderFilter =
    params.gender && (GENDERS as readonly string[]).includes(params.gender)
      ? params.gender
      : null;
  const highlightOnly = params.highlight === "1";
  const parseAge = (v?: string) => {
    const n = parseInt(v ?? "", 10);
    return Number.isFinite(n) && n >= 0 && n <= 120 ? n : null;
  };
  const ageMin = parseAge(params.ageMin);
  const ageMax = parseAge(params.ageMax);

  // อายุอยู่ในคำตอบ (ต่อตำแหน่ง) — หา field "อายุ" ของตำแหน่งที่เลือก
  let ageFieldId: string | null = null;
  if (postingFilter) {
    const p = await prisma.recruitJobPosting.findFirst({
      where: { id: postingFilter, orgId },
      select: { fieldSchema: true },
    });
    const parsed = p ? FormSchemaSchema.safeParse(p.fieldSchema) : null;
    if (parsed?.success) {
      outer: for (const sec of parsed.data.sections) {
        for (const f of sec.fields) {
          if (f.label.toLowerCase().includes("อายุ") && f.type !== "file") {
            ageFieldId = f.id;
            break outer;
          }
        }
      }
    }
  }
  const hasAgeField = ageFieldId != null;

  // กรองอายุ — ดึง id ที่ตรงช่วงด้วย SQL (แกะเฉพาะตัวเลขจากคำตอบ · รองรับ "27 ปี")
  let ageIdFilter: { id?: { in: string[] } } = {};
  if (ageFieldId && (ageMin != null || ageMax != null)) {
    const lo = ageMin ?? 0;
    const hi = ageMax ?? 120;
    // ใช้ CASE บังคับลำดับ: CAST เป็น INTEGER จะรัน "เฉพาะ" แถวที่ผ่าน regex 1-3 หลักก่อน
    // (Postgres ไม่การันตีลำดับของ AND — ถ้า planner CAST ก่อนอาจเจอค่าว่าง/เลขยาว → query ล้ม → หน้า 500)
    const matched = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM recruit_applications
      WHERE org_id = ${orgId}::uuid AND posting_id = ${postingFilter}::uuid AND draft = false
      AND CASE
        WHEN regexp_replace(COALESCE(answers->>${ageFieldId}, ''), '[^0-9]', '', 'g') ~ '^[0-9]{1,3}$'
        THEN CAST(regexp_replace(answers->>${ageFieldId}, '[^0-9]', '', 'g') AS INTEGER) BETWEEN ${lo} AND ${hi}
        ELSE false
      END
    `;
    ageIdFilter = { id: { in: matched.map((r) => r.id) } };
  }

  // where (with status) vs whereBase (without status, for status chips)
  const searchWhere = query
    ? {
        OR: [
          { applicant: { fullName: { contains: query, mode: "insensitive" as const } } },
          { applicant: { phone: { contains: query } } },
          { refId: { contains: query, mode: "insensitive" as const } },
        ],
      }
    : {};
  const whereBase = {
    orgId,
    draft: false,
    ...(postingFilter ? { postingId: postingFilter } : {}),
    // กรองตามบริษัทที่เลือกด้านบน (เป๊ะ) — ผู้สมัครของประกาศที่อยู่บริษัทนั้นเท่านั้น.
    ...(companyFilter ? { posting: { companyId: companyFilter } } : {}),
    ...(genderFilter ? { applicant: { gender: genderFilter } } : {}),
    ...(highlightOnly ? { screeningVerdict: "INTERESTING" } : {}),
    ...ageIdFilter,
    ...searchWhere,
  };
  const where = {
    ...whereBase,
    ...(statusFilter ? { status: statusFilter } : {}),
  };

  const orderBy =
    sort === "name"
      ? { applicant: { fullName: "asc" as const } }
      : sort === "ai"
        ? { aiScore: { sort: "desc" as const, nulls: "last" as const } }
        : sort === "star"
          ? { starRating: { sort: "desc" as const, nulls: "last" as const } }
          : [
              { submittedAt: { sort: "desc" as const, nulls: "last" as const } },
              { createdAt: "desc" as const },
            ];

  const [
    filteredTotal,
    apps,
    countsByStatus,
    verdictCounts,
    agg,
    postings,
    batchList,
  ] = await Promise.all([
      prisma.recruitApplication.count({ where }),
      prisma.recruitApplication.findMany({
        where,
        orderBy,
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          refId: true,
          status: true,
          aiScore: true,
          starRating: true,
          screeningVerdict: true,
          aiSummary: true,
          tags: true,
          flaggedBlacklist: true,
          submittedAt: true,
          answers: true,
          files: true,
          applicant: { select: { fullName: true, phone: true, gender: true } },
          posting: {
            select: {
              title: true,
              fieldSchema: true,
              settings: true,
            },
          },
          // โน้ตสัมภาษณ์ล่าสุด (โชว์ในคอลัมน์/การ์ด) + จำนวนทั้งหมด
          notes: {
            orderBy: { createdAt: "desc" as const },
            take: 1,
            select: {
              body: true,
              createdAt: true,
              user: { select: { name: true } },
            },
          },
          _count: { select: { notes: true } },
        },
      }),
      prisma.recruitApplication.groupBy({
        by: ["status"],
        where: whereBase,
        _count: { _all: true },
      }),
      prisma.recruitApplication.groupBy({
        by: ["screeningVerdict"],
        where,
        _count: { _all: true },
      }),
      prisma.recruitApplication.aggregate({
        where,
        _avg: { aiScore: true, starRating: true },
        _count: { starRating: true },
      }),
      prisma.recruitJobPosting.findMany({
        where: {
          orgId,
          status: { in: ["OPEN", "CLOSED"] },
          ...(companyFilter ? { companyId: companyFilter } : {}),
        },
        select: { id: true, title: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      // Batch AI targets — เบา ๆ แค่ id + มีคะแนนหรือยัง (ครอบทั้งตัวกรอง ไม่ใช่แค่หน้านี้)
      prisma.recruitApplication.findMany({
        where,
        select: { id: true, aiScore: true },
        take: 500,
      }),
    ]);

  const totalPages = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));

  // status chip counts (within posting + query, ignoring the status filter)
  const countMap: Record<ApplicationStatus, number> = {
    NEW: 0, SCREENING: 0, INTERVIEW: 0, OFFERED: 0, HIRED: 0, REJECTED: 0, WITHDRAWN: 0,
  };
  for (const c of countsByStatus)
    countMap[c.status as ApplicationStatus] = c._count._all;
  const baseTotal = Object.values(countMap).reduce((s, n) => s + n, 0);

  // verdict summary (within current view)
  let vInteresting = 0, vMaybe = 0, vNot = 0;
  for (const v of verdictCounts) {
    if (v.screeningVerdict === "INTERESTING") vInteresting = v._count._all;
    else if (v.screeningVerdict === "MAYBE") vMaybe = v._count._all;
    else if (v.screeningVerdict === "NOT_INTERESTED") vNot = v._count._all;
  }

  const avgAi = agg._avg.aiScore != null ? Math.round(agg._avg.aiScore) : null;
  const avgStar =
    agg._avg.starRating != null ? agg._avg.starRating.toFixed(1) : null;
  const ratedCount = agg._count.starRating;

  const postingTitleById = new Map(postings.map((p) => [p.id, p.title]));
  const activePostingTitle = postingFilter
    ? postingTitleById.get(postingFilter) ?? "ตำแหน่งที่เลือก"
    : null;

  // คอลัมน์คำตอบ — กางเฉพาะเมื่อเลือกตำแหน่ง (ทุกคนในตำแหน่งใช้ชุดคำถามเดียวกัน)
  const answerCols =
    postingFilter && apps.length > 0
      ? (() => {
          const parsed = FormSchemaSchema.safeParse(apps[0].posting.fieldSchema);
          return parsed.success ? getAnswerColumns(parsed.data) : [];
        })()
      : [];
  const answerColumns: AnswerColumnMeta[] = answerCols.map((c) => ({
    id: c.id,
    label: c.label,
    long: c.long,
  }));

  const rows: TableRow[] = apps.map((a) => {
    const rawAnswers = (a.answers ?? {}) as Record<string, unknown>;
    const answers: Record<string, string> = {};
    for (const c of answerCols) {
      answers[c.id] = formatAnswerValue(c.field, rawAnswers[c.id]);
    }
    const files = Array.isArray(a.files)
      ? (a.files as unknown as AppFileMeta[])
      : [];
    const latest = a.notes[0] ?? null;
    return {
      id: a.id,
      refId: a.refId,
      fullName: a.applicant.fullName,
      phone: a.applicant.phone,
      gender: parseGender(a.applicant.gender),
      postingTitle: a.posting.title,
      iq: computeIqStats(a.posting.fieldSchema, a.answers),
      aiScore: a.aiScore,
      aiSummary: a.aiSummary,
      starRating: a.starRating,
      verdict: parseScreeningVerdict(a.screeningVerdict),
      status: a.status as ApplicationStatus,
      tags: a.tags ?? [],
      flagged: a.flaggedBlacklist,
      submittedAt: a.submittedAt ? thaiDateLong(a.submittedAt) : null,
      files,
      answers,
      latestNote: latest
        ? {
            body: latest.body,
            atLabel: thaiDateLong(latest.createdAt),
            author: latest.user?.name ?? "—",
          }
        : null,
      noteCount: a._count.notes,
    };
  });

  const batchTargets = batchList.map((b) => ({
    id: b.id,
    scored: b.aiScore != null,
  }));
  // id ในตัวกรองปัจจุบัน (สำหรับ AI ค้นหาประวัติ · client cap ต่อครั้งอีกที)
  const searchTargets = batchList.map((b) => b.id);

  // ตำแหน่งที่เลือก (สำหรับปุ่มข้อมูลตำแหน่ง AI + gate batch) — ดึง aiBrief จาก settings
  const postingProp =
    postingFilter && apps.length > 0
      ? {
          id: postingFilter,
          title: apps[0].posting.title,
          aiBrief: parsePostingAiBrief(apps[0].posting.settings),
        }
      : null;

  // URL builder — preserve filters
  const buildUrl = (next: Partial<SearchParams>) => {
    const sp = new URLSearchParams();
    const s = next.status !== undefined ? next.status : statusFilter;
    const p = next.posting !== undefined ? next.posting : postingFilter;
    const q = next.q !== undefined ? next.q : query;
    const so = next.sort !== undefined ? next.sort : sort;
    const pg = next.page !== undefined ? next.page : String(page);
    const g = next.gender !== undefined ? next.gender : genderFilter;
    const amin = next.ageMin !== undefined ? next.ageMin : ageMin != null ? String(ageMin) : "";
    const amax = next.ageMax !== undefined ? next.ageMax : ageMax != null ? String(ageMax) : "";
    const hl = next.highlight !== undefined ? next.highlight : highlightOnly ? "1" : "";
    if (s) sp.set("status", s);
    if (p) sp.set("posting", p);
    if (q) sp.set("q", q);
    if (so && so !== "recent") sp.set("sort", so);
    if (pg && pg !== "1") sp.set("page", pg);
    if (g) sp.set("gender", g);
    if (amin) sp.set("ageMin", amin);
    if (amax) sp.set("ageMax", amax);
    if (hl === "1") sp.set("highlight", "1");
    const qs = sp.toString();
    return `/recruit/table${qs ? `?${qs}` : ""}`;
  };

  // Sorting a column resets to page 1
  const sortLinks = {
    name: buildUrl({ sort: "name", page: "1" }),
    ai: buildUrl({ sort: "ai", page: "1" }),
    star: buildUrl({ sort: "star", page: "1" }),
    recent: buildUrl({ sort: "recent", page: "1" }),
  };

  const listHref = buildUrl({ page: "1", sort: "recent" }).replace(
    "/recruit/table",
    "/recruit",
  );

  return (
    <div className="min-h-[calc(100vh-60px)] bg-zinc-50/40">
      {/* Toolbar */}
      <div className="border-b border-zinc-200 bg-white px-4 sm:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-bold">
            ตาราง
          </p>
          <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-zinc-900 font-display">
            ผู้สมัครทั้งหมด
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ViewToggle
            current="table"
            listHref={listHref}
            kanbanHref={`/recruit/pipeline${
              postingFilter ? `?posting=${postingFilter}` : ""
            }`}
            tableHref={buildUrl({})}
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

      <div className="p-4 sm:p-6 space-y-4">
        {/* สรุปคะแนน — แถบบน */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <SummaryTile label="ทั้งหมด (กรอง)" value={filteredTotal.toLocaleString("th-TH")} accent="brand" />
          <SummaryTile label="คะแนน AI เฉลี่ย" value={avgAi != null ? String(avgAi) : "—"} accent="brand" />
          <SummaryTile label="ดาวเฉลี่ย" value={avgStar != null ? `${avgStar}★` : "—"} accent="amber" />
          <SummaryTile label="คัดกรอง: น่าสนใจ" value={String(vInteresting)} accent="green" />
          <SummaryTile label="คัดกรอง: พอใช้ได้" value={String(vMaybe)} accent="amber" />
          <SummaryTile label="คัดกรอง: ไม่สนใจ" value={String(vNot)} accent="red" />
        </div>

        {/* Filters: search + posting + batch AI + status chips */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <form
              action="/recruit/table"
              method="GET"
              className="flex items-center gap-2"
            >
              {statusFilter && (
                <input type="hidden" name="status" value={statusFilter} />
              )}
              {postingFilter && (
                <input type="hidden" name="posting" value={postingFilter} />
              )}
              {sort !== "recent" && (
                <input type="hidden" name="sort" value={sort} />
              )}
              <input
                type="search"
                name="q"
                defaultValue={query}
                placeholder="ค้นชื่อ / เบอร์ / เลขใบสมัคร..."
                className="w-full sm:max-w-xs text-sm rounded-xl border border-zinc-200 h-10 px-3 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)]"
              />
            </form>
            <PostingSelect
              postings={postings}
              currentPosting={postingFilter}
              status={statusFilter}
              q={query}
              sort={sort}
            />
          </div>

          {/* Filter: เพศ · ไฮไลต์ · อายุ */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="inline-flex items-center gap-1.5">
              <span className="text-[11px] text-zinc-400">เพศ:</span>
              <FilterChip
                href={buildUrl({ gender: "", page: "1" })}
                label="ทั้งหมด"
                active={!genderFilter}
              />
              {GENDERS.map((g) => (
                <FilterChip
                  key={g}
                  href={buildUrl({ gender: g, page: "1" })}
                  label={GENDER_FILTER_LABELS[g]}
                  active={genderFilter === g}
                />
              ))}
            </div>

            <Link
              href={buildUrl({ highlight: highlightOnly ? "" : "1", page: "1" })}
              className={`inline-flex items-center gap-1 h-8 px-3 rounded-lg text-xs font-bold border transition-colors ${
                highlightOnly
                  ? "bg-amber-100 text-amber-800 border-amber-300"
                  : "bg-white text-zinc-600 border-zinc-200 hover:border-amber-300"
              }`}
            >
              ⭐ เฉพาะที่เล็งไว้
            </Link>

            {hasAgeField && (
              <form
                action="/recruit/table"
                method="GET"
                className="inline-flex items-center gap-1.5"
              >
                {postingFilter && (
                  <input type="hidden" name="posting" value={postingFilter} />
                )}
                {statusFilter && (
                  <input type="hidden" name="status" value={statusFilter} />
                )}
                {query && <input type="hidden" name="q" value={query} />}
                {sort !== "recent" && (
                  <input type="hidden" name="sort" value={sort} />
                )}
                {genderFilter && (
                  <input type="hidden" name="gender" value={genderFilter} />
                )}
                {highlightOnly && (
                  <input type="hidden" name="highlight" value="1" />
                )}
                <span className="text-[11px] text-zinc-400">อายุ:</span>
                <input
                  type="number"
                  name="ageMin"
                  defaultValue={ageMin ?? ""}
                  min={0}
                  max={120}
                  placeholder="จาก"
                  className="w-14 h-8 rounded-lg border border-zinc-200 px-2 text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)]"
                />
                <span className="text-zinc-300 text-xs">–</span>
                <input
                  type="number"
                  name="ageMax"
                  defaultValue={ageMax ?? ""}
                  min={0}
                  max={120}
                  placeholder="ถึง"
                  className="w-14 h-8 rounded-lg border border-zinc-200 px-2 text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)]"
                />
                <button
                  type="submit"
                  className="h-8 px-2.5 rounded-lg bg-zinc-900 text-white text-xs font-bold hover:bg-zinc-700"
                >
                  กรอง
                </button>
                {(ageMin != null || ageMax != null) && (
                  <Link
                    href={buildUrl({ ageMin: "", ageMax: "", page: "1" })}
                    className="text-[11px] text-zinc-400 hover:text-zinc-700"
                  >
                    ล้าง
                  </Link>
                )}
              </form>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <StatusChip
              href={buildUrl({ status: "", page: "1" })}
              label={`ทั้งหมด (${baseTotal.toLocaleString("th-TH")})`}
              active={!statusFilter}
            />
            {APPLICATION_STATUSES.map((s) => (
              <StatusChip
                key={s}
                href={buildUrl({ status: s, page: "1" })}
                label={`${STATUS_LABELS[s]} (${countMap[s].toLocaleString("th-TH")})`}
                active={statusFilter === s}
              />
            ))}
          </div>

          {activePostingTitle && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-zinc-500">ตำแหน่ง:</span>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-50)] text-[var(--color-brand-800)] font-bold px-2 py-1">
                {activePostingTitle}
                <Link href={buildUrl({ posting: "", page: "1" })} aria-label="ล้างตัวกรองตำแหน่ง">
                  ✕
                </Link>
              </span>
            </div>
          )}
        </div>

        {/* Table */}
        {rows.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-zinc-200 bg-white p-12 text-center">
            <SearchX className="size-10 mx-auto text-zinc-300" />
            <p className="mt-3 font-bold text-zinc-700">ไม่พบผู้สมัครที่ตรงเงื่อนไข</p>
            <Link
              href="/recruit/table"
              className="inline-flex items-center justify-center mt-4 h-10 px-4 rounded-xl text-xs font-bold text-[var(--color-brand-700)] border border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]"
            >
              ล้างเงื่อนไข
            </Link>
          </div>
        ) : (
          <>
            <ApplicationsTable
              rows={rows}
              canWrite={canWrite}
              currentSort={sort}
              sortLinks={sortLinks}
              answerColumns={answerColumns}
              storageKey={postingFilter ?? "all"}
              posting={postingProp}
              batchTargets={batchTargets}
              searchTargets={searchTargets}
            />

            {/* Pagination */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-zinc-500">
                แสดง{" "}
                <span className="font-bold text-zinc-800 tabular-num">
                  {(page - 1) * PAGE_SIZE + 1}–
                  {Math.min(page * PAGE_SIZE, filteredTotal)}
                </span>{" "}
                จาก{" "}
                <span className="font-bold text-zinc-800 tabular-num">
                  {filteredTotal.toLocaleString("th-TH")}
                </span>{" "}
                คน
              </p>
              <div className="flex items-center gap-2">
                <PageLink
                  href={buildUrl({ page: String(page - 1) })}
                  disabled={page <= 1}
                  dir="prev"
                />
                <span className="text-xs font-bold text-zinc-600 tabular-num">
                  หน้า {page} / {totalPages}
                </span>
                <PageLink
                  href={buildUrl({ page: String(page + 1) })}
                  disabled={page >= totalPages}
                  dir="next"
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: "brand" | "amber" | "green" | "red";
}) {
  const valueClass =
    accent === "amber"
      ? "text-amber-600"
      : accent === "green"
        ? "text-green-700"
        : accent === "red"
          ? "text-red-600"
          : "text-[var(--color-brand-700)]";
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-2.5">
      <p className="text-[10px] text-zinc-500 font-bold leading-tight truncate">
        {label}
      </p>
      <p className={`mt-1 text-xl font-extrabold tabular-num leading-none ${valueClass}`}>
        {value}
      </p>
    </div>
  );
}

function StatusChip({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`h-8 px-3 inline-flex items-center rounded-lg text-xs font-bold whitespace-nowrap border transition-colors ${
        active
          ? "bg-zinc-900 text-white border-zinc-900"
          : "bg-white text-zinc-700 border-zinc-200 hover:border-zinc-400"
      }`}
    >
      {label}
    </Link>
  );
}

// ชิปกรองเล็ก (เพศ) — เตี้ยกว่า StatusChip
function FilterChip({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`h-8 px-2.5 inline-flex items-center rounded-lg text-xs font-bold whitespace-nowrap border transition-colors ${
        active
          ? "bg-[var(--color-brand-600)] text-white border-[var(--color-brand-600)]"
          : "bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400"
      }`}
    >
      {label}
    </Link>
  );
}

function PageLink({
  href,
  disabled,
  dir,
}: {
  href: string;
  disabled: boolean;
  dir: "prev" | "next";
}) {
  const Icon = dir === "prev" ? ChevronLeft : ChevronRight;
  if (disabled) {
    return (
      <span className="size-9 grid place-items-center rounded-lg border border-zinc-200 text-zinc-300">
        <Icon className="size-4" />
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="size-9 grid place-items-center rounded-lg border border-zinc-300 text-zinc-700 hover:bg-zinc-100"
      aria-label={dir === "prev" ? "หน้าก่อน" : "หน้าถัดไป"}
    >
      <Icon className="size-4" />
    </Link>
  );
}
