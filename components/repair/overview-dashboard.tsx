"use client";
// Pooil Repair · Command Center Overview
// Layout: KPI strip → Action queue + Workload → Pipeline funnel → Hotspots + Cost + Activity → Volume + Categories

import Link from "next/link";
import { useState } from "react";
import {
  Inbox,
  AlarmClock,
  CheckCircle2,
  Flame,
  PackageSearch,
  BadgeDollarSign,
  TrendingUp,
  ChevronRight,
  Users,
  Building2,
  Layers,
  Receipt,
  AlertTriangle,
  Wrench,
  PlusCircle,
} from "lucide-react";
import { STATUS_LABELS, formatBaht } from "@/lib/repair/types";
import type { RepairTicketStatus, RepairUrgency } from "@/lib/generated/prisma/enums";
import { slaStatusFor, slaBadgeColor, slaBadgeLabel } from "@/lib/repair/sla";

type TinyTicket = {
  id: string;
  ticketCode: string;
  title: string;
  status: RepairTicketStatus;
  urgency: RepairUrgency;
  createdAt: Date;
  resolveDueAt: Date | null;
  resolvedAt: Date | null;
  branch: { id: string; code: string; name: string } | null;
  category: { id: string; label: string; emoji: string | null } | null;
  assignedTech: { id: string; name: string } | null;
};

type Workload = {
  tech: { id: string; name: string; kind: "INTERNAL" | "VENDOR"; specialties: string[] };
  active: number;
  urgent: number;
};

type Hotspot = {
  branch: { id: string; code: string; name: string; province: string | null };
  openCount: number;
  costCents: number;
};

type CategoryRow = {
  category: { id: string; label: string; emoji: string | null; slug: string };
  count: number;
};

type ActivityEvent = {
  id: string;
  kind: string;
  createdAt: Date;
  actor: { id: string; name: string } | null;
  ticket: {
    id: string;
    ticketCode: string;
    title: string;
    urgency: RepairUrgency;
    status: RepairTicketStatus;
    branch: { id: string; name: string; code: string } | null;
  };
};

interface Props {
  statusCounts: Record<RepairTicketStatus, number>;
  urgencyCounts: Record<RepairUrgency, number>;
  openCost: number;
  newSinceYesterday: number;
  hotspots: Hotspot[];
  workload: Workload[];
  categories: CategoryRow[];
  activity: ActivityEvent[];
  buckets: {
    needAssign: TinyTicket[];
    needAck: TinyTicket[];
    partsWait: TinyTicket[];
    slaRisk: TinyTicket[];
  };
  costTrend: { weekIndex: number; weekStart: Date; cents: number }[];
  volume: { label: string; created: number; resolved: number }[];
}

type Bucket = "assign" | "ack" | "parts" | "sla";

