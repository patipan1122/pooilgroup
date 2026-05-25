// Reconcile branch detail (W2 · claude-design Phase 2)
// 3-pane MasterDetailShell:
//   - SIDEBAR (260px) · same branch list as the index page · current branch active
//   - MAIN · drift KPIs + timeline (POS rows + cash collections interleaved) +
//            write-off request form + open alerts list (compact) + audit feed
//   - META (360px) · PhotoProofPanel · shows the latest collection's photo proof
//                    (sticky · empty-state when no photo)
//
// Reuses EXISTING actions from `app/(admin)/chairops/reconcile/actions.ts`
// (disputeCollection · requestWriteOff). The new lib-level recompute action
// is in `lib/chairops/reconcile/actions.ts`. We do NOT modify either's
// signatures.

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import {
  MasterDetailShell,
  stickyTheadClass,
  ChairopsKpiTile,
  ShortageDriftCell,
  MakerCheckerBadge,
  LineNotifyToggle,
  PhotoProofPanel,
  type PhotoProof,
} from "@/components/chairops/_kit";
import { StatusPill } from "@/components/ui/status-pill";
import {
  baht,
  thaiDate,
  thaiDateTime,
  thaiRelative,
} from "@/lib/chairops/utils/format";
import {
  getDashboardRows,
  recomputeDriftForBranch,
} from "@/lib/chairops/reconcile/drift-engine";
import {
  disputeCollection,
  requestWriteOff,
} from "../../../reconcile/actions";
import { RecomputeButton } from "./recompute-button";
import { AlertTriangle, CalendarClock, Receipt, Wallet } from "lucide-react";

