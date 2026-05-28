// Public-facing track detail · Pooil App vocab
import Link from "next/link";
import {
  STATUS_LABELS,
  URGENCY_LABELS,
  PHOTO_PHASE_LABELS,
  EVENT_KIND_LABELS,
  formatBaht,
  totalTicketCost,
} from "@/lib/repair/types";
import { slaStatusFor, slaBadgeColor, slaBadgeLabel } from "@/lib/repair/sla";
import {
  Clock,
  MapPin,
  User,
  Phone,
  Camera,
  ChevronLeft,
  CheckCircle2,
  Building2,
  Receipt,
} from "lucide-react";

interface Photo {
  id: string;
  phase: "BEFORE" | "DURING" | "AFTER" | "PART" | "RECEIPT";
  r2PublicUrl: string;
  caption: string | null;
}
interface Event {
  id: string;
  kind: import("@/lib/generated/prisma/enums").RepairEventKind;
  actorName: string;
  payload: unknown;
  createdAt: Date;
}
interface Ticket {
  id: string;
  ticketCode: string;
  title: string;
  description: string;
  status: import("@/lib/generated/prisma/enums").RepairTicketStatus;
  urgency: import("@/lib/generated/prisma/enums").RepairUrgency;
  reporterName: string;
  reporterPhone: string;
  partsCostCents: number;
  laborCostCents: number;
  resolveDueAt: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
  branch: { id: string; name: string; code: string; businessType: string } | null;
  company: { name: string; code: string } | null;
  category: { id: string; label: string; emoji: string | null } | null;
  assignedTech: { name: string; kind: "INTERNAL" | "VENDOR"; phone: string | null } | null;
  photos: Photo[];
  events: Event[];
}

const PIPELINE: Array<{
  key: import("@/lib/generated/prisma/enums").RepairTicketStatus;
  label: string;
}> = [
  { key: "NEW", label: "เปิดใบ" },
  { key: "ACK", label: "รับงาน" },
  { key: "IN_PROGRESS", label: "ซ่อม" },
  { key: "WAITING_PARTS", label: "รออะไหล่" },
  { key: "RESOLVED", label: "เสร็จ" },
  { key: "CLOSED", label: "ปิดงาน" },
];

function fmtDateTime(d: Date | string | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(typeof d === "string" ? new Date(d) : d);
}

