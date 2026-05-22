// Pooil App · single-ticket detail panel. Uses design's .detail-*, .timeline,
// .cost-row, .composer, .photos classes. Server component.
import Link from "next/link";
import {
  STATUS_LABELS,
  URGENCY_LABELS,
  PHOTO_PHASE_LABELS,
  EVENT_KIND_LABELS,
  PART_STATUS_LABELS,
  formatBaht,
  totalTicketCost,
  downtimeCostBaht,
} from "@/lib/repair/types";

function partStatusClass(s: "NEEDED" | "ORDERED" | "DELIVERED" | "INSTALLED" | "CANCELLED"): string {
  switch (s) {
    case "NEEDED": return "pill-approval";
    case "ORDERED": return "pill-new";
    case "DELIVERED": return "pill-assess";
    case "INSTALLED": return "pill-done";
    default: return "pill-low";
  }
}
import { slaStatusFor, slaBadgeLabel } from "@/lib/repair/sla";
import { TicketActions } from "./ticket-actions";
import { TicketComposer } from "./ticket-composer";
import {
  Clock,
  User,
  Phone,
  MessageSquare,
  ExternalLink,
  Building2,
  Flame,
  MapPin,
} from "lucide-react";

// Camera icon imported on PublicForm side; keep tree-shake hint to mark
// `lucide-react/dist/esm/icons/camera` as used by some consumer (TicketComposer).
import type { LucideIcon as _LucideIcon } from "lucide-react";
void (null as unknown as _LucideIcon | null);
import type {
  RepairTicketStatus,
  RepairUrgency,
} from "@/lib/generated/prisma/enums";

interface Technician {
  id: string;
  name: string;
  kind: "INTERNAL" | "VENDOR";
  isActive: boolean;
}

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ticket: any;
  technicians: Technician[];
  canWrite: boolean;
  canAdmin: boolean;
}

const STATUS_CLS: Record<RepairTicketStatus, string> = {
  NEW: "pill-new",
  ACK: "pill-assess",
  IN_PROGRESS: "pill-approval",
  WAITING_PARTS: "pill-parts",
  RESOLVED: "pill-done",
  CLOSED: "pill-done",
  CANCELLED: "pill-low",
};

function fmtDateTime(d: Date | string | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(typeof d === "string" ? new Date(d) : d);
}

const STATUS_PIPELINE: RepairTicketStatus[] = [
  "NEW", "ACK", "IN_PROGRESS", "WAITING_PARTS", "RESOLVED", "CLOSED",
];