export default async function BranchReconcilePage({
  params,
  searchParams,
}: {
  params: Promise<{ branchId: string }>;
  searchParams: Promise<{
    error?: string;
    disputed?: string;
  }>;
}) {
  await requireRole("OFFICE");
  const { branchId } = await params;
  const sp = await searchParams;

  const branch = await prisma.chairopsBranch.findUnique({
    where: { id: branchId },
  });
  if (!branch) notFound();

  // Recompute on-demand so the page is fresh whenever office opens it.
  const drift = await recomputeDriftForBranch(branchId);

  const [posRows, collections, openAlerts, writeOffs, auditLogs, allBranches] =
    await Promise.all([
      prisma.chairopsPosDaily.findMany({
        where: { branchId },
        orderBy: { bizDate: "desc" },
        take: 60,
      }),
      prisma.chairopsCashCollection.findMany({
        where: { branchId },
        orderBy: { collectedAt: "desc" },
        take: 60,
        include: { maid: { select: { id: true, displayName: true } } },
      }),
      prisma.chairopsAlert.findMany({
        where: { branchId, status: { in: ["OPEN", "ACK"] } },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.chairopsWriteOff.findMany({
        where: { branchId },
        orderBy: { makerAt: "desc" },
        take: 10,
        include: {
          maker: { select: { displayName: true } },
          approver: { select: { displayName: true } },
        },
      }),
      prisma.chairopsAuditLog.findMany({
        where: {
          entity: {
            in: ["PosDaily", "CashCollection", "WriteOff", "Alert", "PosImport"],
          },
        },
        orderBy: { createdAt: "desc" },
        take: 25,
        include: { user: { select: { displayName: true, role: true } } },
      }),
      getDashboardRows(),
    ]);

  // Build interleaved timeline
  type Entry =
    | { kind: "pos"; ts: Date; data: (typeof posRows)[number] }
    | { kind: "collection"; ts: Date; data: (typeof collections)[number] };

  const timeline: Entry[] = [
    ...posRows.map((p) => ({ kind: "pos" as const, ts: p.bizDate, data: p })),
    ...collections.map((c) => ({
      kind: "collection" as const,
      ts: c.collectedAt,
      data: c,
    })),
  ].sort((a, b) => b.ts.getTime() - a.ts.getTime());

  // PhotoProofPanel · latest collection w/ evidence photo wins.
  // B18: the real Prisma field is `evidencePhotoUrl` (was incorrectly probing
  // a non-existent `photoUrl` so the panel never populated).
  const latestPhotoCollection = collections.find((c) => c.evidencePhotoUrl);
  // TODO[claude-design]: Wave 2 · attach branch-level "ภาพหน้าตู้" when CCTV
  // proof feature lands.
  const photo: PhotoProof | null = latestPhotoCollection
    ? {
        url: latestPhotoCollection.evidencePhotoUrl,
        takenAt: thaiDateTime(latestPhotoCollection.collectedAt),
        branchName: branch.name,
        uploadedBy: `แม่บ้าน · ${latestPhotoCollection.maid.displayName}`,
        caption: `รอบเก็บเงิน ${baht(latestPhotoCollection.depositedAmount)}`,
      }
    : null;

  const sidebarBranches = [...allBranches].sort(
    (a, b) => b.driftAmount - a.driftAmount,
  );

  return (
    <div className="chairops-scope">
      <MasterDetailShell
        sidebar={
          <BranchSidebarSlim
            branches={sidebarBranches}
            activeBranchId={branchId}
          />
        }
        meta={
          <div className="space-y-4">
            <PhotoProofPanel photo={photo} title="หลักฐานภาพล่าสุด" />

            {/* Notification controls — UI only · Wave 2 wires delivery */}
            <section className="space-y-2">
              <p className="px-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                การแจ้งเตือนของสาขานี้
              </p>
              <LineNotifyToggle
                eventLabel="เงินขาดสาขา · BR2"
                channelLabel="LINE · ห้องบัญชี"
                enabled
                sendCount={0}
                disabled
                disabledReason="Wave 2 · LINE Messaging API"
              />
              <LineNotifyToggle
                eventLabel="แม่บ้านไม่ส่งรอบ"
                channelLabel="LINE · ผู้จัดการสาขา"
                enabled={false}
                disabled
                disabledReason="Wave 2 · LINE Messaging API"
              />
            </section>
          </div>
        }
      >
        {/* breadcrumb + recompute */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Link
            href="/chairops/reconcile"
            className="text-xs font-medium text-zinc-600 hover:text-zinc-900"
          >
            ← กลับตารางสาขา
          </Link>
          <RecomputeButton branchId={branchId} />
        </div>

        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-zinc-500">
              สาขา · {branch.slug}
            </p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-zinc-900">
              {branch.name}
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              {branch.mallGroup ?? "—"}
              {branch.floor ? ` · ${branch.floor}` : ""}
              {branch.region ? ` · ${branch.region}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {openAlerts.length > 0 && (
              <StatusPill tone="danger" dot>
                {openAlerts.length} alert เปิด
              </StatusPill>
            )}
            <StatusPill tone={driftToneFromStatus(drift.status)} dot>
              {drift.status === "ok" && "OK"}
              {drift.status === "watch" && "Watch <24 ชม."}
              {drift.status === "shortage" && "Shortage"}
              {drift.status === "surplus" && "ส่วนเกิน"}
              {drift.status === "missed" && "แม่บ้านไม่ส่ง"}
            </StatusPill>
          </div>
        </header>

        {/* error/success ribbons (preserve old behavior) */}
        {sp.error && (
          <div className="mb-4 rounded-md border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-800">
            {decodeURIComponent(sp.error)}
          </div>
        )}
        {sp.disputed && (
          <div className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
            บันทึก dispute เรียบร้อย · log ไปที่ผู้ที่เกี่ยวข้องแล้ว
          </div>
        )}

        {/* drift KPIs */}
        <section className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <ChairopsKpiTile
            label="POS รวม"
            value={baht(drift.posTotal)}
            tone="neutral"
            icon={<Receipt className="size-4" aria-hidden="true" />}
          />
          <ChairopsKpiTile
            label="ฝากรวม"
            value={baht(drift.depositTotal)}
            tone="neutral"
            icon={<Wallet className="size-4" aria-hidden="true" />}
          />
          <ChairopsKpiTile
            label="DRIFT"
            value={baht(drift.driftAmount, true)}
            tone={
              drift.driftAmount > 0
                ? "danger"
                : drift.driftAmount < -100
                  ? "warning"
                  : "success"
            }
            icon={<AlertTriangle className="size-4" aria-hidden="true" />}
          />
          <ChairopsKpiTile
            label="อายุ DRIFT"
            value={drift.driftAmount > 0 ? `${drift.driftHours} ชม.` : "—"}
            tone={drift.driftHours >= 24 ? "danger" : "neutral"}
            icon={<CalendarClock className="size-4" aria-hidden="true" />}
          />
        </section>

        {/* BR2 banner */}
        {drift.driftAmount > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
            <AlertTriangle
              className="size-4 text-rose-700"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-rose-800">
                BR2 zero-tolerance · สาขานี้ยังขาดอยู่
              </p>
              <ShortageDriftCell
                amount={-drift.driftAmount}
                ageHours={drift.driftHours}
                cumulativeDays={Math.floor(drift.driftHours / 24)}
                escalation={
                  drift.driftHours >= 48
                    ? "ceo"
                    : drift.driftHours >= 24
                      ? "mgr"
                      : "none"
                }
              />
            </div>
          </div>
        )}

        {/* Timeline (full-width main pane) */}
        <section className="mb-6">
          <div className="mb-2 flex items-end justify-between">
            <h2 className="text-base font-semibold text-zinc-900">
              Timeline · POS + แม่บ้านเก็บเงิน
            </h2>
            <p className="text-xs text-zinc-500">
              60 รายการล่าสุด · ใหม่ก่อน
            </p>
          </div>
          <div className="overflow-x-auto rounded-2xl border-2 border-zinc-200 bg-white shadow-soft">
            <table className="w-full text-sm">
              <thead
                className={stickyTheadClass(
                  "bg-zinc-50 text-xs font-semibold text-zinc-600",
                )}
              >
                <tr className="text-left">
                  <th className="px-3 py-2.5 font-semibold">เวลา</th>
                  <th className="px-3 py-2.5 font-semibold">ประเภท</th>
                  <th className="px-3 py-2.5 text-right font-semibold">
                    จำนวน
                  </th>
                  <th className="px-3 py-2.5 font-semibold">รายละเอียด</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {timeline.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-12 text-center text-sm text-zinc-500"
                    >
                      ยังไม่มีข้อมูลให้ตรวจ
                    </td>
                  </tr>
                )}
                {timeline.map((e, idx) => {
                  if (e.kind === "pos") {
                    return (
                      <tr
                        key={`pos-${e.data.id}-${idx}`}
                        className="hover:bg-zinc-50/70"
                      >
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-zinc-500">
                          {thaiDate(e.data.bizDate)}
                        </td>
                        <td className="px-3 py-2">
                          <StatusPill tone="info" dot size="xs">
                            POS
                          </StatusPill>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-zinc-900">
                          {baht(e.data.totalRevenue)}
                        </td>
                        <td className="px-3 py-2 text-xs text-zinc-600">
                          {e.data.chairCode ? (
                            <span className="font-mono text-zinc-800">
                              {e.data.chairCode}
                            </span>
                          ) : (
                            "ยอดรวมสาขา"
                          )}{" "}
                          <span className="text-zinc-400">·</span> ออน{" "}
                          {baht(e.data.online)} <span className="text-zinc-400">·</span>{" "}
                          แบงค์ {baht(e.data.cash)}{" "}
                          <span className="text-zinc-400">·</span> เหรียญ{" "}
                          {baht(e.data.coin)}
                        </td>
                        <td className="px-3 py-2" />
                      </tr>
                    );
                  }
                  const c = e.data;
                  const slipDiff = c.countedAmount - c.depositedAmount;
                  return (
                    <tr
                      key={`col-${c.id}`}
                      className="bg-emerald-50/40 hover:bg-emerald-50/70"
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-zinc-600">
                        <div>{thaiDateTime(c.collectedAt)}</div>
                        <div className="text-[11px] text-zinc-500">
                          {thaiRelative(c.collectedAt)}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <StatusPill tone="success" dot size="xs">
                          เก็บเงิน
                        </StatusPill>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-800">
                        {baht(c.depositedAmount)}
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-600">
                        แม่บ้าน{" "}
                        <span className="font-semibold text-zinc-800">
                          {c.maid.displayName}
                        </span>{" "}
                        <span className="text-zinc-400">·</span> นับได้{" "}
                        {baht(c.countedAmount)}
                        {slipDiff !== 0 && (
                          <span className="ml-1 font-semibold text-amber-700">
                            (ต่างจากที่ฝาก {baht(slipDiff, true)})
                          </span>
                        )}
                        {c.notes && (
                          <div className="mt-0.5 italic text-zinc-500">
                            📝 {c.notes.slice(0, 120)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <form
                          action={disputeCollection}
                          className="flex items-center gap-1"
                        >
                          <input
                            type="hidden"
                            name="collectionId"
                            value={c.id}
                          />
                          <input
                            name="reason"
                            placeholder="dispute reason..."
                            maxLength={500}
                            className="h-8 w-40 rounded border border-zinc-300 bg-white px-2 text-xs placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none"
                            aria-label="เหตุผล dispute"
                          />
                          <button
                            type="submit"
                            className="rounded border border-zinc-300 px-2 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                          >
                            dispute
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Write-off form + alerts + write-offs + audit log */}
        <section className="grid gap-4 lg:grid-cols-2">
          {/* Write-off request form */}
          <article className="rounded-2xl border-2 border-zinc-200 bg-white p-4 shadow-soft">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-zinc-900">
                ขอตัดเงินขาด · write-off
              </h2>
              <StatusPill tone="violet" size="xs">
                BR15 maker-checker
              </StatusPill>
            </div>
            <p className="mb-3 text-xs text-zinc-600">
              ใช้เมื่อ drift หาคืนไม่ได้ · &lt;500฿ ใช้ MANAGER อนุมัติ · ≥500฿
              ต้องให้ CEO
            </p>
            <form
              action={requestWriteOff}
              className="space-y-2.5"
              aria-label="แบบฟอร์มขอตัดเงินขาด"
            >
              <input type="hidden" name="branchId" value={branchId} />
              <div className="space-y-1">
                <label
                  htmlFor="wo-amount"
                  className="block text-xs font-semibold text-zinc-700"
                >
                  จำนวนเงิน (บาท)
                </label>
                <input
                  id="wo-amount"
                  type="number"
                  name="amount"
                  min={1}
                  max={1_000_000}
                  required
                  defaultValue={
                    drift.driftAmount > 0 ? drift.driftAmount : undefined
                  }
                  className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm tabular-nums focus:border-zinc-500 focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="wo-reason"
                  className="block text-xs font-semibold text-zinc-700"
                >
                  เหตุผล
                </label>
                <textarea
                  id="wo-reason"
                  name="reason"
                  required
                  rows={3}
                  minLength={5}
                  maxLength={500}
                  placeholder="เช่น แม่บ้านลาออก · ยอดหายไป · POS รายงานผิด"
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="h-10 w-full rounded-md bg-zinc-900 text-sm font-semibold text-white hover:bg-zinc-800"
              >
                ส่งคำขอ
              </button>
            </form>
          </article>

          {/* Open alerts */}
          <article className="rounded-2xl border-2 border-zinc-200 bg-white p-4 shadow-soft">
            <h2 className="mb-3 text-base font-semibold text-zinc-900">
              Alerts เปิดอยู่
            </h2>
            {openAlerts.length === 0 ? (
              <p className="text-sm text-zinc-500">ไม่มี · ทุกอย่างเงียบ</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {openAlerts.map((a) => (
                  <li
                    key={a.id}
                    className="rounded-lg border border-zinc-200 p-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <StatusPill
                        tone={a.level === "CRITICAL" ? "danger" : "warning"}
                        size="xs"
                        dot
                      >
                        {a.kind}
                      </StatusPill>
                      <span className="text-zinc-500">
                        {thaiRelative(a.createdAt)}
                      </span>
                    </div>
                    <div className="mt-1 font-semibold text-zinc-900">
                      {a.title}
                    </div>
                    <div className="text-zinc-600">{a.message}</div>
                  </li>
                ))}
              </ul>
            )}
          </article>

          {/* Write-offs list */}
          <article className="rounded-2xl border-2 border-zinc-200 bg-white p-4 shadow-soft">
            <h2 className="mb-3 text-base font-semibold text-zinc-900">
              Write-offs ล่าสุด
            </h2>
            {writeOffs.length === 0 ? (
              <p className="text-sm text-zinc-500">ยังไม่เคยขอ</p>
            ) : (
              <ul className="space-y-3 text-xs">
                {writeOffs.map((w) => (
                  <li
                    key={w.id}
                    className="rounded-lg border border-zinc-200 p-2.5"
                  >
                    <div className="mb-1.5 flex items-center justify-between">
                      <StatusPill
                        tone={
                          w.status === "APPROVED"
                            ? "success"
                            : w.status === "REJECTED"
                              ? "danger"
                              : "warning"
                        }
                        size="xs"
                        dot
                      >
                        {w.status}
                      </StatusPill>
                      <span className="tabular-nums font-semibold text-zinc-900">
                        {baht(w.amount)}
                      </span>
                    </div>
                    <MakerCheckerBadge
                      maker={{
                        name: w.maker.displayName,
                        at: thaiRelative(w.makerAt),
                      }}
                      approver={
                        w.approver
                          ? {
                              name: w.approver.displayName,
                              at: w.approverAt
                                ? thaiRelative(w.approverAt)
                                : undefined,
                            }
                          : null
                      }
                      compact
                      className="mb-1.5"
                    />
                    <div className="text-zinc-700">{w.reason}</div>
                    {w.notes && (
                      <div className="mt-0.5 italic text-zinc-500">
                        “{w.notes}”
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </article>

          {/* Audit log */}
          <article className="rounded-2xl border-2 border-zinc-200 bg-white p-4 shadow-soft">
            <h2 className="mb-3 text-base font-semibold text-zinc-900">
              Audit ล่าสุด
            </h2>
            {auditLogs.length === 0 ? (
              <p className="text-sm text-zinc-500">ไม่มี</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {auditLogs.slice(0, 12).map((l) => (
                  <li
                    key={l.id}
                    className="border-b border-zinc-100 pb-1.5 last:border-0"
                  >
                    <span className="font-mono text-zinc-500">
                      {thaiRelative(l.createdAt)}
                    </span>{" "}
                    <span className="font-semibold text-zinc-900">
                      {l.action}
                    </span>{" "}
                    <span className="text-zinc-600">
                      โดย {l.user?.displayName ?? "?"} (
                      {l.user?.role ?? "?"})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </section>
      </MasterDetailShell>
    </div>
  );
}

// ---------- sub-components ----------

function BranchSidebarSlim({
  branches,
  activeBranchId,
}: {
  branches: Awaited<ReturnType<typeof getDashboardRows>>;
  activeBranchId: string;
}) {
  return (
    <nav className="flex h-full flex-col" aria-label="รายชื่อสาขา">
      <div className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50 px-3 py-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
          Reconcile
        </p>
        <h2 className="mt-0.5 text-sm font-semibold text-zinc-900">
          {branches.length.toLocaleString("th-TH")} สาขา
        </h2>
      </div>
      <ul className="flex-1 divide-y divide-zinc-200/60">
        <li>
          <Link
            href="/chairops/reconcile"
            className="block px-3 py-2.5 text-sm text-zinc-700 hover:bg-white"
          >
            <div className="flex items-center justify-between gap-2">
              <span>ภาพรวมทุกสาขา</span>
              <span className="text-xs text-zinc-500">
                {branches.length}
              </span>
            </div>
          </Link>
        </li>
        {branches.map((b) => {
          const isActive = b.branchId === activeBranchId;
          return (
            <li key={b.branchId}>
              <Link
                href={`/chairops/reconcile/${b.branchId}`}
                className={
                  "block px-3 py-2.5 text-sm hover:bg-white " +
                  (isActive
                    ? "bg-white font-semibold text-zinc-900"
                    : "text-zinc-700")
                }
                aria-current={isActive ? "page" : undefined}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{b.branchName}</span>
                  {b.driftAmount > 0 ? (
                    <StatusPill
                      tone={b.driftHours >= 24 ? "danger" : "warning"}
                      size="xs"
                      dot
                    >
                      {baht(b.driftAmount)}
                    </StatusPill>
                  ) : (
                    <StatusPill tone="success" size="xs" dot>
                      OK
                    </StatusPill>
                  )}
                </div>
                {b.mallGroup && (
                  <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                    {b.mallGroup}
                    {b.floor ? ` · ${b.floor}` : ""}
                  </p>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function driftToneFromStatus(
  status: "ok" | "watch" | "shortage" | "surplus" | "missed",
): "success" | "warning" | "danger" | "neutral" {
  switch (status) {
    case "ok":
      return "success";
    case "watch":
      return "warning";
    case "shortage":
      return "danger";
    case "missed":
      return "danger";
    case "surplus":
      return "warning";
  }
}
