// /repairs/my-jobs — Tech persona: only tickets assigned to the logged-in tech.
// Mobile-first card list; mirrors Pooil App mobile "งานของฉัน" screen.
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRepairAccess } from "@/lib/repair/role-guard";
import {
  findTechnicianForUser,
  listTechnicianJobs,
} from "@/lib/repair/queries";
import {
  STATUS_LABELS,
  URGENCY_LABELS,
  OPEN_STATUSES,
  formatBaht,
  totalTicketCost,
} from "@/lib/repair/types";
import { slaStatusFor, slaBadgeColor, slaBadgeLabel } from "@/lib/repair/sla";
import {
  HardHat,
  MapPin,
  Camera,
  PackageSearch,
  Flame,
  CheckCircle2,
  ChevronRight,
  Plus,
} from "lucide-react";
import { RepairSubHeader } from "@/components/repair/sub-header";

export const dynamic = "force-dynamic";

const STATUS_DOT: Record<string, string> = {
  NEW: "bg-blue-500",
  ACK: "bg-violet-500",
  IN_PROGRESS: "bg-amber-500",
  WAITING_PARTS: "bg-cyan-500",
  RESOLVED: "bg-emerald-500",
  CLOSED: "bg-zinc-400",
  CANCELLED: "bg-zinc-300",
};