export function TicketDetailPanel({
  ticket,
  technicians,
  canWrite,
  canAdmin,
}: Props) {
  const sla = slaStatusFor(ticket);
  const total = totalTicketCost(ticket);
  const downtime = downtimeCostBaht({
    businessType: ticket.branch?.businessType ?? null,
    startedAt: ticket.createdAt ? new Date(ticket.createdAt) : null,
    endedAt: ticket.resolvedAt ? new Date(ticket.resolvedAt) : null,
  });
  const isOpen =
    ticket.status !== "RESOLVED" &&
    ticket.status !== "CLOSED" &&
    ticket.status !== "CANCELLED";
  const pipelineIdx = STATUS_PIPELINE.indexOf(ticket.status as RepairTicketStatus);
  const currentStatus = ticket.status as RepairTicketStatus;

  return (
    <>
      {/* head */}
      <div className="detail-head">
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="detail-id">{ticket.ticketCode}</span>
          <Link
            href={`/repairs/${ticket.id}`}
            className="btn btn-ghost btn-sm"
            title="เปิดเต็มหน้า"
            style={{ padding: "2px 6px" }}
          >
            <ExternalLink size={11} /> เต็มหน้า
          </Link>
          <span className={"pill " + STATUS_CLS[currentStatus]}>
            <span className="dot" />
            {STATUS_LABELS[currentStatus]}
          </span>
          <span className={
            "pill " +
            (ticket.urgency === "URGENT" ? "pill-urgent" :
             ticket.urgency === "NORMAL" ? "pill-normal" : "pill-low")
          }>
            {ticket.urgency === "URGENT" && <Flame size={10} style={{ marginRight: 2 }} />}
            {URGENCY_LABELS[ticket.urgency as RepairUrgency]}
          </span>
          <span style={{ flex: 1 }} />
          {sla !== "done" && (
            <span className={"sla " + sla}>
              <Clock />
              {slaBadgeLabel(sla, ticket.resolveDueAt)}
            </span>
          )}
        </div>
        <h2 className="detail-title">{ticket.title}</h2>
        <div className="detail-meta-row">
          {ticket.branch && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Building2 size={12} />
              <span className="num" style={{ fontWeight: 600, color: "var(--ink-800)" }}>
                {ticket.branch.code}
              </span>
              <span>{ticket.branch.name}</span>
              {ticket.branch.province && (
                <>
                  <span style={{ color: "var(--ink-300)" }}>·</span>
                  <span>{ticket.branch.province}</span>
                </>
              )}
            </span>
          )}
          {ticket.category && (
            <>
              <span style={{ color: "var(--ink-300)" }}>·</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {ticket.category.emoji && <span>{ticket.category.emoji}</span>}
                {ticket.category.label}
              </span>
            </>
          )}
          <span style={{ color: "var(--ink-300)" }}>·</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <User size={12} /> {ticket.reporterName}
          </span>
        </div>

        {/* Quick action bar */}
        <div className="detail-actions">
          <a
            href={`tel:${ticket.reporterPhone}`}
            className="btn"
            style={{ background: "var(--good)", borderColor: "#047857", color: "#fff" }}
          >
            <Phone /> โทรหาผู้แจ้ง
          </a>
          <a
            href={`https://line.me/R/msg/text/?${encodeURIComponent(
              `เรียน ${ticket.reporterName}\nใบแจ้งซ่อม ${ticket.ticketCode}\nสถานะ: ${STATUS_LABELS[currentStatus]}`,
            )}`}
            target="_blank"
            rel="noreferrer"
            className="btn"
            style={{ background: "#06C755", borderColor: "#05A047", color: "#fff" }}
          >
            <MessageSquare /> ส่ง LINE
          </a>
          {ticket.branch && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                `${ticket.branch.code} ${ticket.branch.name} ${ticket.branch.province ?? ""}`,
              )}`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-primary"
            >
              <MapPin /> แผนที่
            </a>
          )}
          {ticket.assignedTech?.phone && (
            <a
              href={`tel:${ticket.assignedTech.phone}`}
              className="btn"
              style={{ background: "var(--ink-900)", borderColor: "var(--ink-1000)", color: "#fff" }}
            >
              <Phone /> โทรหาช่าง
            </a>
          )}
        </div>
      </div>

      {/* body */}
      <div className="detail-body">
        {/* MAIN */}
        <div className="detail-main">
          {/* Status pipeline */}
          {ticket.status !== "CANCELLED" && (
            <div style={{
              background: "var(--surface-2)", border: "1px solid var(--line-2)",
              borderRadius: 10, padding: 12, marginBottom: 16,
            }}>
              <div style={{
                fontSize: 10.5, color: "var(--ink-500)", textTransform: "uppercase",
                letterSpacing: "0.06em", fontWeight: 600, marginBottom: 8,
              }}>
                สถานะปัจจุบัน
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {STATUS_PIPELINE.map((s, i) => {
                  const isCurrent = i === pipelineIdx;
                  const isPast = i < pipelineIdx;
                  return (
                    <div key={s} style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        height: 6, borderRadius: 99,
                        background: isPast || isCurrent ? "var(--brand-500)" : "var(--ink-200)",
                      }} />
                      <div style={{
                        marginTop: 4, fontSize: 10, fontWeight: 600,
                        color: isCurrent ? "var(--brand-700)" :
                               isPast ? "var(--ink-700)" : "var(--ink-400)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {STATUS_LABELS[s]}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="section-h">รายละเอียดอาการ</div>
          {ticket.description ? (
            <div style={{ fontSize: 13, color: "var(--ink-800)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
              {ticket.description}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--ink-400)", fontStyle: "italic" }}>—</div>
          )}
          {ticket.customerImpact && (
            <div style={{
              marginTop: 12, background: "#FFFBEB", border: "1px solid #FDE68A",
              borderRadius: 8, padding: 10, fontSize: 12.5,
            }}>
              <p style={{ fontWeight: 700, color: "#92400E", margin: 0 }}>⚠️ ผลกระทบลูกค้า</p>
              <p style={{ color: "#92400E", margin: "2px 0 0", opacity: 0.85 }}>{ticket.customerImpact}</p>
            </div>
          )}
          {downtime > 0 && (
            <div style={{
              marginTop: 12,
              background: isOpen ? "#FEF2F2" : "var(--surface-2)",
              border: "1px solid " + (isOpen ? "#FECACA" : "var(--line)"),
              borderRadius: 8, padding: 10,
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
              fontSize: 12.5,
            }}>
              <div>
                <p style={{ fontWeight: 700, margin: 0, color: isOpen ? "var(--bad)" : "var(--ink-600)" }}>
                  {isOpen ? "🔥 ค่าเสียโอกาสสด" : "💰 ค่าเสียโอกาสรวม"}
                </p>
                <p style={{ fontSize: 11, color: "var(--ink-500)", margin: "2px 0 0" }}>
                  ประมาณจากชนิดสาขา · ทุก ชม. ที่ใบยังเปิด
                </p>
              </div>
              <p className="num" style={{
                fontWeight: 700, fontSize: 20,
                color: isOpen ? "var(--bad)" : "var(--ink-700)", margin: 0,
              }}>
                {formatBaht(downtime * 100)}
              </p>
            </div>
          )}

          {/* Photos */}
          {ticket.photos && ticket.photos.length > 0 && (
            <>
              <div className="section-h">รูปภาพ ({ticket.photos.length})</div>
              <div className="photos">
                {ticket.photos.map(
                  (p: {
                    id: string;
                    phase: string;
                    r2PublicUrl: string;
                    caption: string | null;
                  }) => (
                    <a
                      key={p.id}
                      href={p.r2PublicUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="photo-tile"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.r2PublicUrl}
                        alt={p.caption ?? ""}
                        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                      />
                      <span style={{
                        position: "absolute", top: 4, left: 4,
                        padding: "1px 6px", height: 18,
                        display: "inline-flex", alignItems: "center",
                        borderRadius: 4, fontSize: 10, fontWeight: 700,
                        background: "rgba(11, 18, 32, 0.85)", color: "#fff",
                      }}>
                        {PHOTO_PHASE_LABELS[p.phase as "BEFORE"]}
                      </span>
                    </a>
                  ),
                )}
              </div>
            </>
          )}

          {/* Parts */}
          {ticket.parts && ticket.parts.length > 0 && (
            <>
              <div className="section-h">อะไหล่ ({ticket.parts.length})</div>
              <div style={{ border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
                <table className="dtable">
                  <thead>
                    <tr>
                      <th>รายการ</th>
                      <th className="num">จำนวน</th>
                      <th className="num">ราคา/หน่วย</th>
                      <th className="num">รวม</th>
                      <th>สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ticket.parts.map(
                      (p: {
                        id: string;
                        name: string;
                        spec: string | null;
                        quantity: number;
                        unit: string;
                        unitPriceCents: number;
                        status: "NEEDED" | "ORDERED" | "DELIVERED" | "INSTALLED" | "CANCELLED";
                      }) => (
                        <tr key={p.id}>
                          <td>
                            <p style={{ fontWeight: 500, color: "var(--ink-900)", margin: 0 }}>{p.name}</p>
                            {p.spec && (
                              <p style={{ fontSize: 10.5, color: "var(--ink-500)", margin: "1px 0 0" }}>
                                {p.spec}
                              </p>
                            )}
                          </td>
                          <td className="num">{p.quantity} {p.unit}</td>
                          <td className="num">{formatBaht(p.unitPriceCents)}</td>
                          <td className="num" style={{ fontWeight: 600 }}>
                            {formatBaht(p.unitPriceCents * p.quantity)}
                          </td>
                          <td>
                            <span
                              className={"pill " + partStatusClass(p.status)}
                              style={{ padding: "1px 6px", fontSize: 10 }}
                            >
                              {PART_STATUS_LABELS[p.status]}
                            </span>
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Timeline */}
          <div className="section-h">ไทม์ไลน์ ({ticket.events?.length ?? 0})</div>
          <div className="timeline">
            {(ticket.events ?? []).map(
              (
                ev: {
                  id: string;
                  kind: string;
                  actorName: string;
                  payload: unknown;
                  createdAt: Date | string;
                },
                i: number,
                arr: { length: number }[],
              ) => {
                const isLast = i === arr.length - 1;
                const p = ev.payload as Record<string, unknown> | null;
                const body =
                  (p?.body as string | undefined) ??
                  (p?.comment as string | undefined);
                const from = p?.from as string | undefined;
                const to = p?.to as string | undefined;
                return (
                  <div
                    className={"timeline-item " + (isLast ? "now" : "done")}
                    key={ev.id}
                  >
                    <div className="who">
                      {ev.actorName} · {fmtDateTime(ev.createdAt)}
                    </div>
                    <div className="what">
                      {EVENT_KIND_LABELS[ev.kind as "CREATED"]}
                      {from && to && (
                        <span style={{ color: "var(--ink-500)", fontWeight: 400, marginLeft: 6 }}>
                          {STATUS_LABELS[from as RepairTicketStatus] ?? from} →{" "}
                          {STATUS_LABELS[to as RepairTicketStatus] ?? to}
                        </span>
                      )}
                    </div>
                    {body && <div className="detail">{body}</div>}
                  </div>
                );
              },
            )}
          </div>
        </div>

        {/* SIDE */}
        <div className="detail-side">
          {ticket.assignedTech && (
            <div className="detail-side-section">
              <div className="detail-side-label">ช่างที่รับผิดชอบ</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="tech-chip" style={{
                  width: 30, height: 30, fontSize: 11.5,
                  background: techColor(ticket.assignedTech.id),
                }}>
                  {ticket.assignedTech.name.charAt(0)}
                </span>
                <div>
                  <div className="detail-side-value">{ticket.assignedTech.name}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-500)" }}>
                    {ticket.assignedTech.kind === "INTERNAL" ? "ช่างใน" : "Vendor"}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="detail-side-section">
            <div className="detail-side-label">SLA</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className={"sla " + sla}>
                <Clock />
                {slaBadgeLabel(sla, ticket.resolveDueAt)}
              </span>
              {ticket.resolveDueAt && (
                <div style={{ fontSize: 11, color: "var(--ink-500)" }}>
                  ต้องเสร็จก่อน <b className="num" style={{ color: "var(--ink-700)" }}>
                    {fmtDateTime(ticket.resolveDueAt)}
                  </b>
                </div>
              )}
            </div>
          </div>

          <div className="detail-side-section">
            <div className="detail-side-label">ค่าใช้จ่าย</div>
            <div className="cost-row">
              <span className="label">อะไหล่</span>
              <span className="val num">{formatBaht(ticket.partsCostCents)}</span>
            </div>
            <div className="cost-row">
              <span className="label">ค่าแรง</span>
              <span className="val num">{formatBaht(ticket.laborCostCents)}</span>
            </div>
            <div className="cost-row total">
              <span className="label">{ticket.resolvedAt ? "ใช้จริง" : "ประเมิน"}</span>
              <span className="val num" style={{
                color: ticket.resolvedAt ? "var(--good)" : "var(--brand-700)",
              }}>
                {total > 0 ? formatBaht(total) : "ยังไม่ประเมิน"}
              </span>
            </div>
          </div>

          <div className="detail-side-section">
            <div className="detail-side-label">ผู้แจ้ง</div>
            <div className="detail-side-value">{ticket.reporterName}</div>
            <div style={{ fontSize: 11, color: "var(--ink-500)", marginTop: 2 }}>
              <Phone size={10} style={{ display: "inline" }} /> {ticket.reporterPhone}
            </div>
          </div>

          {ticket.branch && (
            <div className="detail-side-section">
              <div className="detail-side-label">สาขา</div>
              <div className="detail-side-value">{ticket.branch.name}</div>
              <div style={{ fontSize: 11, color: "var(--ink-500)", marginTop: 2 }}>
                <span className="num" style={{ color: "var(--ink-700)", fontWeight: 600 }}>
                  {ticket.branch.code}
                </span>{" "}
                {ticket.branch.province && `· ${ticket.branch.province}`}
              </div>
            </div>
          )}

          <div className="detail-side-section">
            <div className="detail-side-label">เปิดเมื่อ</div>
            <div className="num" style={{ fontSize: 12, color: "var(--ink-700)" }}>
              {fmtDateTime(ticket.createdAt)}
            </div>
            {ticket.resolvedAt && (
              <>
                <div className="detail-side-label" style={{ marginTop: 8 }}>เสร็จเมื่อ</div>
                <div className="num" style={{ fontSize: 12, color: "var(--ink-700)" }}>
                  {fmtDateTime(ticket.resolvedAt)}
                </div>
                {ticket.resolvedBy && (
                  <div style={{ fontSize: 11, color: "var(--ink-500)" }}>
                    โดย {ticket.resolvedBy.name}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Action panel (status/assign/etc.) — collapsed below sidebar */}
          {canWrite && (
            <div className="detail-side-section" style={{
              background: "var(--surface-2)",
              padding: 10, borderRadius: 8,
              marginTop: 12,
            }}>
              <div className="detail-side-label">ดำเนินการ</div>
              <TicketActions
                ticketId={ticket.id}
                currentStatus={ticket.status}
                currentTechId={ticket.assignedTech?.id ?? null}
                currentEta={ticket.etaAt ? new Date(ticket.etaAt).toISOString() : null}
                technicians={technicians}
                canAdmin={canAdmin}
              />
            </div>
          )}
        </div>
      </div>

      {/* Composer (chat-style note bar) */}
      {canWrite && <TicketComposer ticketId={ticket.id} />}
    </>
  );
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

