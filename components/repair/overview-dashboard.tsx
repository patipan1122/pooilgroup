"use client";
// Pooil App · Command Center Overview · uses exact design CSS vocabulary
// (.kpi-row .kpi .panel .queue-row .workload-row .funnel .hot-row .activity)

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
  Clock,
  Activity as ActivityIcon2,
} from "lucide-react";
import { STATUS_LABELS, formatBaht } from "@/lib/repair/types";
import type { RepairTicketStatus, RepairUrgency } from "@/lib/generated/prisma/enums";
import { slaStatusFor, slaBadgeLabel } from "@/lib/repair/sla";

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

  const pipeline: { key: RepairTicketStatus; label: string; count: number; dot: string; meta: string }[] = [
    {
      key: "NEW", label: STATUS_LABELS.NEW, count: props.statusCounts.NEW,
      dot: "var(--st-new)",
      meta: props.buckets.needAssign.length > 0
        ? `ยังไม่มอบ ${props.buckets.needAssign.length} ใบ`
        : "ทุกใบมอบช่างแล้ว",
    },
    {
      key: "ACK", label: STATUS_LABELS.ACK, count: props.statusCounts.ACK,
      dot: "var(--st-assess)", meta: "ช่างรับงานแล้ว",
    },
    {
      key: "IN_PROGRESS", label: STATUS_LABELS.IN_PROGRESS, count: props.statusCounts.IN_PROGRESS,
      dot: "var(--st-approval)", meta: "ระหว่างซ่อม",
    },
    {
      key: "WAITING_PARTS", label: STATUS_LABELS.WAITING_PARTS, count: props.statusCounts.WAITING_PARTS,
      dot: "var(--st-parts)",
      meta: partsCount > 0 ? `รออะไหล่ ${partsCount} รายการ` : "ไม่ติด",
    },
    {
      key: "RESOLVED", label: STATUS_LABELS.RESOLVED, count: props.statusCounts.RESOLVED,
      dot: "var(--st-done)", meta: "รอปิดงาน",
    },
    {
      key: "CLOSED", label: STATUS_LABELS.CLOSED, count: props.statusCounts.CLOSED,
      dot: "var(--ink-400)", meta: "ปิดถาวร",
    },
  ];

  return (
    <div className="repair-content">
      {/* Attention banner only when urgent / SLA risk */}
      {(urgent > 0 || slaCount > 0) && (
        <div className="attention-bar">
          <div className="attention-pip">
            <div className="attention-mark">
              <AlertTriangle size={20} />
            </div>
            <div>
              <div className="attention-label">ต้องดูตอนนี้</div>
              <div className="attention-title">
                {urgent > 0 && (
                  <span style={{ marginRight: 12 }}>
                    <span className="num" style={{ color: "var(--bad)" }}>{urgent}</span> ใบด่วน
                  </span>
                )}
                {slaCount > 0 && (
                  <span>
                    <span className="num" style={{ color: "var(--bad)" }}>{slaCount}</span> ใบ SLA เสี่ยง
                  </span>
                )}
              </div>
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {urgent > 0 && (
              <Link href="/repairs/triage?urgency=URGENT" className="btn btn-primary btn-sm" style={{ background: "var(--bad)", borderColor: "#B91C1C" }}>
                ดูใบด่วน
              </Link>
            )}
            {slaCount > 0 && (
              <button
                type="button"
                onClick={() => setBucket("sla")}
                className="btn btn-sm"
                style={{ background: "#fff", borderColor: "#FECACA", color: "var(--bad)" }}
              >
                ดู SLA เสี่ยง →
              </button>
            )}
          </div>
        </div>
      )}

      {/* KPI strip */}
      <div className="kpi-row">
        <Link href="/repairs/triage" className="kpi">
          <div className="kpi-label">
            <span className="kpi-label-icon"><Inbox /></span>
            เปิดอยู่
          </div>
          <div className="kpi-value num">{open}</div>
          <div className="kpi-delta">+{props.newSinceYesterday} ใหม่วันนี้</div>
        </Link>
        <button
          type="button"
          onClick={() => setBucket("sla")}
          className={"kpi " + (slaCount > 0 ? "danger" : "")}
          style={{ border: 0, textAlign: "left" }}
        >
          <div className="kpi-label">
            <span className="kpi-label-icon"><AlarmClock /></span>
            SLA เสี่ยง
          </div>
          <div className="kpi-value num">{slaCount}</div>
          <div className="kpi-delta">{slaCount > 0 ? "ต้องดูตอนนี้" : "ปลอดภัย"}</div>
        </button>
        <button
          type="button"
          onClick={() => setBucket("ack")}
          className="kpi warn"
          style={{ border: 0, textAlign: "left" }}
        >
          <div className="kpi-label">
            <span className="kpi-label-icon"><CheckCircle2 /></span>
            รออนุมัติ
          </div>
          <div className="kpi-value num">{ackCount}</div>
          <div className="kpi-delta">รอตัดสินใจ</div>
        </button>
        <Link href="/repairs/triage?urgency=URGENT" className="kpi">
          <div className="kpi-label">
            <span className="kpi-label-icon"><Flame /></span>
            ด่วนมาก
          </div>
          <div className="kpi-value num">{urgent}</div>
          <div className="kpi-delta">
            {open > 0 ? `${Math.round((urgent / Math.max(1, open)) * 100)}% ของที่เปิด` : "—"}
          </div>
        </Link>
        <Link href="/repairs/parts" className="kpi">
          <div className="kpi-label">
            <span className="kpi-label-icon"><PackageSearch /></span>
            รออะไหล่
          </div>
          <div className="kpi-value num">{partsCount}</div>
          <div className="kpi-delta">{partsCount > 0 ? "ตามอะไหล่ค้าง" : "ไม่ติด"}</div>
        </Link>
        <div className="kpi" style={{ cursor: "default" }}>
          <div className="kpi-label">
            <span className="kpi-label-icon"><BadgeDollarSign /></span>
            ค่าใช้จ่ายเดือนนี้
          </div>
          <div className="kpi-value num" style={{ fontSize: 16 }}>{formatBaht(props.openCost)}</div>
          <div className="kpi-delta up"><TrendingUp size={11} /> +12% MoM</div>
        </div>
      </div>

      {/* Row 1: Action queue + Workload */}
      <div className="dash-grid">
        <div className="panel">
          <div className="queue-tabs">
            <QueueTab active={bucket === "assign"} count={props.buckets.needAssign.length} onClick={() => setBucket("assign")}>
              ต้องมอบช่าง
            </QueueTab>
            <QueueTab active={bucket === "ack"} count={ackCount} tone="warn" onClick={() => setBucket("ack")}>
              รอรับงาน
            </QueueTab>
            <QueueTab active={bucket === "parts"} count={props.buckets.partsWait.length} onClick={() => setBucket("parts")}>
              รออะไหล่
            </QueueTab>
            <QueueTab active={bucket === "sla"} count={slaCount} tone="danger" onClick={() => setBucket("sla")}>
              SLA เสี่ยง
            </QueueTab>
          </div>
          <div className="queue-list" style={{ maxHeight: 360, overflowY: "auto" }}>
            {current.length === 0 && (
              <div style={{ padding: "32px 14px", textAlign: "center", color: "var(--ink-500)", fontSize: 12 }}>
                <CheckCircle2 size={20} style={{ color: "var(--good)", marginBottom: 6 }} />
                <div>ไม่มีงานในกลุ่มนี้ — เคลียร์แล้ว</div>
              </div>
            )}
            {current.slice(0, 12).map((t) => {
              const sla = slaStatusFor(t);
              return (
                <Link key={t.id} href={`/repairs/triage?selected=${t.id}`} className="queue-row">
                  <span
                    className="queue-bullet"
                    style={{
                      background: t.urgency === "URGENT" ? "var(--p-urgent)"
                                : t.urgency === "NORMAL" ? "var(--p-normal)"
                                : "var(--p-low)",
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div className="queue-title">
                      {t.category?.emoji && <span style={{ marginRight: 4 }}>{t.category.emoji}</span>}
                      {t.title}
                    </div>
                    <div className="queue-meta">
                      <span className="branch-id num">{t.ticketCode}</span>
                      {t.branch && (
                        <>
                          <span style={{ color: "var(--ink-300)" }}>·</span>
                          <span className="branch-id num">{t.branch.code}</span>
                          <span style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            maxWidth: 140,
                          }}>
                            {t.branch.name}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  {sla !== "done" && sla !== "ok" && (
                    <span className={"sla " + sla}>
                      <Clock />
                      {slaBadgeLabel(sla, t.resolveDueAt)}
                    </span>
                  )}
                  <ChevronRight size={14} style={{ color: "var(--ink-400)" }} />
                </Link>
              );
            })}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Workload ช่าง</span>
            <span style={{ flex: 1 }} />
            <span className="panel-sub">งานที่เปิดอยู่</span>
            <Link href="/repairs/technicians" className="btn btn-ghost btn-sm">
              ทั้งหมด <ChevronRight size={12} />
            </Link>
          </div>
          <div className="panel-body no-pad">
            {props.workload.length === 0 && (
              <div style={{ padding: "32px 14px", textAlign: "center", color: "var(--ink-500)", fontSize: 12 }}>
                <Users size={20} style={{ color: "var(--ink-300)", marginBottom: 6 }} />
                <div>ยังไม่มีช่างที่ได้รับมอบหมาย</div>
              </div>
            )}
            {props.workload.slice(0, 7).map((w) => {
              const pct = Math.min(100, (w.active / workloadMax) * 100);
              const cls = w.active >= 7 ? "is-high" : w.active >= 4 ? "is-med" : "is-low";
              return (
                <div className="workload-row" key={w.tech.id}>
                  <span className="tech-chip" style={{ background: techColor(w.tech.id) }}>
                    {w.tech.name.charAt(0)}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="workload-name">
                      {w.tech.name}
                      {w.tech.kind === "VENDOR" && (
                        <span className="tag" style={{ marginLeft: 6, background: "#F5F3FF", color: "#6D28D9" }}>
                          VENDOR
                        </span>
                      )}
                    </div>
                    <div className={"workload-bar " + cls}>
                      <div style={{ width: `${pct}%` }} />
                    </div>
                    {w.tech.specialties.length > 0 && (
                      <div className="workload-meta">{w.tech.specialties.slice(0, 3).join(" · ")}</div>
                    )}
                  </div>
                  <div className="workload-count num">
                    {w.active}
                    <span className="sub">
                      {w.urgent > 0 ? `${w.urgent} ด่วน` : "งาน"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Pipeline funnel */}
      <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel-head">
          <span className="panel-title">Pipeline · งานเข้า → เสร็จ → ปิด</span>
          <span style={{ flex: 1 }} />
          <Link href="/repairs/kanban" className="btn btn-ghost btn-sm">
            เปิด Kanban <ChevronRight size={12} />
          </Link>
        </div>
        <div className="funnel">
          {pipeline.map((p, i) => (
            <FunnelStep key={p.key} step={p} isLast={i === pipeline.length - 1} />
          ))}
        </div>
      </div>

      {/* Row 3: Hotspots + Cost trend + Activity */}
      <div className="dash-grid-3">
        <div className="panel">
          <div className="panel-head">
            <Building2 size={14} style={{ color: "var(--bad)" }} />
            <span className="panel-title">สาขามีปัญหามากสุด</span>
            <span style={{ flex: 1 }} />
            <span className="panel-sub">Top 6</span>
          </div>
          <div className="panel-body no-pad">
            {props.hotspots.length === 0 && (
              <div style={{ padding: "32px 14px", textAlign: "center", color: "var(--ink-500)", fontSize: 12 }}>
                ไม่มีข้อมูล
              </div>
            )}
            {props.hotspots.map((h) => (
              <Link key={h.branch.id} href={`/repairs/triage?branch=${h.branch.id}`} className="hot-row">
                <div style={{ minWidth: 0 }}>
                  <div className="hot-name">
                    <span className="num" style={{ fontWeight: 600, color: "var(--ink-700)", marginRight: 6 }}>
                      {h.branch.code}
                    </span>
                    {h.branch.name}
                  </div>
                  {h.branch.province && (
                    <div style={{ fontSize: 10.5, color: "var(--ink-500)", marginTop: 1 }}>
                      {h.branch.province}
                    </div>
                  )}
                  <div className="hot-bar"><div style={{ width: `${(h.openCount / hotspotMax) * 100}%` }} /></div>
                </div>
                <div className="hot-count num">
                  {h.openCount}
                  <span className="sub">{h.costCents > 0 ? formatBaht(h.costCents) : "—"}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <TrendingUp size={14} style={{ color: "var(--brand-500)" }} />
            <span className="panel-title">ค่าใช้จ่าย 8 สัปดาห์</span>
            <span style={{ flex: 1 }} />
            <span className="num" style={{ fontWeight: 600, fontSize: 14 }}>
              {formatBaht(props.costTrend[props.costTrend.length - 1]?.cents ?? 0)}
            </span>
          </div>
          <div className="panel-body">
            <div className="minibars">
              {props.costTrend.map((t, i) => (
                <div
                  key={t.weekIndex}
                  className={i === props.costTrend.length - 1 ? "last" : ""}
                  style={{ height: `${Math.max(2, (t.cents / trendMax) * 100)}%` }}
                  title={formatBaht(t.cents)}
                />
              ))}
            </div>
            <div style={{
              display: "flex", justifyContent: "space-between",
              marginTop: 6, fontSize: 10.5, color: "var(--ink-500)",
            }}>
              <span>8 สัปดาห์ก่อน</span>
              <span style={{ color: "var(--bad)" }}>
                <TrendingUp size={10} style={{ display: "inline" }} /> +12% สัปดาห์นี้
              </span>
            </div>
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--line-2)" }}>
              <div style={{ fontSize: 11, color: "var(--ink-500)", marginBottom: 6 }}>
                หมวดเปิดมากสุด
              </div>
              {props.categories.filter((c) => c.count > 0).slice(0, 4).map((c) => (
                <div key={c.category.id} style={{ marginTop: 6 }}>
                  <div style={{
                    display: "flex", justifyContent: "space-between",
                    fontSize: 11.5, marginBottom: 3,
                  }}>
                    <span style={{ color: "var(--ink-700)" }}>
                      {c.category.emoji && <span style={{ marginRight: 4 }}>{c.category.emoji}</span>}
                      {c.category.label}
                    </span>
                    <span className="num" style={{ color: "var(--ink-700)", fontWeight: 600 }}>
                      {c.count}
                    </span>
                  </div>
                  <div style={{ height: 3, background: "var(--ink-100)", borderRadius: 99 }}>
                    <div style={{
                      width: `${(c.count / catMax) * 100}%`,
                      height: "100%",
                      background: "var(--brand-500)",
                      borderRadius: 99,
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <ActivityIcon2 size={14} style={{ color: "var(--st-assess)" }} />
            <span className="panel-title">Activity</span>
            <span style={{ flex: 1 }} />
            <span className="panel-sub">ล่าสุด</span>
          </div>
          <div className="activity">
            {props.activity.length === 0 && (
              <div style={{ padding: "32px 14px", textAlign: "center", color: "var(--ink-500)", fontSize: 12 }}>
                ยังไม่มีกิจกรรม
              </div>
            )}
            {props.activity.map((a) => {
              const cls =
                a.kind === "CREATED" ? "info"
                : a.kind === "ASSIGN" || a.kind === "UNASSIGN" ? "info"
                : a.kind === "STATUS_CHANGE" ? "warn"
                : a.kind === "PART_ADDED" || a.kind === "PART_UPDATED" ? "info"
                : a.kind === "CLOSE" ? "good"
                : a.kind === "REOPEN" ? "warn"
                : "";
              return (
                <Link key={a.id} href={`/repairs/triage?selected=${a.ticket.id}`} className="activity-row">
                  <div className={"activity-ico " + cls}><ActivityIconBy kind={a.kind} /></div>
                  <div style={{ minWidth: 0 }}>
                    <div className="activity-line">
                      <b>{a.actor?.name ?? "ระบบ"}</b> · {humanEventLabel(a.kind)}
                    </div>
                    <div className="activity-detail">
                      <span className="num" style={{ fontWeight: 600, color: "var(--ink-700)" }}>
                        {a.ticket.ticketCode}
                      </span>
                      {" · "}{a.ticket.title.slice(0, 48)}
                    </div>
                    <div className="activity-time">{timeAgo(a.createdAt)}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Row 4: Volume by day */}
      <div className="dash-grid">
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">เปิด vs ปิด · สัปดาห์นี้</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: "var(--ink-500)", display: "flex", gap: 12 }}>
              <span>
                <span style={{
                  display: "inline-block", width: 8, height: 8,
                  background: "var(--brand-400)", borderRadius: 2, marginRight: 4,
                }} />
                เปิด
              </span>
              <span>
                <span style={{
                  display: "inline-block", width: 8, height: 8,
                  background: "#A7F3D0", borderRadius: 2, marginRight: 4,
                }} />
                ปิด
              </span>
            </span>
          </div>
          <div className="panel-body">
            <div className="dual-bars">
              {props.volume.map((d, i) => (
                <div className="dual-bar-col" key={i}>
                  <div
                    className="bar new"
                    style={{ height: `${(d.created / volMax) * 100}%` }}
                    title={`เปิด ${d.created}`}
                  />
                  <div
                    className="bar done"
                    style={{ height: `${(d.resolved / volMax) * 100}%` }}
                    title={`ปิด ${d.resolved}`}
                  />
                  <span className="day">{d.label}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 20, marginTop: 28, fontSize: 11.5, color: "var(--ink-600)" }}>
              <SummaryStat label="เปิดเฉลี่ย/วัน" value={(props.volume.reduce((s, v) => s + v.created, 0) / 7).toFixed(1)} />
              <SummaryStat label="ปิดเฉลี่ย/วัน" value={(props.volume.reduce((s, v) => s + v.resolved, 0) / 7).toFixed(1)} />
              <SummaryStat
                label="เปิด − ปิด"
                value={Math.max(0, props.volume.reduce((s, v) => s + (v.created - v.resolved), 0)).toString()}
                tone={props.volume.reduce((s, v) => s + (v.created - v.resolved), 0) > 0 ? "warn" : "default"}
              />
              <SummaryStat label="ด่วนคงเหลือ" value={urgent.toString()} tone={urgent > 0 ? "warn" : "default"} />
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">หมวดที่เปิดอยู่</span>
            <span style={{ flex: 1 }} />
          </div>
          <div className="panel-body no-pad">
            {props.categories.filter((c) => c.count > 0).length === 0 ? (
              <div style={{ padding: 32, textAlign: "center", color: "var(--ink-500)", fontSize: 12 }}>
                ไม่มีหมวดที่เปิดอยู่
              </div>
            ) : (
              props.categories.filter((c) => c.count > 0).map((c) => (
                <div className="hot-row" key={c.category.id}>
                  <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: 6,
                      background: "var(--ink-50)", color: "var(--ink-600)",
                      display: "grid", placeItems: "center", flexShrink: 0, fontSize: 12,
                    }}>
                      {c.category.emoji ?? "🛠"}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div className="hot-name">{c.category.label}</div>
                      <div className="hot-bar">
                        <div style={{
                          width: `${(c.count / catMax) * 100}%`,
                          background: "var(--brand-500)",
                        }} />
                      </div>
                    </div>
                  </div>
                  <div className="hot-count num">
                    {c.count}<span className="sub">ใบ</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ----- helpers -----

function FunnelStep({
  step,
  isLast,
}: {
  step: { key: RepairTicketStatus; label: string; count: number; dot: string; meta: string };
  isLast: boolean;
}) {
  return (
    <>
      <Link href={`/repairs/triage?status=${step.key}`} className="funnel-step">
        <div className="funnel-label">
          <span className="step-dot" style={{ background: step.dot }} />
          {step.label}
        </div>
        <div className="funnel-count num">{step.count}</div>
        <div className="funnel-meta">{step.meta}</div>
      </Link>
      {!isLast && <div className="funnel-arrow"><ChevronRight size={14} /></div>}
    </>
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
      className={
        "queue-tab " +
        (active ? "is-active " : "") +
        (tone === "danger" ? "is-danger " : tone === "warn" ? "is-warn " : "")
      }
    >
      {children}
      <span className="count">{count}</span>
    </button>
  );
}

function SummaryStat({
  label, value, tone = "default",
}: {
  label: string; value: string; tone?: "default" | "warn";
}) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: "var(--ink-500)" }}>{label}</div>
      <div className="num" style={{
        fontSize: 16, fontWeight: 600,
        color: tone === "warn" ? "var(--warn)" : "var(--ink-900)",
      }}>
        {value}
      </div>
    </div>
  );
}

function ActivityIconBy({ kind }: { kind: string }) {
  const size = 12;
  switch (kind) {
    case "CREATED": return <PlusCircle size={size} />;
    case "ASSIGN":
    case "UNASSIGN": return <Users size={size} />;
    case "STATUS_CHANGE": return <Wrench size={size} />;
    case "PART_ADDED":
    case "PART_UPDATED": return <PackageSearch size={size} />;
    case "CLOSE": return <CheckCircle2 size={size} />;
    case "REOPEN": return <AlertTriangle size={size} />;
    case "PHOTO_ADDED": return <Receipt size={size} />;
    default: return <Layers size={size} />;
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
    ETA_SET: "กำหนดเวลามาถึง",
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
  const palette = [
    "#2563EB", "#7C3AED", "#DB2777", "#059669",
    "#EA580C", "#0891B2", "#CA8A04", "#475569",
  ];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
