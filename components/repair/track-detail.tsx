// Server component — public-facing tracking detail (Pooil App redesign)
// Shows status pipeline + branch + photos + timeline. No edit actions.
import Link from "next/link";
import {
  STATUS_LABELS,
  STATUS_COLORS,
  URGENCY_LABELS,
  URGENCY_COLORS,
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

const STATUS_DOT: Record<string, string> = {
  NEW: "bg-blue-500",
  ACK: "bg-violet-500",
  IN_PROGRESS: "bg-amber-500",
  WAITING_PARTS: "bg-cyan-500",
  RESOLVED: "bg-emerald-500",
  CLOSED: "bg-zinc-400",
  CANCELLED: "bg-zinc-300",
};

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
    <div className="max-w-2xl mx-auto space-y-3">
      <Link
        href="/r/track"
        className="inline-flex items-center gap-1 text-[12px] text-blue-700 font-semibold hover:text-blue-900"
      >
        <ChevronLeft className="size-3.5" />
        ค้นใบอื่น
      </Link>

      {/* Hero header */}
      <div className="bg-white border border-zinc-200 rounded-3xl p-5 sm:p-6">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-800 rounded-full font-mono font-bold text-sm">
            <Receipt className="size-3.5" />
            {ticket.ticketCode}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold border ${STATUS_COLORS[ticket.status]}`}
            >
              <span className={`size-1.5 rounded-full ${STATUS_DOT[ticket.status]}`} />
              {STATUS_LABELS[ticket.status]}
            </span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold border ${URGENCY_COLORS[ticket.urgency]}`}
            >
              {URGENCY_LABELS[ticket.urgency]}
            </span>
            {sla !== "done" && (
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold border ${slaBadgeColor(sla)}`}
              >
                <Clock className="size-3" />
                {slaBadgeLabel(sla, ticket.resolveDueAt)}
              </span>
            )}
          </div>
        </div>

        <h1 className="mt-3 text-xl sm:text-2xl font-extrabold tracking-tight text-zinc-900 leading-snug">
          {ticket.category?.emoji && <span className="mr-1">{ticket.category.emoji}</span>}
          {ticket.title}
        </h1>
        {ticket.description && (
          <p className="mt-2 text-[13.5px] text-zinc-700 whitespace-pre-wrap leading-relaxed">
            {ticket.description}
          </p>
        )}
      </div>

      {/* Status pipeline */}
      {!isCancelled && (
        <div className="bg-white border border-zinc-200 rounded-2xl p-4">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-zinc-500 mb-2">
            ความก้าวหน้า
          </div>
          <div className="flex items-center gap-1">
            {PIPELINE.map((p, i) => {
              const isCurrent = i === pipelineIdx;
              const isPast = i < pipelineIdx;
              return (
                <div key={p.key} className="flex-1 min-w-0">
                  <div
                    className={`h-2 rounded-full ${
                      isPast || isCurrent ? "bg-blue-500" : "bg-zinc-200"
                    }`}
                  />
                  <p
                    className={`mt-1 text-[10.5px] font-semibold text-center truncate ${
                      isCurrent
                        ? "text-blue-700"
                        : isPast
                          ? "text-zinc-700"
                          : "text-zinc-400"
                    }`}
                  >
                    {p.label}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Meta */}
      <div className="bg-white border border-zinc-200 rounded-2xl p-4 grid sm:grid-cols-2 gap-3 text-[12.5px]">
        {ticket.branch && (
          <Meta
            icon={<Building2 className="size-3.5 text-zinc-500" />}
            label="สาขา"
          >
            <span className="font-mono font-bold text-zinc-700">
              {ticket.branch.code}
            </span>
            {" · "}
            {ticket.branch.name}
          </Meta>
        )}
        {ticket.assignedTech && (
          <Meta
            icon={<User className="size-3.5 text-zinc-500" />}
            label="ช่างที่ดูแล"
          >
            {ticket.assignedTech.name}
            {ticket.assignedTech.kind === "VENDOR" && (
              <span className="ml-1 text-[10px] bg-violet-50 text-violet-700 px-1 py-px rounded font-bold">
                VENDOR
              </span>
            )}
          </Meta>
        )}
        <Meta icon={<Clock className="size-3.5 text-zinc-500" />} label="เปิดเมื่อ">
          {fmtDateTime(ticket.createdAt)}
        </Meta>
        {ticket.resolvedAt && (
          <Meta
            icon={<CheckCircle2 className="size-3.5 text-emerald-600" />}
            label="เสร็จเมื่อ"
          >
            {fmtDateTime(ticket.resolvedAt)}
          </Meta>
        )}
        {total > 0 && (
          <Meta
            icon={<Receipt className="size-3.5 text-zinc-500" />}
            label="ค่าใช้จ่าย"
          >
            <span className="tabular-nums font-bold">{formatBaht(total)}</span>
          </Meta>
        )}
        <Meta icon={<MapPin className="size-3.5 text-zinc-500" />} label="ผู้แจ้ง">
          {ticket.reporterName}
        </Meta>
      </div>

      {/* Photos */}
      {ticket.photos.length > 0 && (
        <div className="bg-white border border-zinc-200 rounded-2xl p-4">
          <h3 className="font-bold text-zinc-900 mb-2 flex items-center gap-2 text-[13.5px]">
            <Camera className="size-3.5" />
            รูปภาพ ({ticket.photos.length})
          </h3>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {ticket.photos.map((p) => (
              <a
                key={p.id}
                href={p.r2PublicUrl}
                target="_blank"
                rel="noreferrer"
                className="relative aspect-square rounded-lg overflow-hidden border border-zinc-200 bg-zinc-100"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.r2PublicUrl}
                  alt={p.caption ?? ""}
                  className="absolute inset-0 size-full object-cover"
                />
                <span className="absolute top-1 left-1 px-1.5 h-5 inline-flex items-center rounded text-[10px] font-bold bg-zinc-900/85 text-white">
                  {PHOTO_PHASE_LABELS[p.phase]}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="bg-white border border-zinc-200 rounded-2xl p-4">
        <h3 className="font-bold text-zinc-900 mb-3 text-[13.5px]">
          ไทม์ไลน์
        </h3>
        <ol className="space-y-2 border-l-2 border-zinc-200 pl-4">
          {ticket.events.map((ev) => {
            const p = ev.payload as Record<string, unknown> | null;
            const body =
              (p?.body as string | undefined) ?? (p?.comment as string | undefined);
            return (
              <li key={ev.id} className="relative -left-[22px] pl-5">
                <span className="absolute left-0 top-1.5 size-2.5 rounded-full bg-blue-500 border-2 border-white shadow" />
                <div className="bg-zinc-50 rounded-lg border border-zinc-200 p-2.5">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <p className="font-bold text-zinc-900 text-[12.5px]">
                      {EVENT_KIND_LABELS[ev.kind]}
                    </p>
                    <p className="text-[10.5px] text-zinc-500 tabular-nums">
                      {fmtDateTime(ev.createdAt)}
                    </p>
                  </div>
                  <p className="text-[11px] text-zinc-600 mt-0.5">
                    โดย {ev.actorName}
                  </p>
                  {body && (
                    <p className="mt-1.5 text-[12.5px] text-zinc-800 whitespace-pre-wrap leading-relaxed">
                      {body}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Contact info */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-[12.5px] text-blue-900">
        <p className="font-bold">ใบนี้เป็นของ {ticket.reporterName}</p>
        <p className="mt-1 text-blue-800">
          เบอร์ที่ใช้แจ้ง:{" "}
          <a
            href={`tel:${ticket.reporterPhone}`}
            className="font-mono font-bold tabular-nums underline"
          >
            {ticket.reporterPhone}
          </a>
        </p>
        {ticket.assignedTech?.phone && (
          <p className="mt-2 text-blue-800">
            ติดต่อช่าง {ticket.assignedTech.name}:{" "}
            <a
              href={`tel:${ticket.assignedTech.phone}`}
              className="font-mono font-bold tabular-nums underline"
            >
              <Phone className="size-3 inline" /> {ticket.assignedTech.phone}
            </a>
          </p>
        )}
      </div>
    </div>
  );
}

function Meta({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5 size-4 grid place-items-center flex-shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
          {label}
        </p>
        <p className="text-zinc-900 font-medium text-[13px]">{children}</p>
      </div>
    </div>
  );
}
