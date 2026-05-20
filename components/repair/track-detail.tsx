// Server component — public-facing tracking detail. No interactivity needed.
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
import { Clock, MapPin, User, Phone, CheckCircle2, Camera } from "lucide-react";

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
  acknowledgedAt: Date | null;
  startedAt: Date | null;
  createdAt: Date;
  etaAt: Date | null;
  branch: { id: string; name: string; code: string; businessType: string } | null;
  company: { name: string; code: string } | null;
  category: { id: string; slug: string; label: string; emoji: string | null } | null;
  assignedTech: { id: string; name: string; kind: "INTERNAL" | "VENDOR"; phone: string | null } | null;
  photos: Photo[];
  events: Event[];
}

function fmtDateTime(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export function PublicTrackDetail({ ticket }: { ticket: Ticket }) {
  const sla = slaStatusFor(ticket);
  const total = totalTicketCost(ticket);

  return (
    <div className="space-y-5">
      {/* Header card */}
      <div className="rounded-3xl bg-white border-2 border-zinc-200 p-5 sm:p-6">
        <div className="flex flex-wrap items-start gap-3 justify-between">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">เลขที่ใบ</p>
            <p className="text-2xl sm:text-3xl font-black tracking-tight text-zinc-900 mt-0.5">
              {ticket.ticketCode}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className={`inline-flex items-center px-2.5 h-7 rounded-md text-xs font-bold border ${STATUS_COLORS[ticket.status]}`}>
              {STATUS_LABELS[ticket.status]}
            </span>
            <span className={`inline-flex items-center px-2.5 h-7 rounded-md text-xs font-bold border ${URGENCY_COLORS[ticket.urgency]}`}>
              {URGENCY_LABELS[ticket.urgency]}
            </span>
            {sla !== "done" && (
              <span className={`inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-xs font-bold border ${slaBadgeColor(sla)}`}>
                <Clock className="size-3" />
                {slaBadgeLabel(sla, ticket.resolveDueAt)}
              </span>
            )}
          </div>
        </div>

        <h1 className="mt-3 text-xl sm:text-2xl font-extrabold text-zinc-900">{ticket.title}</h1>
        {ticket.description && (
          <p className="mt-2 text-sm text-zinc-700 whitespace-pre-wrap">{ticket.description}</p>
        )}

        <div className="mt-4 grid sm:grid-cols-2 gap-3 text-sm">
          {ticket.branch && (
            <Row icon={<MapPin className="size-4 text-zinc-500" />} label="สาขา">
              {ticket.company ? `${ticket.company.name} · ` : ""}
              {ticket.branch.code} · {ticket.branch.name}
            </Row>
          )}
          {ticket.category && (
            <Row icon={<span className="text-base">{ticket.category.emoji ?? "🛠"}</span>} label="หมวด">
              {ticket.category.label}
            </Row>
          )}
          <Row icon={<User className="size-4 text-zinc-500" />} label="ผู้แจ้ง">
            {ticket.reporterName}
          </Row>
          <Row icon={<Phone className="size-4 text-zinc-500" />} label="เบอร์">
            {ticket.reporterPhone}
          </Row>
          {ticket.etaAt && (
            <Row icon={<Clock className="size-4 text-zinc-500" />} label="ETA">
              {fmtDateTime(ticket.etaAt)}
            </Row>
          )}
          {ticket.resolveDueAt && (
            <Row icon={<Clock className="size-4 text-zinc-500" />} label="ต้องเสร็จก่อน">
              {fmtDateTime(ticket.resolveDueAt)}
            </Row>
          )}
        </div>

        {ticket.assignedTech && (
          <div className="mt-4 rounded-2xl bg-zinc-50 border border-zinc-200 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">ช่างที่ดูแล</p>
            <div className="mt-1 flex items-center justify-between">
              <div>
                <p className="font-bold text-zinc-900">{ticket.assignedTech.name}</p>
                <p className="text-xs text-zinc-500">
                  {ticket.assignedTech.kind === "INTERNAL" ? "ช่างใน" : "ช่างนอก"}
                </p>
              </div>
              {ticket.assignedTech.phone && (
                <a
                  href={`tel:${ticket.assignedTech.phone}`}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-white border border-zinc-200 text-zinc-900 font-bold text-sm hover:bg-zinc-100"
                >
                  <Phone className="size-3.5" />
                  {ticket.assignedTech.phone}
                </a>
              )}
            </div>
          </div>
        )}

        {total > 0 && (
          <div className="mt-4 rounded-2xl bg-zinc-50 border border-zinc-200 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">ค่าใช้จ่ายโดยรวม</p>
            <p className="text-xl font-extrabold text-zinc-900 mt-0.5">{formatBaht(total)}</p>
          </div>
        )}
      </div>

      {/* Photos */}
      {ticket.photos.length > 0 && (
        <section>
          <h2 className="text-lg font-extrabold text-zinc-900 mb-3 flex items-center gap-2">
            <Camera className="size-5" />
            รูปภาพ ({ticket.photos.length})
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {ticket.photos.map((p) => (
              <a
                key={p.id}
                href={p.r2PublicUrl}
                target="_blank"
                rel="noreferrer"
                className="relative aspect-square rounded-xl overflow-hidden border-2 border-zinc-200 bg-zinc-100 group"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.r2PublicUrl} alt={p.caption ?? ""} className="absolute inset-0 size-full object-cover group-hover:scale-105 transition-transform" />
                <span className="absolute top-1.5 left-1.5 px-1.5 h-5 inline-flex items-center rounded text-[10px] font-bold bg-zinc-900/80 text-white">
                  {PHOTO_PHASE_LABELS[p.phase]}
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Timeline */}
      <section>
        <h2 className="text-lg font-extrabold text-zinc-900 mb-3 flex items-center gap-2">
          <CheckCircle2 className="size-5" />
          ไทม์ไลน์ ({ticket.events.length})
        </h2>
        <ol className="space-y-2.5 border-l-2 border-zinc-200 pl-4">
          {ticket.events.map((ev) => (
            <li key={ev.id} className="relative -left-[22px] pl-5">
              <span className="absolute left-0 top-1 size-3 rounded-full bg-[var(--color-brand-500)] border-2 border-white shadow" />
              <div className="bg-white rounded-xl border border-zinc-200 p-3 shadow-sm">
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <p className="font-bold text-zinc-900 text-sm">
                    {EVENT_KIND_LABELS[ev.kind]}
                  </p>
                  <p className="text-xs text-zinc-500">{fmtDateTime(ev.createdAt)}</p>
                </div>
                <p className="text-xs text-zinc-600 mt-0.5">โดย {ev.actorName}</p>
                {(() => {
                  const p = ev.payload as Record<string, unknown> | null;
                  const body = p?.body as string | undefined;
                  const comment = p?.comment as string | undefined;
                  const text = body || comment;
                  if (!text) return null;
                  return (
                    <p className="mt-2 text-sm text-zinc-800 whitespace-pre-wrap">
                      {text}
                    </p>
                  );
                })()}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="text-center pt-4">
        <Link
          href="/r/new"
          className="inline-flex items-center gap-2 h-11 px-5 rounded-xl border-2 border-zinc-200 bg-white text-zinc-700 font-bold hover:bg-zinc-50"
        >
          แจ้งใบใหม่อีก
        </Link>
      </div>
    </div>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5 size-5 grid place-items-center flex-shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">{label}</p>
        <p className="text-zinc-900 font-medium">{children}</p>
      </div>
    </div>
  );
}
