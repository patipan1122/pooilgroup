// /repairs/my-jobs — Tech's own jobs (only tickets assigned to them as INTERNAL tech)
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRepairAccess } from "@/lib/repair/role-guard";
import { findTechnicianForUser, listTechnicianJobs } from "@/lib/repair/queries";
import { STATUS_LABELS, STATUS_COLORS, URGENCY_LABELS, URGENCY_COLORS } from "@/lib/repair/types";
import { slaStatusFor, slaBadgeColor, slaBadgeLabel } from "@/lib/repair/sla";
import { HardHat, MapPin } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function MyJobsPage() {
  const session = await requireSession();
  requireRepairAccess(session.user.role);

  const tech = await findTechnicianForUser(session.user.org_id, session.user.id);

  if (!tech) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <h1 className="text-2xl font-extrabold text-zinc-900 mb-4">งานของฉัน</h1>
        <div className="rounded-2xl border-2 border-dashed border-zinc-300 bg-white p-8 text-center">
          <HardHat className="size-12 mx-auto text-zinc-300" />
          <p className="mt-4 font-bold text-zinc-900">ยังไม่ลงทะเบียนเป็นช่าง</p>
          <p className="mt-1 text-sm text-zinc-500">
            แจ้ง admin เพื่อให้เพิ่มชื่อคุณเข้าระบบเป็นช่างใน · จากนั้นกลับมาดูงานที่ถูกมอบหมายได้
          </p>
        </div>
      </div>
    );
  }

  const jobs = await listTechnicianJobs(session.user.org_id, tech.id);

  return (
    <div className="p-3 sm:p-6 max-w-3xl mx-auto">
      <header className="mb-5">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900">
          งานของฉัน
        </h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          ช่าง: {tech.name} · งานที่ถูกมอบหมาย ({jobs.length})
        </p>
      </header>

      {jobs.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-zinc-300 bg-white p-8 text-center text-zinc-500">
          ไม่มีงานที่ถูกมอบหมายอยู่ตอนนี้
        </div>
      ) : (
        <ul className="space-y-2.5">
          {jobs.map((t) => {
            const sla = slaStatusFor(t);
            return (
              <li key={t.id}>
                <Link
                  href={`/repairs/${t.id}`}
                  className="block bg-white rounded-xl border border-zinc-200 p-3 sm:p-4 hover:border-zinc-400 hover:shadow"
                >
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <p className="font-mono font-bold text-xs text-zinc-500">{t.ticketCode}</p>
                    <div className="flex gap-1.5">
                      <span className={`inline-flex items-center px-1.5 h-5 rounded text-[10px] font-bold border ${URGENCY_COLORS[t.urgency]}`}>
                        {URGENCY_LABELS[t.urgency]}
                      </span>
                      <span className={`inline-flex items-center px-1.5 h-5 rounded text-[10px] font-bold border ${STATUS_COLORS[t.status]}`}>
                        {STATUS_LABELS[t.status]}
                      </span>
                    </div>
                  </div>
                  <p className="mt-1.5 font-extrabold text-zinc-900 text-base sm:text-lg">
                    {t.category?.emoji && <span className="mr-1">{t.category.emoji}</span>}
                    {t.title}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                    {t.branch && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3" />
                        {t.branch.code} · {t.branch.name}
                      </span>
                    )}
                    {sla !== "done" && (
                      <span className={`px-1.5 h-5 inline-flex items-center rounded font-bold border ${slaBadgeColor(sla)}`}>
                        {slaBadgeLabel(sla, t.resolveDueAt)}
                      </span>
                    )}
                    <span>{t._count.photos} รูป · {t._count.parts} อะไหล่</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
