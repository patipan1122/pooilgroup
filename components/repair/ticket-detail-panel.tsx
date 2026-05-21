// Server component renderer for a single ticket (Pooil App redesign · รอบ 49)
// Shared between Triage inbox right pane and /repairs/[id] standalone page.
import Link from "next/link";
import {
  STATUS_LABELS,
  STATUS_COLORS,
  URGENCY_LABELS,
  URGENCY_COLORS,
  PHOTO_PHASE_LABELS,
  EVENT_KIND_LABELS,
  PART_STATUS_LABELS,
  PART_STATUS_COLORS,
  formatBaht,
  totalTicketCost,
  downtimeCostBaht,
} from "@/lib/repair/types";
import { slaStatusFor, slaBadgeColor, slaBadgeLabel } from "@/lib/repair/sla";
import { TicketActions } from "./ticket-actions";
import {
  Clock,
  MapPin,
  User,
  Phone,
  Camera,
  MessageSquare,
  PackageSearch,
  ExternalLink,
  AlarmClock,
  Flame,
  Building2,
} from "lucide-react";
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

function fmtDateTime(d: Date | string | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(typeof d === "string" ? new Date(d) : d);
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

const STATUS_PIPELINE: RepairTicketStatus[] = [
  "NEW",
  "ACK",
  "IN_PROGRESS",
  "WAITING_PARTS",
  "RESOLVED",
  "CLOSED",
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

  return (
    <div className="p-4 sm:p-5 space-y-5">
      {/* Top bar — pills + open-fullpage link */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <p className="font-mono font-extrabold text-[15px] text-zinc-900">
            {ticket.ticketCode}
          </p>
          <Link
            href={`/repairs/${ticket.id}`}
            className="text-[11px] text-zinc-500 hover:text-zinc-900 inline-flex items-center gap-1"
            title="เปิดเต็มหน้า"
          >
            <ExternalLink className="size-3" />
            เต็มหน้า
          </Link>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span
            className={`inline-flex items-center gap-1 px-2 h-6 rounded text-[11px] font-bold border ${STATUS_COLORS[ticket.status as RepairTicketStatus]}`}
          >
            <span className={`size-1.5 rounded-full ${STATUS_DOT[ticket.status]}`} />
            {STATUS_LABELS[ticket.status as RepairTicketStatus]}
          </span>
          <span
            className={`inline-flex items-center px-2 h-6 rounded text-[11px] font-bold border ${URGENCY_COLORS[ticket.urgency as RepairUrgency]}`}
          >
            {ticket.urgency === "URGENT" && <Flame className="size-3 mr-1" />}
            {URGENCY_LABELS[ticket.urgency as RepairUrgency]}
          </span>
          {sla !== "done" && (
            <span
              className={`inline-flex items-center gap-1 px-2 h-6 rounded text-[11px] font-bold border ${slaBadgeColor(sla)}`}
            >
              <Clock className="size-3" />
              {slaBadgeLabel(sla, ticket.resolveDueAt)}
            </span>
          )}
        </div>
      </div>

      {/* Title + description */}
      <div>
        <h2 className="text-[20px] sm:text-[22px] font-extrabold tracking-tight text-zinc-900 leading-snug">
          {ticket.title}
        </h2>
        {ticket.description && (
          <p className="mt-2 text-[13.5px] text-zinc-700 leading-relaxed whitespace-pre-wrap">
            {ticket.description}
          </p>
        )}
        {ticket.customerImpact && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-[13px]">
            <p className="font-bold text-amber-900">⚠️ ผลกระทบลูกค้า</p>
            <p className="text-amber-800 mt-0.5">{ticket.customerImpact}</p>
          </div>
        )}
        {downtime > 0 && (
          <div
            className={`mt-3 rounded-lg border p-3 text-[13px] flex items-baseline justify-between gap-3 ${
              isOpen ? "bg-red-50 border-red-200" : "bg-zinc-50 border-zinc-200"
            }`}
          >
            <div>
              <p
                className={`font-bold text-[13px] ${
                  isOpen ? "text-red-700" : "text-zinc-600"
                }`}
              >
                {isOpen ? "🔥 ค่าเสียโอกาส (สดๆ)" : "💰 ค่าเสียโอกาสรวม"}
              </p>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                ประมาณจากชนิดสาขา · ทุก ชม. ที่ใบยังเปิด
              </p>
            </div>
            <p
              className={`font-extrabold text-[20px] tabular-nums ${
                isOpen ? "text-red-700" : "text-zinc-700"
              }`}
            >
              {formatBaht(downtime * 100)}
            </p>
          </div>
        )}
      </div>

      {/* Status pipeline visualization */}
      {ticket.status !== "CANCELLED" && (
        <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-3">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-zinc-500 mb-2">
            สถานะปัจจุบัน
          </div>
          <div className="flex items-center gap-1">
            {STATUS_PIPELINE.map((s, i) => {
              const isCurrent = i === pipelineIdx;
              const isPast = i < pipelineIdx;
              return (
                <div key={s} className="flex-1 flex items-center gap-1 min-w-0">
                  <div className="flex-1 min-w-0">
                    <div
                      className={`h-1.5 rounded-full ${
                        isPast || isCurrent ? "bg-blue-500" : "bg-zinc-200"
                      }`}
                    />
                    <p
                      className={`mt-1 text-[10px] font-semibold leading-tight truncate ${
                        isCurrent ? "text-blue-700" : isPast ? "text-zinc-700" : "text-zinc-400"
                      }`}
                    >
                      {STATUS_LABELS[s]}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Meta grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[13px]">
        {ticket.branch && (
          <Meta
            icon={<Building2 className="size-3.5 text-zinc-500" />}
            label="สาขา"
          >
            <span className="font-mono font-bold text-zinc-700">{ticket.branch.code}</span>{" "}
            {ticket.branch.name}
          </Meta>
        )}
        {ticket.category && (
          <Meta icon={<span>{ticket.category.emoji ?? "🛠"}</span>} label="หมวด">
            {ticket.category.label}
          </Meta>
        )}
        {ticket.assignedTech && (
          <Meta icon={<User className="size-3.5 text-zinc-500" />} label="ช่าง">
            {ticket.assignedTech.name}
            {ticket.assignedTech.kind === "VENDOR" && (
              <span className="ml-1 text-[10px] bg-violet-50 text-violet-700 px-1 py-px rounded font-bold">
                VENDOR
              </span>
            )}
          </Meta>
        )}
        <Meta icon={<User className="size-3.5 text-zinc-500" />} label="ผู้แจ้ง">
          {ticket.reporterName}
        </Meta>
        <Meta icon={<Phone className="size-3.5 text-zinc-500" />} label="เบอร์">
          <a
            href={`tel:${ticket.reporterPhone}`}
            className="hover:underline tabular-nums"
          >
            {ticket.reporterPhone}
          </a>
        </Meta>
        <Meta icon={<Clock className="size-3.5 text-zinc-500" />} label="เปิดเมื่อ">
          {fmtDateTime(ticket.createdAt)}
        </Meta>
      </div>

      {/* Quick contact bar */}
      <div className="flex flex-wrap gap-2">
        <a
          href={`tel:${ticket.reporterPhone}`}
          className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl bg-emerald-600 text-white font-bold text-[13px] hover:bg-emerald-700 active:bg-emerald-800"
        >
          <Phone className="size-4" />
          โทรหาผู้แจ้ง
        </a>
        <a
          href={`https://line.me/R/msg/text/?${encodeURIComponent(
            `เรียน ${ticket.reporterName}\nใบแจ้งซ่อม ${ticket.ticketCode}\nสถานะ: ${STATUS_LABELS[ticket.status as RepairTicketStatus]}`,
          )}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl bg-[#06C755] text-white font-bold text-[13px] hover:opacity-90"
        >
          <MessageSquare className="size-4" />
          ส่ง LINE
        </a>
        {ticket.branch && (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
              `${ticket.branch.code} ${ticket.branch.name} ${ticket.branch.province ?? ""}`,
            )}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl bg-blue-600 text-white font-bold text-[13px] hover:bg-blue-700"
          >
            <MapPin className="size-4" />
            แผนที่
          </a>
        )}
        {ticket.assignedTech?.phone && (
          <a
            href={`tel:${ticket.assignedTech.phone}`}
            className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl bg-zinc-900 text-white font-bold text-[13px] hover:bg-zinc-700"
          >
            <Phone className="size-4" />
            โทรหาช่าง
          </a>
        )}
      </div>

      {/* Other timeline dates */}
      {(ticket.etaAt || ticket.resolveDueAt || ticket.resolvedAt) && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[12.5px] bg-zinc-50 border border-zinc-200 rounded-xl p-3">
          {ticket.etaAt && (
            <Meta icon={<AlarmClock className="size-3.5 text-zinc-500" />} label="ETA">
              {fmtDateTime(ticket.etaAt)}
            </Meta>
          )}
          {ticket.resolveDueAt && (
            <Meta
              icon={<AlarmClock className="size-3.5 text-zinc-500" />}
              label="ต้องเสร็จก่อน"
            >
              {fmtDateTime(ticket.resolveDueAt)}
            </Meta>
          )}
          {ticket.resolvedAt && ticket.resolvedBy && (
            <Meta icon={<Clock className="size-3.5 text-zinc-500" />} label="เสร็จเมื่อ">
              {fmtDateTime(ticket.resolvedAt)} · โดย {ticket.resolvedBy.name}
            </Meta>
          )}
        </div>
      )}

      {/* Actions */}
      {canWrite && (
        <TicketActions
          ticketId={ticket.id}
          currentStatus={ticket.status}
          currentTechId={ticket.assignedTech?.id ?? null}
          currentEta={ticket.etaAt ? new Date(ticket.etaAt).toISOString() : null}
          technicians={technicians}
          canAdmin={canAdmin}
        />
      )}

      {/* Photos */}
      {ticket.photos && ticket.photos.length > 0 && (
        <section>
          <h3 className="font-bold text-zinc-900 mb-2 flex items-center gap-2 text-[13.5px]">
            <Camera className="size-3.5" />
            รูปภาพ ({ticket.photos.length})
          </h3>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
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
                  className="relative aspect-square rounded-lg overflow-hidden border border-zinc-200 bg-zinc-100"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.r2PublicUrl}
                    alt={p.caption ?? ""}
                    className="absolute inset-0 size-full object-cover"
                  />
                  <span className="absolute top-1 left-1 px-1.5 h-5 inline-flex items-center rounded text-[10px] font-bold bg-zinc-900/85 text-white">
                    {PHOTO_PHASE_LABELS[p.phase as "BEFORE"]}
                  </span>
                </a>
              ),
            )}
          </div>
        </section>
      )}

      {/* Parts */}
      {ticket.parts && ticket.parts.length > 0 && (
        <section>
          <h3 className="font-bold text-zinc-900 mb-2 flex items-center gap-2 text-[13.5px]">
            <PackageSearch className="size-3.5" />
            อะไหล่ ({ticket.parts.length})
          </h3>
          <div className="rounded-lg border border-zinc-200 overflow-hidden">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wide text-zinc-500 border-b border-zinc-100 bg-zinc-50">
                  <th className="px-3 py-2 font-bold">รายการ</th>
                  <th className="px-3 py-2 font-bold text-right">จำนวน</th>
                  <th className="px-3 py-2 font-bold text-right">ราคา/หน่วย</th>
                  <th className="px-3 py-2 font-bold text-right">รวม</th>
                  <th className="px-3 py-2 font-bold">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {ticket.parts.map(
                  (p: {
                    id: string;
                    name: string;
                    spec: string | null;
                    quantity: number;
                    unit: string;
                    unitPriceCents: number;
                    status:
                      | "NEEDED"
                      | "ORDERED"
                      | "DELIVERED"
                      | "INSTALLED"
                      | "CANCELLED";
                  }) => (
                    <tr key={p.id}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-zinc-900">{p.name}</p>
                        {p.spec && (
                          <p className="text-[11px] text-zinc-500 font-mono">{p.spec}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {p.quantity} {p.unit}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatBaht(p.unitPriceCents)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold">
                        {formatBaht(p.unitPriceCents * p.quantity)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-bold border ${PART_STATUS_COLORS[p.status]}`}
                        >
                          {PART_STATUS_LABELS[p.status]}
                        </span>
                      </td>
                    </tr>
                  ),
                )}
                {total > 0 && (
                  <tr className="bg-zinc-50">
                    <td
                      colSpan={3}
                      className="px-3 py-2 text-right text-[10.5px] uppercase font-bold tracking-wide text-zinc-500"
                    >
                      รวมค่าใช้จ่าย
                    </td>
                    <td
                      colSpan={2}
                      className="px-3 py-2 text-right font-extrabold text-zinc-900 tabular-nums"
                    >
                      {formatBaht(total)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Timeline */}
      <section>
        <h3 className="font-bold text-zinc-900 mb-2 flex items-center gap-2 text-[13.5px]">
          <MessageSquare className="size-3.5" />
          ไทม์ไลน์ ({ticket.events?.length ?? 0})
        </h3>
        <ol className="space-y-2 border-l-2 border-zinc-200 pl-4">
          {(ticket.events ?? []).map(
            (ev: {
              id: string;
              kind: string;
              actorName: string;
              payload: unknown;
              createdAt: Date | string;
            }) => (
              <li key={ev.id} className="relative -left-[22px] pl-5">
                <span className="absolute left-0 top-1.5 size-2.5 rounded-full bg-blue-500 border-2 border-white shadow" />
                <div className="bg-zinc-50 rounded-lg border border-zinc-200 p-2.5">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <p className="font-bold text-zinc-900 text-[13px]">
                      {EVENT_KIND_LABELS[ev.kind as "CREATED"]}
                    </p>
                    <p className="text-[11px] text-zinc-500 tabular-nums">
                      {fmtDateTime(ev.createdAt)}
                    </p>
                  </div>
                  <p className="text-[11px] text-zinc-600 mt-0.5">
                    โดย {ev.actorName}
                  </p>
                  {(() => {
                    const p = ev.payload as Record<string, unknown> | null;
                    const body =
                      (p?.body as string | undefined) ??
                      (p?.comment as string | undefined);
                    if (!body) return null;
                    return (
                      <p className="mt-1.5 text-[13px] text-zinc-800 whitespace-pre-wrap leading-relaxed">
                        {body}
                      </p>
                    );
                  })()}
                </div>
              </li>
            ),
          )}
        </ol>
      </section>
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
        <p className="text-[10.5px] font-bold uppercase tracking-wide text-zinc-500">
          {label}
        </p>
        <p className="text-zinc-900 font-medium text-[13px] truncate">{children}</p>
      </div>
    </div>
  );
}