export function PublicTrackDetail({ ticket }: { ticket: Ticket }) {
  const sla = slaStatusFor(ticket);
  const total = totalTicketCost(ticket);
  const pipelineIdx = PIPELINE.findIndex((p) => p.key === ticket.status);
  const isCancelled = ticket.status === "CANCELLED";

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 12 }}>
      <Link
        href="/r/track"
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          fontSize: 12, color: "#1740A3", fontWeight: 600, textDecoration: "none",
        }}
      >
        <ChevronLeft size={13} />
        ค้นใบอื่น
      </Link>

      {/* Hero header */}
      <div style={{
        background: "white", border: "1px solid #E5EAF2",
        borderRadius: 24, padding: 24,
      }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "4px 14px", background: "#EFF4FF", color: "#1740A3",
            borderRadius: 99, fontWeight: 700, fontSize: 14,
            fontFamily: "IBM Plex Sans, system-ui",
          }}>
            <Receipt size={13} />
            {ticket.ticketCode}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <StatusPill status={ticket.status} />
            <UrgencyPill urgency={ticket.urgency} />
            {sla !== "done" && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "2px 8px", borderRadius: 4,
                fontSize: 11, fontWeight: 700,
                border: "1px solid",
                ...slaBadgePalette(sla),
              }}>
                <Clock size={11} />
                {slaBadgeLabel(sla, ticket.resolveDueAt)}
              </span>
            )}
          </div>
        </div>
        <h1 style={{
          marginTop: 12, fontSize: 22, fontWeight: 700, letterSpacing: "-0.015em",
          color: "#0B1220", lineHeight: 1.3,
        }}>
          {ticket.category?.emoji && <span style={{ marginRight: 6 }}>{ticket.category.emoji}</span>}
          {ticket.title}
        </h1>
        {ticket.description && (
          <p style={{ marginTop: 8, fontSize: 13, color: "#374151", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
            {ticket.description}
          </p>
        )}
      </div>

      {/* Pipeline */}
      {!isCancelled && (
        <div style={{
          background: "white", border: "1px solid #E5EAF2",
          borderRadius: 16, padding: 16,
        }}>
          <div style={{
            fontSize: 10.5, color: "#64748B", fontWeight: 700,
            textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8,
          }}>
            ความก้าวหน้า
          </div>
          <div className="rf-track-pipeline">
            {PIPELINE.map((p, i) => {
              const isCurrent = i === pipelineIdx;
              const isPast = i < pipelineIdx;
              return (
                <div key={p.key}>
                  <div className={"rf-track-bar " + (isPast || isCurrent ? "is-active" : "")} />
                  <div className={
                    "rf-track-label " +
                    (isCurrent ? "is-current" : isPast ? "is-past" : "")
                  }>
                    {p.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Meta */}
      <div style={{
        background: "white", border: "1px solid #E5EAF2",
        borderRadius: 16, padding: 16,
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12,
        fontSize: 12.5,
      }}>
        {ticket.branch && (
          <Meta icon={<Building2 size={13} />} label="สาขา">
            <span className="num" style={{ fontWeight: 700, color: "#374151" }}>{ticket.branch.code}</span>
            <span style={{ marginLeft: 6 }}>{ticket.branch.name}</span>
          </Meta>
        )}
        {ticket.assignedTech && (
          <Meta icon={<User size={13} />} label="ช่างที่ดูแล">
            {ticket.assignedTech.name}
            {ticket.assignedTech.kind === "VENDOR" && (
              <span style={{
                marginLeft: 6, fontSize: 10, padding: "1px 6px",
                background: "#F5F3FF", color: "#6D28D9", borderRadius: 4, fontWeight: 700,
              }}>
                VENDOR
              </span>
            )}
          </Meta>
        )}
        <Meta icon={<Clock size={13} />} label="เปิดเมื่อ">
          {fmtDateTime(ticket.createdAt)}
        </Meta>
        {ticket.resolvedAt && (
          <Meta icon={<CheckCircle2 size={13} />} label="เสร็จเมื่อ">
            {fmtDateTime(ticket.resolvedAt)}
          </Meta>
        )}
        {total > 0 && (
          <Meta icon={<Receipt size={13} />} label="ค่าใช้จ่าย">
            <span className="num" style={{ fontWeight: 700 }}>{formatBaht(total)}</span>
          </Meta>
        )}
        <Meta icon={<MapPin size={13} />} label="ผู้แจ้ง">
          {ticket.reporterName}
        </Meta>
      </div>

      {/* Photos */}
      {ticket.photos.length > 0 && (
        <div style={{ background: "white", border: "1px solid #E5EAF2", borderRadius: 16, padding: 16 }}>
          <h3 style={{
            fontSize: 13, fontWeight: 700, color: "#0B1220",
            margin: "0 0 10px", display: "flex", alignItems: "center", gap: 6,
          }}>
            <Camera size={14} />
            รูปภาพ ({ticket.photos.length})
          </h3>
          <div className="rf-photo-grid">
            {ticket.photos.map((p) => (
              <a
                key={p.id}
                href={p.r2PublicUrl}
                target="_blank"
                rel="noreferrer"
                className="rf-photo-tile"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.r2PublicUrl} alt={p.caption ?? ""}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                />
                <span style={{
                  position: "absolute", top: 4, left: 4,
                  padding: "1px 6px", borderRadius: 4,
                  fontSize: 10, fontWeight: 700,
                  background: "rgba(11, 18, 32, 0.85)", color: "white",
                }}>
                  {PHOTO_PHASE_LABELS[p.phase]}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div style={{ background: "white", border: "1px solid #E5EAF2", borderRadius: 16, padding: 16 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: "#0B1220", margin: "0 0 12px" }}>
          ไทม์ไลน์
        </h3>
        <ol style={{
          listStyle: "none", margin: 0, padding: "0 0 0 18px",
          borderLeft: "2px solid #E5EAF2", display: "flex", flexDirection: "column", gap: 10,
        }}>
          {ticket.events.map((ev) => {
            const p = ev.payload as Record<string, unknown> | null;
            const body =
              (p?.body as string | undefined) ?? (p?.comment as string | undefined);
            return (
              <li key={ev.id} style={{ position: "relative", paddingLeft: 16 }}>
                <span style={{
                  position: "absolute", left: -23, top: 6,
                  width: 10, height: 10, borderRadius: 5,
                  background: "#1E4FCC",
                  border: "2px solid white",
                  boxShadow: "0 0 0 1px #E5EAF2",
                }} />
                <div style={{
                  background: "#F8FAFD",
                  border: "1px solid #E5EAF2",
                  borderRadius: 10, padding: 10,
                }}>
                  <div style={{
                    display: "flex", alignItems: "baseline", justifyContent: "space-between",
                    gap: 6, flexWrap: "wrap",
                  }}>
                    <p style={{ fontSize: 12.5, fontWeight: 700, color: "#0B1220", margin: 0 }}>
                      {EVENT_KIND_LABELS[ev.kind]}
                    </p>
                    <p className="num" style={{ fontSize: 10.5, color: "#64748B", margin: 0 }}>
                      {fmtDateTime(ev.createdAt)}
                    </p>
                  </div>
                  <p style={{ fontSize: 11, color: "#64748B", margin: "2px 0 0" }}>
                    โดย {ev.actorName}
                  </p>
                  {body && (
                    <p style={{ fontSize: 12.5, color: "#1F2937", margin: "6px 0 0", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                      {body}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Contact card */}
      <div style={{
        background: "#EFF4FF", border: "1px solid #DBE6FF",
        borderRadius: 16, padding: 14,
        fontSize: 12.5, color: "#1740A3",
      }}>
        <p style={{ fontWeight: 700, margin: 0 }}>ใบนี้เป็นของ {ticket.reporterName}</p>
        <p style={{ marginTop: 4, color: "#1E4FCC" }}>
          เบอร์ที่ใช้แจ้ง:{" "}
          <a href={`tel:${ticket.reporterPhone}`} className="num" style={{
            fontWeight: 700, textDecoration: "underline", color: "inherit",
          }}>
            {ticket.reporterPhone}
          </a>
        </p>
        {ticket.assignedTech?.phone && (
          <p style={{ marginTop: 8 }}>
            ติดต่อช่าง {ticket.assignedTech.name}:{" "}
            <a href={`tel:${ticket.assignedTech.phone}`} className="num" style={{
              fontWeight: 700, textDecoration: "underline", color: "inherit",
            }}>
              <Phone size={11} style={{ display: "inline" }} /> {ticket.assignedTech.phone}
            </a>
          </p>
        )}
      </div>
    </div>
  );
}

function Meta({
  icon, label, children,
}: {
  icon: React.ReactNode; label: string; children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
      <div style={{ marginTop: 2, color: "#64748B" }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>
          {label}
        </p>
        <p style={{ fontWeight: 500, color: "#0B1220", margin: "2px 0 0" }}>{children}</p>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: import("@/lib/generated/prisma/enums").RepairTicketStatus }) {
  const palette: Record<typeof status, { bg: string; color: string; border: string }> = {
    NEW:           { bg: "#EFF6FF", color: "#1D4ED8", border: "#BFDBFE" },
    ACK:           { bg: "#F5F3FF", color: "#6D28D9", border: "#DDD6FE" },
    IN_PROGRESS:   { bg: "#FFFBEB", color: "#B45309", border: "#FDE68A" },
    WAITING_PARTS: { bg: "#ECFEFF", color: "#0E7490", border: "#A5F3FC" },
    RESOLVED:      { bg: "#ECFDF5", color: "#047857", border: "#A7F3D0" },
    CLOSED:        { bg: "#F1F5F9", color: "#475569", border: "#CBD5E1" },
    CANCELLED:     { bg: "#F1F5F9", color: "#64748B", border: "#E2E8F0" },
  };
  const p = palette[status];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 4,
      fontSize: 11, fontWeight: 700,
      background: p.bg, color: p.color, border: `1px solid ${p.border}`,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 3, background: "currentColor" }} />
      {STATUS_LABELS[status]}
    </span>
  );
}

function UrgencyPill({ urgency }: { urgency: import("@/lib/generated/prisma/enums").RepairUrgency }) {
  const palette: Record<typeof urgency, { bg: string; color: string; border: string }> = {
    URGENT: { bg: "#FEF2F2", color: "#B91C1C", border: "#FECACA" },
    NORMAL: { bg: "#EFF6FF", color: "#1D4ED8", border: "#BFDBFE" },
    LOW:    { bg: "#F1F5F9", color: "#475569", border: "#CBD5E1" },
  };
  const p = palette[urgency];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", padding: "2px 8px",
      borderRadius: 4, fontSize: 11, fontWeight: 700,
      background: p.bg, color: p.color, border: `1px solid ${p.border}`,
    }}>
      {URGENCY_LABELS[urgency]}
    </span>
  );
}

function slaBadgePalette(s: ReturnType<typeof slaStatusFor>): React.CSSProperties {
  if (s === "overdue") return { background: "#FEF2F2", color: "#B91C1C", borderColor: "#FECACA" };
  if (s === "soon") return { background: "#FFFBEB", color: "#B45309", borderColor: "#FDE68A" };
  if (s === "done") return { background: "#F1F5F9", color: "#64748B", borderColor: "#E2E8F0" };
  return { background: "#ECFDF5", color: "#047857", borderColor: "#A7F3D0" };
}

// Keep tree-shake hint
void slaBadgeColor;
