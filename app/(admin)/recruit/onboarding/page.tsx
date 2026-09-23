// /recruit/onboarding — HR review list for the public onboarding flow
// (ระบบรับพนักงานใหม่ออนไลน์ · docs/BIGFEATURE_recruit-onboarding_SPEC.md).
//
// A submission here is NOT linked to the applicant pipeline — that is a locked
// CEO decision (spec §Goal, confirmed twice). Consequence, straight from the
// BranchManager persona: the only thing that ties a row to a real agreed hire
// is HR's own memory of the interview, so this page has to say that out loud
// instead of pretending the link exists.
//
// Gated by the recruit ADMIN tier (same tier that decides PDPA erasure
// requests) — approving here creates a real User account.

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRecruitAdmin } from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import { Section } from "@/components/ui/section";
import { bkkDateTime } from "@/lib/utils/format";
import { ShieldAlert, Users, Paperclip, CopyCheck, Inbox } from "lucide-react";
import {
  ONBOARDING_STATUS_CLASSES,
  ONBOARDING_STATUS_LABELS_TH,
  ONBOARDING_STATUS_ORDER,
  isOnboardingStatus,
} from "./_status";
import { OnboardingShareLink } from "./_components/share-link";

export const dynamic = "force-dynamic";

export const metadata = { title: "พนักงานใหม่ · รอตรวจ" };