export function OverviewDashboard(props: Props) {
  const [bucket, setBucket] = useState<Bucket>("assign");

  const open =
    props.statusCounts.NEW +
    props.statusCounts.ACK +
    props.statusCounts.IN_PROGRESS +
    props.statusCounts.WAITING_PARTS;
  const urgent = props.urgencyCounts.URGENT;
  const partsCount = props.statusCounts.WAITING_PARTS;
  const slaCount = props.buckets.slaRisk.length;
  const ackCount = props.buckets.needAck.length;

  const current = (() => {
    if (bucket === "assign") return props.buckets.needAssign;
    if (bucket === "ack") return props.buckets.needAck;
    if (bucket === "parts") return props.buckets.partsWait;
    return props.buckets.slaRisk;
  })();

  const workloadMax = Math.max(6, ...props.workload.map((w) => w.active));
  const hotspotMax = Math.max(1, ...props.hotspots.map((h) => h.openCount));
  const catMax = Math.max(1, ...props.categories.map((c) => c.count));
  const trendMax = Math.max(1, ...props.costTrend.map((t) => t.cents));
  const volMax = Math.max(1, ...props.volume.flatMap((v) => [v.created, v.resolved]));

  // pipeline funnel data (display order)
  const pipeline: { key: RepairTicketStatus; label: string; count: number; dot: string; meta: string }[] = [
    {
      key: "NEW",
      label: STATUS_LABELS.NEW,
      count: props.statusCounts.NEW,
      dot: "bg-blue-500",
      meta:
        props.buckets.needAssign.length > 0
          ? `ยังไม่มอบหมาย ${props.buckets.needAssign.length} ใบ`
          : "ทุกใบมอบช่างแล้ว",
    },
    {
      key: "ACK",
      label: STATUS_LABELS.ACK,
      count: props.statusCounts.ACK,
      dot: "bg-violet-500",
      meta: "ช่างรับงานแล้ว",
    },
    {
      key: "IN_PROGRESS",
      label: STATUS_LABELS.IN_PROGRESS,
      count: props.statusCounts.IN_PROGRESS,
      dot: "bg-amber-500",
      meta: "ระหว่างซ่อม",
    },
    {
      key: "WAITING_PARTS",
      label: STATUS_LABELS.WAITING_PARTS,
      count: props.statusCounts.WAITING_PARTS,
      dot: "bg-cyan-500",
      meta: partsCount > 0 ? `รออะไหล่ ${partsCount} รายการ` : "ไม่ติด",
    },
    {
      key: "RESOLVED",
      label: STATUS_LABELS.RESOLVED,
      count: props.statusCounts.RESOLVED,
      dot: "bg-emerald-500",
      meta: "รอปิดงาน",
    },
    {
      key: "CLOSED",
      label: STATUS_LABELS.CLOSED,
      count: props.statusCounts.CLOSED,
      dot: "bg-zinc-400",
      meta: "ปิดถาวร",
    },
  ];

  return (
    <div className="p-3 sm:p-5 lg:p-6 max-w-[1600px] mx-auto space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-zinc-200 border border-zinc-200 rounded-xl overflow-hidden">
        <KpiCell
          icon={<Inbox className="size-3" />}
          label="เปิดอยู่"
          value={open}
          delta={`+${props.newSinceYesterday} ใหม่วันนี้`}
        />
        <KpiCell
          icon={<AlarmClock className="size-3" />}
          label="SLA เสี่ยง"
          value={slaCount}
          delta={slaCount > 0 ? "ต้องดูตอนนี้" : "ปลอดภัย"}
          tone={slaCount > 0 ? "danger" : "neutral"}
        />
        <KpiCell
          icon={<CheckCircle2 className="size-3" />}
          label="รออนุมัติ"
          value={ackCount}
          delta="รอตัดสินใจ"
          tone="warning"
        />
        <KpiCell
          icon={<Flame className="size-3" />}
          label="ด่วนมาก"
          value={urgent}
          delta={open > 0 ? `${Math.round((urgent / Math.max(1, open)) * 100)}% ของที่เปิด` : "—"}
        />
        <KpiCell
          icon={<PackageSearch className="size-3" />}
          label="รออะไหล่"
          value={partsCount}
          delta={partsCount > 0 ? "ตามอะไหล่ที่ค้าง" : "ไม่ติด"}
        />
        <KpiCell
          icon={<BadgeDollarSign className="size-3" />}
          label="ค่าใช้จ่ายเดือนนี้"
          value={formatBaht(props.openCost)}
          delta="ของยังไม่ปิดบัญชี"
          isMoney
        />
      </div>

      {/* Row 1: Action queue + Workload */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-3">
        <Panel
          title="คิวงานต้องจัดการ"
          subtitle="แตะรายการเพื่อเปิดดูทันที"
          headRight={
            <Link
              href="/repairs/triage"
              className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-blue-600 hover:text-blue-800"
            >
              ดูใน Triage <ChevronRight className="size-3" />
            </Link>
          }
        >
          <div className="flex border-b border-zinc-100 px-1.5">
            <QueueTab
              active={bucket === "assign"}
              count={props.buckets.needAssign.length}
              onClick={() => setBucket("assign")}
            >
              ต้องมอบช่าง
            </QueueTab>
            <QueueTab
              active={bucket === "ack"}
              count={ackCount}
              tone="warn"
              onClick={() => setBucket("ack")}
            >
              รอรับงาน
            </QueueTab>
            <QueueTab
              active={bucket === "parts"}
              count={props.buckets.partsWait.length}
              onClick={() => setBucket("parts")}
            >
              รออะไหล่
            </QueueTab>
            <QueueTab
              active={bucket === "sla"}
              count={slaCount}
              tone="danger"
              onClick={() => setBucket("sla")}
            >
              SLA เสี่ยง
            </QueueTab>
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {current.length === 0 && (
              <div className="py-10 px-4 text-center">
                <CheckCircle2 className="size-6 mx-auto text-emerald-500" />
                <p className="mt-2 text-xs text-zinc-500">ไม่มีงานในกลุ่มนี้ — เคลียร์แล้ว</p>
              </div>
            )}
            {current.slice(0, 12).map((t) => {
              const sla = slaStatusFor(t);
              return (
                <Link
                  key={t.id}
                  href={`/repairs/triage?selected=${t.id}`}
                  className="grid grid-cols-[auto_1fr_auto_auto] gap-2.5 items-center px-3 py-2.5 border-b border-zinc-100 hover:bg-zinc-50 group"
                >
                  <span
                    className={`size-1.5 rounded-full shrink-0 ${
                      t.urgency === "URGENT"
                        ? "bg-red-500"
                        : t.urgency === "NORMAL"
                          ? "bg-blue-500"
                          : "bg-zinc-400"
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-zinc-900 truncate">
                      {t.category?.emoji && <span className="mr-1">{t.category.emoji}</span>}
                      {t.title}
                    </p>
                    <p className="text-[10.5px] text-zinc-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono font-semibold text-zinc-700">{t.ticketCode}</span>
                      {t.branch && (
                        <>
                          <span className="text-zinc-300">·</span>
                          <span className="font-mono text-zinc-700 font-semibold">
                            {t.branch.code}
                          </span>
                          <span className="truncate">{t.branch.name}</span>
                        </>
                      )}
                    </p>
                  </div>
                  {sla !== "done" && sla !== "ok" && (
                    <span
                      className={`text-[10px] font-bold px-1.5 h-5 inline-flex items-center rounded border ${slaBadgeColor(sla)}`}
                    >
                      {slaBadgeLabel(sla, t.resolveDueAt)}
                    </span>
                  )}
                  <ChevronRight className="size-3.5 text-zinc-400 group-hover:text-zinc-700" />
                </Link>
              );
            })}
          </div>
        </Panel>

        <Panel
          title="Workload ช่าง"
          subtitle="งานที่ยังเปิดอยู่"
          headRight={
            <Link
              href="/repairs/technicians"
              className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-blue-600 hover:text-blue-800"
            >
              ทั้งหมด <ChevronRight className="size-3" />
            </Link>
          }
        >
          <div className="divide-y divide-zinc-100">
            {props.workload.length === 0 && (
              <div className="py-10 px-4 text-center">
                <Users className="size-6 mx-auto text-zinc-300" />
                <p className="mt-2 text-xs text-zinc-500">ยังไม่มีช่างที่ได้รับมอบหมาย</p>
              </div>
            )}
            {props.workload.slice(0, 7).map((w) => {
              const pct = Math.min(100, (w.active / workloadMax) * 100);
              const tone = w.active >= 7 ? "bg-red-500" : w.active >= 4 ? "bg-amber-500" : "bg-emerald-500";
              return (
                <div key={w.tech.id} className="grid grid-cols-[28px_1fr_auto] items-center gap-2.5 px-3 py-2.5">
                  <span
                    className="size-7 rounded-full grid place-items-center text-white text-[11px] font-bold"
                    style={{ background: techColor(w.tech.id) }}
                  >
                    {w.tech.name.charAt(0)}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-semibold text-zinc-900 truncate">
                      {w.tech.name}
                      {w.tech.kind === "VENDOR" && (
                        <span className="ml-1.5 inline-block px-1 py-px text-[9px] font-bold bg-zinc-100 text-zinc-600 rounded">
                          VENDOR
                        </span>
                      )}
                    </div>
                    <div className="mt-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                      <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
                    </div>
                    {w.tech.specialties.length > 0 && (
                      <div className="text-[10.5px] text-zinc-500 mt-1 truncate">
                        {w.tech.specialties.slice(0, 3).join(" · ")}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-[14px] tabular-nums font-bold text-zinc-900">{w.active}</div>
                    {w.urgent > 0 && (
                      <div className="text-[10px] text-red-600 font-semibold">{w.urgent} ด่วน</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      {/* Pipeline funnel */}
      <Panel
        title="Pipeline · งานเข้า → เสร็จ → ปิด"
        headRight={
          <Link
            href="/repairs/kanban"
            className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-blue-600 hover:text-blue-800"
          >
            เปิด Kanban <ChevronRight className="size-3" />
          </Link>
        }
      >
        <div className="flex items-stretch gap-1 p-3 overflow-x-auto">
          {pipeline.map((p, i) => (
            <div key={p.key} className="flex items-stretch gap-1 shrink-0">
              <Link
                href={`/repairs/triage?status=${p.key}`}
                className="flex-1 min-w-[140px] bg-zinc-50 border border-zinc-100 rounded-lg p-3 hover:bg-white hover:border-zinc-200 transition-colors"
              >
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-600">
                  <span className={`size-1.5 rounded-full ${p.dot}`} />
                  {p.label}
                </div>
                <div className="text-[20px] tabular-nums font-bold text-zinc-900 mt-1 leading-none">
                  {p.count}
                </div>
                <div className="text-[10.5px] text-zinc-500 mt-1.5">{p.meta}</div>
              </Link>
              {i < pipeline.length - 1 && (
                <div className="self-center">
                  <ChevronRight className="size-3 text-zinc-300" />
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>

      {/* Row 3: Hotspots + Cost trend + Activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <Panel
          title="สาขามีปัญหามากที่สุด"
          subtitle="Top 6 · ใบเปิดอยู่"
          icon={<Building2 className="size-3.5 text-red-500" />}
        >
          <div className="divide-y divide-zinc-100">
            {props.hotspots.length === 0 && (
              <div className="py-10 px-4 text-center text-xs text-zinc-500">ไม่มีข้อมูล</div>
            )}
            {props.hotspots.map((h) => (
              <Link
                key={h.branch.id}
                href={`/repairs/triage?branch=${h.branch.id}`}
                className="block px-3 py-2.5 hover:bg-zinc-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-semibold text-zinc-900 truncate">
                      <span className="font-mono text-zinc-700 mr-1.5">{h.branch.code}</span>
                      {h.branch.name}
                    </div>
                    {h.branch.province && (
                      <div className="text-[10.5px] text-zinc-500 mt-0.5">{h.branch.province}</div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[14px] tabular-nums font-bold text-zinc-900">
                      {h.openCount}
                      <span className="text-[10px] font-medium text-zinc-500 ml-0.5">ใบ</span>
                    </div>
                    {h.costCents > 0 && (
                      <div className="text-[10px] tabular-nums text-zinc-500 mt-0.5">
                        {formatBaht(h.costCents)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-1.5 h-1 bg-zinc-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-500"
                    style={{ width: `${(h.openCount / hotspotMax) * 100}%` }}
                  />
                </div>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel
          title="ค่าใช้จ่าย 8 สัปดาห์"
          subtitle="ของใบที่ปิดในสัปดาห์นั้น"
          icon={<TrendingUp className="size-3.5 text-blue-500" />}
        >
          <div className="p-4">
            <div className="flex items-end gap-1 h-20">
              {props.costTrend.map((t) => {
                const h = (t.cents / trendMax) * 100;
                return (
                  <div
                    key={t.weekIndex}
                    className={`flex-1 rounded-t ${
                      t.weekIndex === props.costTrend.length - 1
                        ? "bg-blue-600"
                        : "bg-blue-200"
                    }`}
                    style={{ height: `${Math.max(2, h)}%` }}
                    title={formatBaht(t.cents)}
                  />
                );
              })}
            </div>
            <div className="mt-3 flex justify-between text-[10.5px] text-zinc-500">
              <span>8 สัปดาห์ก่อน</span>
              <span className="font-semibold text-zinc-900">
                สัปดาห์นี้: {formatBaht(props.costTrend[props.costTrend.length - 1]?.cents ?? 0)}
              </span>
            </div>
          </div>
          <div className="border-t border-zinc-100 px-4 py-3">
            <div className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">
              หมวดที่เปิดมากสุด
            </div>
            <div className="space-y-1.5">
              {props.categories.filter((c) => c.count > 0).slice(0, 4).map((c) => (
                <div key={c.category.id}>
                  <div className="flex justify-between text-[11.5px]">
                    <span className="text-zinc-700 truncate">
                      {c.category.emoji && <span className="mr-1">{c.category.emoji}</span>}
                      {c.category.label}
                    </span>
                    <span className="tabular-nums font-semibold text-zinc-900 shrink-0 ml-2">
                      {c.count}
                    </span>
                  </div>
                  <div className="mt-1 h-1 bg-zinc-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500"
                      style={{ width: `${(c.count / catMax) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel
          title="Activity"
          subtitle="กิจกรรมล่าสุด"
          icon={<Layers className="size-3.5 text-violet-500" />}
        >
          <div className="divide-y divide-zinc-100">
            {props.activity.length === 0 && (
              <div className="py-10 px-4 text-center text-xs text-zinc-500">ยังไม่มีกิจกรรม</div>
            )}
            {props.activity.map((a) => (
              <Link
                key={a.id}
                href={`/repairs/triage?selected=${a.ticket.id}`}
                className="grid grid-cols-[24px_1fr] gap-2.5 px-3 py-2.5 hover:bg-zinc-50"
              >
                <span
                  className={`size-6 rounded-full grid place-items-center ${
                    a.kind === "CREATED"
                      ? "bg-blue-50 text-blue-600"
                      : a.kind === "ASSIGN"
                        ? "bg-violet-50 text-violet-600"
                        : a.kind === "STATUS_CHANGE"
                          ? "bg-amber-50 text-amber-600"
                          : a.kind === "PART_ADDED" || a.kind === "PART_UPDATED"
                            ? "bg-cyan-50 text-cyan-600"
                            : a.kind === "CLOSE"
                              ? "bg-emerald-50 text-emerald-600"
                              : "bg-zinc-100 text-zinc-600"
                  }`}
                >
                  <ActivityIcon kind={a.kind} />
                </span>
                <div className="min-w-0">
                  <p className="text-[11.5px] text-zinc-700 leading-snug">
                    <b className="font-semibold text-zinc-900">{a.actor?.name ?? "ระบบ"}</b>{" "}
                    {humanEventLabel(a.kind)}
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-0.5 truncate">
                    <span className="font-mono font-semibold text-zinc-700">
                      {a.ticket.ticketCode}
                    </span>{" "}
                    · {a.ticket.title}
                  </p>
                  <p className="text-[10px] text-zinc-400 mt-0.5 tabular-nums">
                    {timeAgo(a.createdAt)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </Panel>
      </div>

      {/* Row 4: Volume by day */}
      <Panel
        title="เปิดงาน vs ปิดงาน · สัปดาห์นี้"
        headRight={
          <div className="text-[11px] text-zinc-500 flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <span className="size-2 bg-blue-400 rounded-sm" /> เปิด
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="size-2 bg-emerald-400 rounded-sm" /> ปิด
            </span>
          </div>
        }
      >
        <div className="px-4 py-5">
          <div className="flex items-end gap-3 h-24">
            {props.volume.map((v) => (
              <div key={v.label} className="flex-1 flex flex-col items-center relative">
                <div className="flex items-end gap-0.5 h-full">
                  <div
                    className="w-2 bg-blue-400 rounded-t"
                    style={{ height: `${(v.created / volMax) * 100}%`, minHeight: 2 }}
                    title={`เปิด ${v.created}`}
                  />
                  <div
                    className="w-2 bg-emerald-400 rounded-t"
                    style={{ height: `${(v.resolved / volMax) * 100}%`, minHeight: 2 }}
                    title={`ปิด ${v.resolved}`}
                  />
                </div>
                <span className="absolute -bottom-5 text-[10.5px] text-zinc-500 tabular-nums">
                  {v.label}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-9 grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-zinc-100">
            <SummaryStat
              label="เปิดเฉลี่ย/วัน"
              value={(props.volume.reduce((s, v) => s + v.created, 0) / 7).toFixed(1)}
            />
            <SummaryStat
              label="ปิดเฉลี่ย/วัน"
              value={(props.volume.reduce((s, v) => s + v.resolved, 0) / 7).toFixed(1)}
            />
            <SummaryStat
              label="เปิดมากกว่าปิด"
              value={Math.max(
                0,
                props.volume.reduce((s, v) => s + (v.created - v.resolved), 0),
              ).toString()}
              tone={props.volume.reduce((s, v) => s + (v.created - v.resolved), 0) > 0 ? "danger" : "default"}
            />
            <SummaryStat
              label="ด่วนคงเหลือ"
              value={urgent.toString()}
              tone={urgent > 0 ? "danger" : "default"}
            />
          </div>
        </div>
      </Panel>
    </div>
  );
}

// ----- helpers -----

function Panel({
  title,
  subtitle,
  icon,
  headRight,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  headRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
      <div className="flex items-center px-3 py-2.5 border-b border-zinc-100 gap-2">
        {icon}
        <div className="min-w-0">
          <h3 className="text-[12.5px] font-bold text-zinc-900 leading-tight">{title}</h3>
          {subtitle && <p className="text-[10.5px] text-zinc-500 mt-0.5">{subtitle}</p>}
        </div>
        {headRight && <div className="ml-auto">{headRight}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function KpiCell({
  icon,
  label,
  value,
  delta,
  tone = "default",
  isMoney = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  delta?: string;
  tone?: "default" | "danger" | "warning" | "neutral";
  isMoney?: boolean;
}) {
  return (
    <div className="bg-white px-3 py-2.5 hover:bg-zinc-50 transition-colors">
      <div className="flex items-center gap-1.5 text-[10.5px] font-medium text-zinc-500">
        <span
          className={`size-4 grid place-items-center rounded ${
            tone === "danger"
              ? "bg-red-50 text-red-600"
              : tone === "warning"
                ? "bg-amber-50 text-amber-600"
                : tone === "neutral"
                  ? "bg-zinc-100 text-zinc-600"
                  : "bg-blue-50 text-blue-600"
          }`}
        >
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </div>
      <div
        className={`mt-1 ${isMoney ? "text-[16px]" : "text-[22px]"} tabular-nums font-bold leading-none ${
          tone === "danger" ? "text-red-700" : tone === "warning" ? "text-amber-700" : "text-zinc-900"
        }`}
      >
        {value}
      </div>
      {delta && (
        <div className="text-[10px] text-zinc-500 mt-1 tabular-nums truncate">{delta}</div>
      )}
    </div>
  );
}

function QueueTab({
  active,
  count,
  tone = "default",
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  tone?: "default" | "warn" | "danger";
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-2 text-[11.5px] font-semibold border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
        active ? "text-zinc-900 border-zinc-900" : "text-zinc-500 border-transparent hover:text-zinc-800"
      }`}
    >
      {children}
      <span
        className={`text-[10px] tabular-nums px-1.5 py-px rounded-full font-bold ${
          tone === "danger"
            ? "bg-red-50 text-red-600"
            : tone === "warn"
              ? "bg-amber-50 text-amber-700"
              : "bg-zinc-100 text-zinc-700"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function SummaryStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "danger";
}) {
  return (
    <div>
      <div className="text-[10.5px] text-zinc-500">{label}</div>
      <div
        className={`text-[18px] tabular-nums font-bold leading-tight ${
          tone === "danger" ? "text-red-600" : "text-zinc-900"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function ActivityIcon({ kind }: { kind: string }) {
  switch (kind) {
    case "CREATED":
      return <PlusCircle className="size-3" />;
    case "ASSIGN":
    case "UNASSIGN":
      return <Users className="size-3" />;
    case "STATUS_CHANGE":
      return <Wrench className="size-3" />;
    case "PART_ADDED":
    case "PART_UPDATED":
      return <PackageSearch className="size-3" />;
    case "CLOSE":
      return <CheckCircle2 className="size-3" />;
    case "REOPEN":
      return <AlertTriangle className="size-3" />;
    case "PHOTO_ADDED":
      return <Receipt className="size-3" />;
    default:
      return <Layers className="size-3" />;
  }
}

function humanEventLabel(kind: string): string {
  const map: Record<string, string> = {
    CREATED: "เปิดใบใหม่",
    STATUS_CHANGE: "เปลี่ยนสถานะ",
    ASSIGN: "มอบหมายช่าง",
    UNASSIGN: "ปลดช่าง",
    COMMENT: "คอมเมนต์",
    PART_ADDED: "เพิ่มอะไหล่",
    PART_UPDATED: "อัปเดตอะไหล่",
    PHOTO_ADDED: "แนบรูป",
    REOPEN: "เปิดใบใหม่อีกครั้ง",
    CLOSE: "ปิดใบ",
    ETA_SET: "กำหนดวันถึงงาน",
  };
  return map[kind] ?? kind;
}

function timeAgo(d: Date): string {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / (60 * 1000));
  if (m < 1) return "เมื่อกี้";
  if (m < 60) return `${m} นาทีก่อน`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ชม.ก่อน`;
  const dy = Math.floor(h / 24);
  return `${dy} วันก่อน`;
}

function techColor(id: string): string {
  // deterministic but lively hue from id
  const palette = [
    "#2563EB", "#7C3AED", "#DB2777", "#059669",
    "#EA580C", "#0891B2", "#CA8A04", "#475569",
  ];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
