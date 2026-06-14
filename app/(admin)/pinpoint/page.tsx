// Pinpoint — review list (super_admin). One row per session; drill into pins.

import Link from "next/link";
import { redirect } from "next/navigation";
import { MapPin, ChevronRight } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { pinpointV1 } from "@/lib/pinpoint/flags";
import { listSessions } from "@/lib/pinpoint/data";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  draft: { text: "กำลังทำ", cls: "bg-amber-100 text-amber-700" },
  submitted: { text: "รอรีวิว", cls: "bg-blue-100 text-blue-700" },
  reviewed: { text: "รีวิวแล้ว", cls: "bg-violet-100 text-violet-700" },
  exported: { text: "ส่งให้ Claude แล้ว", cls: "bg-emerald-100 text-emerald-700" },
  closed: { text: "ปิดแล้ว", cls: "bg-zinc-100 text-zinc-500" },
};

export default async function PinpointListPage() {
  if (!pinpointV1()) redirect("/dashboard");
  const session = await requireSession();
  if (!isSuperAdmin(session.user.role)) redirect("/dashboard");

  const sessions = await listSessions(session.user.org_id);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-5">
        <h1 className="flex items-center gap-2 text-xl font-extrabold font-display">
          <MapPin className="size-5 text-[var(--color-brand-600)]" />
          ติชม (Pinpoint)
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          รอบการติชมทั้งหมด — เปิดดูจุดที่ปักไว้ แล้วกด “คัดลอกให้ Claude” เพื่อส่งให้ผมแก้
        </p>
      </header>

      {sessions.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-zinc-200 px-4 py-12 text-center text-sm text-zinc-400">
          ยังไม่มีรอบติชม — กดปุ่ม AI มุมขวาล่าง → “เริ่มโหมดติชม” เพื่อเริ่ม
        </div>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => {
            const badge = STATUS_LABEL[s.status] ?? STATUS_LABEL.draft;
            return (
              <li key={s.id}>
                <Link
                  href={`/pinpoint/${s.id}`}
                  className="flex items-center gap-3 rounded-2xl border-2 border-zinc-100 bg-white px-4 py-3 transition-colors hover:border-[var(--color-brand-600)]"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-brand-50,#eff6ff)] text-sm font-extrabold text-[var(--color-brand-700)]">
                    {s.pin_count}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">
                      {s.title?.trim() || `รอบติชม ${s.id.slice(0, 8)}`}
                    </p>
                    <p className="truncate text-xs text-zinc-400">
                      {s.author?.name ?? "—"} ·{" "}
                      {new Date(s.created_at).toLocaleString("th-TH", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${badge.cls}`}
                  >
                    {badge.text}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-zinc-300" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