export default async function OnboardingReviewListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requireSession();
  requireRecruitAdmin(session.user.role);
  const orgId = session.user.org_id;

  const { status: statusParam } = await searchParams;
  const activeStatus =
    statusParam && isOnboardingStatus(statusParam) ? statusParam : null;

  const [rows, statusCounts, dupGroups] = await Promise.all([
    prisma.recruitOnboardingSubmission.findMany({
      where: { orgId, ...(activeStatus ? { status: activeStatus } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        fullNameTh: true,
        nickname: true,
        nationalId: true,
        positionApplied: true,
        status: true,
        createdAt: true,
        company: { select: { name: true, code: true } },
        branch: { select: { name: true } },
        _count: { select: { documents: true } },
      },
    }),
    prisma.recruitOnboardingSubmission.groupBy({
      by: ["status"],
      where: { orgId },
      _count: { _all: true },
    }),
    // Same national ID submitted more than once anywhere in the org. NOT an
    // auto-block (spec risk #3: a legitimate resubmission after a correction
    // must still go through) — just a visible flag for human judgment.
    prisma.recruitOnboardingSubmission.groupBy({
      by: ["nationalId"],
      where: { orgId },
      _count: { _all: true },
      having: { nationalId: { _count: { gt: 1 } } },
    }),
  ]);

  const countByStatus = new Map(statusCounts.map((c) => [c.status, c._count._all]));
  const total = statusCounts.reduce((sum, c) => sum + c._count._all, 0);
  const duplicateIds = new Set(dupGroups.map((g) => g.nationalId));
  const dupRowsShown = rows.filter((r) => duplicateIds.has(r.nationalId)).length;
  const openCount =
    (countByStatus.get("SUBMITTED") ?? 0) + (countByStatus.get("HR_REVIEWING") ?? 0);

  return (
    <div className="p-4 sm:p-8 max-w-[1400px] mx-auto">
      <Section
        number="14"
        label="ONBOARDING"
        title="พนักงานใหม่ · รอตรวจและอนุมัติ"
        description="ใบกรอกข้อมูลพนักงานใหม่ที่ส่งเข้ามาจากลิงก์สาธารณะ · อนุมัติแล้วระบบจะสร้างบัญชีผู้ใช้ให้ทันที (ยังไม่เปิดใช้งานจนกว่า HR จะกดเปิด)"
      >
        {/* ── ลิงก์ถาวรสำหรับส่งให้พนักงานใหม่ + ปุ่มคัดลอก (CEO 2026-09-23) ── */}
        <OnboardingShareLink />

        {/* ── ด่านที่ระบบทำแทนไม่ได้ — ต้องบอกให้ชัด ไม่ใช่ซ่อนในคู่มือ ── */}
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 mb-4 flex items-start gap-3">
          <ShieldAlert className="size-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-amber-900">
              ยืนยันตัวตนด้วยเบอร์ที่ใช้ตอนสัมภาษณ์จริง — ไม่ใช่เบอร์ที่พิมพ์มาในฟอร์ม
            </p>
            <p className="text-xs text-amber-800 mt-1 leading-relaxed">
              ลิงก์กรอกข้อมูลเป็นลิงก์เดียวใช้ได้ตลอด ไม่ผูกกับตัวบุคคล และระบบ
              <b> ไม่มีการเช็คอัตโนมัติ</b>ว่าใบนี้คือคนที่เราตกลงรับจริง ·
              ก่อนกดอนุมัติให้โทรหาเบอร์ที่คุยกันตอนสัมภาษณ์ แล้วเทียบ ชื่อ/ตำแหน่ง/สาขา/ค่าแรงต่อวัน
              กับที่ตกลงไว้ · อนุมัติ = เกิดบัญชีพนักงานจริงในระบบ
            </p>
          </div>
        </div>

        {duplicateIds.size > 0 && (
          <div className="rounded-2xl bg-orange-50 border border-orange-200 p-4 mb-4 flex items-start gap-3">
            <CopyCheck className="size-5 text-orange-700 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-orange-900">
                เลขบัตรประชาชนซ้ำ {duplicateIds.size} เลข
                {dupRowsShown > 0 && ` (เห็นในรายการนี้ ${dupRowsShown} ใบ)`}
              </p>
              <p className="text-xs text-orange-800 mt-1 leading-relaxed">
                ระบบ<b>ไม่บล็อกอัตโนมัติ</b> เพราะคนที่เคยถูกตีกลับแล้วกรอกใหม่ก็จะซ้ำเหมือนกัน ·
                ให้คนตัดสินเองว่าเป็น “กรอกใหม่หลังแก้ไข” หรือ “มีคนสวมรอย” ·
                แถวที่ซ้ำมีป้าย <b>ซ้ำ</b> กำกับไว้
              </p>
            </div>
          </div>
        )}

        {/* ── ตัวกรองสถานะ ── */}
        <div className="flex flex-wrap gap-2 mb-4">
          <FilterTab href="/recruit/onboarding" label="ทั้งหมด" count={total} active={!activeStatus} />
          {ONBOARDING_STATUS_ORDER.map((s) => (
            <FilterTab
              key={s}
              href={`/recruit/onboarding?status=${s}`}
              label={ONBOARDING_STATUS_LABELS_TH[s]}
              count={countByStatus.get(s) ?? 0}
              active={activeStatus === s}
            />
          ))}
        </div>

        {rows.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-zinc-200 bg-white p-10 text-center">
            <Inbox className="size-10 mx-auto text-zinc-300" />
            <p className="mt-3 font-bold text-zinc-900">
              {activeStatus
                ? `ไม่มีใบในสถานะ “${ONBOARDING_STATUS_LABELS_TH[activeStatus]}”`
                : "ยังไม่มีใบกรอกข้อมูลพนักงานใหม่"}
            </p>
            <p className="text-sm text-zinc-500 mt-1">
              ใบจะขึ้นที่นี่ทันทีที่พนักงานใหม่กรอกฟอร์มและเซ็นสัญญาเสร็จ
            </p>
          </div>
        ) : (
          <>
            {/* มือถือ — การ์ดแตะได้ทั้งใบ */}
            <div className="sm:hidden space-y-2">
              {rows.map((r) => (
                <Link
                  key={r.id}
                  href={`/recruit/onboarding/${r.id}`}
                  className="block rounded-2xl border border-zinc-200 bg-white p-3 active:bg-zinc-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-zinc-900 truncate">
                        {r.fullNameTh}
                        <span className="font-normal text-zinc-500"> ({r.nickname})</span>
                      </p>
                      <p className="text-xs text-zinc-600 truncate mt-0.5">
                        {r.positionApplied} · {r.branch?.name ?? "ยังไม่ระบุสาขา"}
                      </p>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="flex items-center gap-2 mt-2 text-[11px] text-zinc-500 flex-wrap">
                    <span className="font-mono text-zinc-400">#{r.id.slice(0, 8).toUpperCase()}</span>
                    <span>{r.company.name}</span>
                    <span>·</span>
                    <span className="tabular-num">{bkkDateTime(r.createdAt)}</span>
                    <span className="inline-flex items-center gap-0.5">
                      <Paperclip className="size-3" />
                      {r._count.documents}
                    </span>
                    {duplicateIds.has(r.nationalId) && <DupBadge />}
                  </div>
                </Link>
              ))}
            </div>

            {/* เดสก์ท็อป — ตาราง หัวตารางค้างไว้ตอนเลื่อน */}
            <div className="hidden sm:block rounded-2xl border border-zinc-200 bg-white overflow-x-auto max-h-[70vh] overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-zinc-50 border-b border-zinc-200">
                    <Th>ชื่อ-นามสกุล</Th>
                    <Th>ชื่อเล่น</Th>
                    <Th>ตำแหน่ง</Th>
                    <Th>สาขา</Th>
                    <Th>บริษัท</Th>
                    <Th className="text-right">ส่งเมื่อ</Th>
                    <Th className="text-center">เอกสาร</Th>
                    <Th className="text-center">สถานะ</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={r.id}
                      className={`border-b border-zinc-100 hover:bg-[var(--color-brand-50)]/40 ${
                        i % 2 === 0 ? "" : "bg-zinc-50/30"
                      }`}
                    >
                      <td className="px-3 py-2.5">
                        <Link
                          href={`/recruit/onboarding/${r.id}`}
                          className="font-bold text-sm text-zinc-900 hover:text-[var(--color-brand-700)] hover:underline"
                        >
                          {r.fullNameTh}
                        </Link>
                        {duplicateIds.has(r.nationalId) && (
                          <span className="ml-1.5 align-middle">
                            <DupBadge />
                          </span>
                        )}
                        {/* รหัสอ้างอิงที่พนักงานใหม่ได้รับตอนส่งฟอร์ม — ใช้เทียบทางโทรศัพท์ */}
                        <span className="block text-[10px] font-mono text-zinc-400">
                          #{r.id.slice(0, 8).toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-sm text-zinc-700">{r.nickname}</td>
                      <td className="px-3 py-2.5 text-sm text-zinc-700">{r.positionApplied}</td>
                      <td className="px-3 py-2.5 text-sm text-zinc-700">
                        {r.branch?.name ?? <span className="text-zinc-400">ยังไม่ระบุ</span>}
                      </td>
                      <td className="px-3 py-2.5 text-sm text-zinc-700">{r.company.name}</td>
                      <td className="px-3 py-2.5 text-xs text-zinc-600 text-right tabular-num whitespace-nowrap">
                        {bkkDateTime(r.createdAt)}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className="inline-flex items-center gap-1 text-xs text-zinc-700 tabular-num">
                          <Paperclip className="size-3 text-zinc-400" />
                          {r._count.documents}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <StatusBadge status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <p className="text-[11px] text-zinc-400 mt-3 flex items-center gap-1.5">
          <Users className="size-3.5" />
          แสดงล่าสุด {rows.length} ใบ (สูงสุด 200) · รอพิจารณาทั้งหมด {openCount} ใบ
        </p>
      </Section>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`text-left text-[11px] font-bold text-zinc-600 uppercase tracking-wide px-3 py-2.5 bg-zinc-50 whitespace-nowrap ${className}`}
    >
      {children}
    </th>
  );
}

function FilterTab({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-full border text-xs font-bold transition ${
        active
          ? "bg-[var(--color-brand-700)] text-white border-[var(--color-brand-700)]"
          : "bg-white text-zinc-700 border-zinc-200 hover:border-zinc-300"
      }`}
    >
      {label}
      <span className={`tabular-num ${active ? "text-white/80" : "text-zinc-400"}`}>{count}</span>
    </Link>
  );
}

function StatusBadge({ status }: { status: keyof typeof ONBOARDING_STATUS_LABELS_TH }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-bold whitespace-nowrap ${ONBOARDING_STATUS_CLASSES[status]}`}
    >
      {ONBOARDING_STATUS_LABELS_TH[status]}
    </span>
  );
}

function DupBadge() {
  return (
    <span className="inline-block px-1.5 py-0.5 rounded-md bg-orange-100 text-orange-800 border border-orange-200 text-[10px] font-bold">
      ซ้ำ
    </span>
  );
}