export default async function MyJobsPage() {
  const session = await requireSession();
  requireRepairAccess(session.user.role);
  const tech = await findTechnicianForUser(session.user.org_id, session.user.id);

  if (!tech) {
    return (
      <>
        <RepairSubHeader
          icon={HardHat}
          eyebrow="Persona · Technician"
          title="งานของฉัน"
          subtitle="ช่างเห็นงานที่ตัวเองได้รับมอบหมาย"
        />
        <div className="p-3 sm:p-5 lg:p-6 max-w-3xl mx-auto">
          <div className="bg-white border border-dashed border-zinc-300 rounded-2xl p-10 text-center">
            <HardHat className="size-12 mx-auto text-zinc-300" />
            <p className="mt-4 font-bold text-zinc-900">ยังไม่ลงทะเบียนเป็นช่าง</p>
            <p className="mt-1 text-sm text-zinc-500 max-w-md mx-auto">
              บัญชีของคุณ ({session.user.name}) ยังไม่ผูกกับโปรไฟล์ช่าง · แจ้ง admin
              ให้เพิ่มชื่อคุณเข้าระบบเป็นช่างใน · จากนั้นกลับมาดูงานที่ถูกมอบหมายได้
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Link
                href="/repairs"
                className="inline-flex items-center h-10 px-4 rounded-lg border border-zinc-200 bg-white text-zinc-700 font-semibold text-[13px] hover:bg-zinc-50"
              >
                ไปภาพรวม Command
              </Link>
              <Link
                href="/repairs/technicians"
                className="inline-flex items-center h-10 px-4 rounded-lg bg-blue-600 text-white font-semibold text-[13px] hover:bg-blue-700"
              >
                เปิดหน้า Technicians
              </Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  const jobs = await listTechnicianJobs(session.user.org_id, tech.id);

  const open = jobs.filter((j) => OPEN_STATUSES.includes(j.status));
  const urgent = open.filter((j) => j.urgency === "URGENT");
  const parts = jobs.filter((j) => j._count.parts > 0).length;

  return (
    <>
      <RepairSubHeader
        icon={HardHat}
        eyebrow="Persona · Technician"
        title={`สวัสดี ${tech.name.split(" ")[0]} · งานของฉัน`}
        subtitle={`${tech.kind === "INTERNAL" ? "ช่างใน" : "Vendor"} · งานที่ถูกมอบหมาย · ${jobs.length} ใบ`}
        stats={[
          { label: "เปิดอยู่", value: open.length },
          { label: "ด่วน", value: urgent.length, tone: urgent.length > 0 ? "danger" : "default" },
          { label: "รออะไหล่", value: parts },
        ]}
        actions={
          <Link
            href="/repairs/new"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-blue-600 text-white font-semibold text-[12px] hover:bg-blue-700"
          >
            <Plus className="size-3.5" />
            แจ้งซ่อมใหม่
          </Link>
        }
      />

      <div className="p-3 sm:p-5 lg:p-6 max-w-3xl mx-auto">
        {jobs.length === 0 ? (
          <div className="bg-white border border-dashed border-zinc-300 rounded-2xl p-10 text-center">
            <CheckCircle2 className="size-10 mx-auto text-emerald-500" />
            <p className="mt-3 font-bold text-zinc-900">ยังไม่มีงานที่ถูกมอบหมาย</p>
            <p className="mt-1 text-sm text-zinc-500">
              เมื่อแอดมินมอบใบให้คุณ จะเข้ามาที่นี่ทันที
            </p>
            <Link
              href="/repairs/triage"
              className="mt-4 inline-flex items-center h-10 px-4 rounded-lg border border-zinc-200 bg-white text-zinc-700 font-semibold text-[13px] hover:bg-zinc-50"
            >
              ดูใบทั้งหมด
            </Link>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {jobs.map((t) => {
              const sla = slaStatusFor(t);
              const isUrgent = t.urgency === "URGENT";
              const cost = totalTicketCost(t);
              return (
                <li key={t.id}>
                  <Link
                    href={`/repairs/${t.id}`}
                    className={`block bg-white rounded-xl border border-zinc-200 p-4 hover:border-zinc-300 hover:shadow-sm transition-all ${
                      isUrgent ? "border-l-[3px] border-l-red-500 pl-3.5" : ""
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2 flex-wrap">
                      <p className="font-mono font-bold text-[11px] text-zinc-500">
                        {t.ticketCode}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {isUrgent && (
                          <span className="inline-flex items-center gap-1 text-[10.5px] font-bold px-1.5 py-0.5 rounded border bg-red-50 text-red-700 border-red-200">
                            <Flame className="size-2.5" />
                            {URGENCY_LABELS.URGENT}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 text-[10.5px] font-bold px-1.5 py-0.5 rounded border bg-white text-zinc-700 border-zinc-200">
                          <span className={`size-1.5 rounded-full ${STATUS_DOT[t.status]}`} />
                          {STATUS_LABELS[t.status]}
                        </span>
                      </div>
                    </div>
                    <p className="mt-1.5 font-bold text-zinc-900 text-[15.5px] leading-snug">
                      {t.category?.emoji && <span className="mr-1">{t.category.emoji}</span>}
                      {t.title}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-zinc-500">
                      {t.branch && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" />
                          <span className="font-mono font-bold text-zinc-700">
                            {t.branch.code}
                          </span>{" "}
                          {t.branch.name}
                        </span>
                      )}
                      {t._count.photos > 0 && (
                        <span className="inline-flex items-center gap-0.5 tabular-nums">
                          <Camera className="size-3" />
                          {t._count.photos}
                        </span>
                      )}
                      {t._count.parts > 0 && (
                        <span className="inline-flex items-center gap-0.5 tabular-nums">
                          <PackageSearch className="size-3" />
                          {t._count.parts}
                        </span>
                      )}
                      {cost > 0 && (
                        <span className="tabular-nums">{formatBaht(cost)}</span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2 pt-2 border-t border-dashed border-zinc-100">
                      {sla !== "done" ? (
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-bold border ${slaBadgeColor(sla)}`}
                        >
                          {slaBadgeLabel(sla, t.resolveDueAt)}
                        </span>
                      ) : (
                        <span className="text-[10.5px] text-emerald-600 font-bold">
                          เสร็จแล้ว
                        </span>
                      )}
                      <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700">
                        เปิดใบ <ChevronRight className="size-3" />
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
