// Server component renderer for a single ticket — shared between
// /repairs (inbox right pane) and /repairs/[id] (standalone page).
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
import { Clock, MapPin, User, Phone, Camera, MessageSquare, PackageSearch, ExternalLink } from "lucide-react";
import type { RepairTicketStatus, RepairUrgency } from "@/lib/generated/prisma/enums";

interface Technician { id: string; name: string; kind: "INTERNAL" | "VENDOR"; isActive: boolean }

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

export function TicketDetailPanel({ ticket, technicians, canWrite, canAdmin }: Props) {
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

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Top bar */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <p className="font-mono font-extrabold text-lg text-zinc-900">{ticket.ticketCode}</p>
          <Link
            href={`/repairs/${ticket.id}`}
            className="text-xs text-zinc-500 hover:text-zinc-900 inline-flex items-center gap-1"
            title="เปิดเต็มหน้า"
          >
            <ExternalLink className="size-3" />
            เต็มหน้า
          </Link>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className={`inline-flex items-center px-2.5 h-7 rounded-md text-xs font-bold border ${STATUS_COLORS[ticket.status as RepairTicketStatus]}`}>
            {STATUS_LABELS[ticket.status as RepairTicketStatus]}
          </span>
          <span className={`inline-flex items-center px-2.5 h-7 rounded-md text-xs font-bold border ${URGENCY_COLORS[ticket.urgency as RepairUrgency]}`}>
            {URGENCY_LABELS[ticket.urgency as RepairUrgency]}
          </span>
          {sla !== "done" && (
            <span className={`inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-xs font-bold border ${slaBadgeColor(sla)}`}>
              <Clock className="size-3" />
              {slaBadgeLabel(sla, ticket.resolveDueAt)}
            </span>
          )}
        </div>
      </div>

      {/* Title + description */}
      <div>
        <h2 className="text-xl font-extrabold text-zinc-900">{ticket.title}</h2>
        {ticket.description && (
          <p className="mt-2 text-sm text-zinc-700 whitespace-pre-wrap">{ticket.description}</p>
        )}
        {ticket.customerImpact && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm">
            <p className="font-bold text-amber-900">⚠️ ผลกระทบลูกค้า</p>
            <p className="text-amber-800 mt-0.5">{ticket.customerImpact}</p>
          </div>
        )}
        {downtime > 0 && (
          <div className={`mt-3 rounded-lg border p-3 text-sm flex items-baseline justify-between gap-3 ${
            isOpen ? "bg-red-50 border-red-200" : "bg-zinc-50 border-zinc-200"
          }`}>
            <div>
              <p className={`font-bold text-sm ${isOpen ? "text-red-700" : "text-zinc-600"}`}>
                {isOpen ? "🔥 ค่าเสียโอกาส (สดๆ)" : "💰 ค่าเสียโอกาสรวม"}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">
                ประมาณการจากชนิดสาขา · ทุก ชม. ที่ใบยังเปิดอยู่
              </p>
            </div>
            <p className={`font-extrabold text-xl tabular-num ${isOpen ? "text-red-700" : "text-zinc-700"}`}>
              {formatBaht(downtime * 100)}
            </p>
          </div>
        )}
      </div>

      {/* Meta */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
        {ticket.branch && (
          <Meta icon={<MapPin className="size-4 text-zinc-500" />} label="สาขา">
            {ticket.branch.code} · {ticket.branch.name}
          </Meta>
        )}
        {ticket.category && (
          <Meta icon={<span>{ticket.category.emoji ?? "🛠"}</span>} label="หมวด">
            {ticket.category.label}
          </Meta>
        )}
        <Meta icon={<User className="size-4 text-zinc-500" />} label="ผู้แจ้ง">
          {ticket.reporterName}
        </Meta>
        <Meta icon={<Phone className="size-4 text-zinc-500" />} label="เบอร์">
          <a href={`tel:${ticket.reporterPhone}`} className="hover:underline">
            {ticket.reporterPhone}
          </a>
        </Meta>
      </div>

      {/* Quick contact bar — call / LINE / map (mobile-first) */}
      <div className="flex flex-wrap gap-2">
        <a
          href={`tel:${ticket.reporterPhone}`}
          className="inline-flex items-center gap-1.5 h-11 px-3.5 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 active:bg-emerald-800"
        >
          <Phone className="size-4" />
          โทรหาผู้แจ้ง
        </a>
        <a
          href={`https://line.me/R/msg/text/?${encodeURIComponent(
            `เรียน ${ticket.reporterName}\nใบแจ้งซ่อม ${ticket.ticketCode}\nสถานะ: ${ticket.status}`,
          )}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 h-11 px-3.5 rounded-xl bg-[#06C755] text-white font-bold text-sm hover:opacity-90"
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
            className="inline-flex items-center gap-1.5 h-11 px-3.5 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700"
          >
            <MapPin className="size-4" />
            แผนที่
          </a>
        )}
        {ticket.assignedTech?.phone && (
          <a
            href={`tel:${ticket.assignedTech.phone}`}
            className="inline-flex items-center gap-1.5 h-11 px-3.5 rounded-xl bg-zinc-900 text-white font-bold text-sm hover:bg-zinc-700"
          >
            <Phone className="size-4" />
            โทรหาช่าง
          </a>
        )}
      </div>

      {/* Timeline meta */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
        <Meta icon={<Clock className="size-4 text-zinc-500" />} label="เปิดเมื่อ">
          {fmtDateTime(ticket.createdAt)}
        </Meta>
        {ticket.etaAt && (
          <Meta icon={<Clock className="size-4 text-zinc-500" />} label="ETA">
            {fmtDateTime(ticket.etaAt)}
          </Meta>
        )}
        {ticket.resolveDueAt && (
          <Meta icon={<Clock className="size-4 text-zinc-500" />} label="ต้องเสร็จก่อน">
            {fmtDateTime(ticket.resolveDueAt)}
          </Meta>
        )}
        {ticket.resolvedAt && ticket.resolvedBy && (
          <Meta icon={<Clock className="size-4 text-zinc-500" />} label="เสร็จเมื่อ">
            {fmtDateTime(ticket.resolvedAt)} · โดย {ticket.resolvedBy.name}
          </Meta>
        )}
      </div>

      {/* Actions (status / assign / ETA / comment / part / photo) */}
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
          <h3 className="font-extrabold text-zinc-900 mb-2 flex items-center gap-2">
            <Camera className="size-4" />
            รูปภาพ ({ticket.photos.length})
          </h3>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {ticket.photos.map((p: { id: string; phase: string; r2PublicUrl: string; caption: string | null }) => (
              <a
                key={p.id}
                href={p.r2PublicUrl}
                target="_blank"
                rel="noreferrer"
                className="relative aspect-square rounded-lg overflow-hidden border border-zinc-200 bg-zinc-100"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.r2PublicUrl} alt={p.caption ?? ""} className="absolute inset-0 size-full object-cover" />
                <span className="absolute top-1 left-1 px-1.5 h-5 inline-flex items-center rounded text-xs font-bold bg-zinc-900/85 text-white">
                  {PHOTO_PHASE_LABELS[p.phase as "BEFORE"]}
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Parts */}
      {ticket.parts && ticket.parts.length > 0 && (
        <section>
          <h3 className="font-extrabold text-zinc-900 mb-2 flex items-center gap-2">
            <PackageSearch className="size-4" />
            อะไหล่ ({ticket.parts.length})
          </h3>
          <div className="rounded-lg border border-zinc-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50">
                <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th className="px-3 py-2 font-bold">รายการ</th>
                  <th className="px-3 py-2 font-bold text-right">จำนวน</th>
                  <th className="px-3 py-2 font-bold text-right">ราคา/หน่วย</th>
                  <th className="px-3 py-2 font-bold text-right">รวม</th>
                  <th className="px-3 py-2 font-bold">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {ticket.parts.map((p: { id: string; name: string; spec: string | null; quantity: number; unit: string; unitPriceCents: number; status: "NEEDED" | "ORDERED" | "DELIVERED" | "INSTALLED" | "CANCELLED" }) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-zinc-900">{p.name}</p>
                      {p.spec && <p className="text-xs text-zinc-500">{p.spec}</p>}
                    </td>
                    <td className="px-3 py-2 text-right">{p.quantity} {p.unit}</td>
                    <td className="px-3 py-2 text-right">{formatBaht(p.unitPriceCents)}</td>
                    <td className="px-3 py-2 text-right font-bold">{formatBaht(p.unitPriceCents * p.quantity)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center px-2 h-6 rounded text-xs font-bold border ${PART_STATUS_COLORS[p.status]}`}>
                        {PART_STATUS_LABELS[p.status]}
                      </span>
                    </td>
                  </tr>
                ))}
                {total > 0 && (
                  <tr className="bg-zinc-50">
                    <td colSpan={3} className="px-3 py-2 text-right text-xs uppercase font-bold tracking-wide text-zinc-500">
                      รวมค่าใช้จ่าย
                    </td>
                    <td colSpan={2} className="px-3 py-2 text-right font-extrabold text-zinc-900">
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
        <h3 className="font-extrabold text-zinc-900 mb-2 flex items-center gap-2">
          <MessageSquare className="size-4" />
          ไทม์ไลน์ ({ticket.events?.length ?? 0})
        </h3>
        <ol className="space-y-2 border-l-2 border-zinc-200 pl-4">
          {(ticket.events ?? []).map((ev: { id: string; kind: string; actorName: string; payload: unknown; createdAt: Date | string }) => (
            <li key={ev.id} className="relative -left-[22px] pl-5">
              <span className="absolute left-0 top-1.5 size-2.5 rounded-full bg-[var(--color-brand-500)] border-2 border-white shadow" />
              <div className="bg-zinc-50 rounded-lg border border-zinc-200 p-2.5">
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <p className="font-bold text-zinc-900 text-sm">
                    {EVENT_KIND_LABELS[ev.kind as "CREATED"]}
                  </p>
                  <p className="text-xs text-zinc-500">{fmtDateTime(ev.createdAt)}</p>
                </div>
                <p className="text-xs text-zinc-600 mt-0.5">โดย {ev.actorName}</p>
                {(() => {
                  const p = ev.payload as Record<string, unknown> | null;
                  const body = (p?.body as string | undefined) ?? (p?.comment as string | undefined);
                  if (!body) return null;
                  return (
                    <p className="mt-1.5 text-sm text-zinc-800 whitespace-pre-wrap">{body}</p>
                  );
                })()}
              </div>
            </li>
          ))}
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
      <div className="mt-0.5 size-5 grid place-items-center flex-shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs font-bold text-zinc-500">{label}</p>
        <p className="text-zinc-900 font-medium text-sm">{children}</p>
      </div>
    </div>
  );
}
