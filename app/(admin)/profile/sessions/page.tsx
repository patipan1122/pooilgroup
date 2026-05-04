import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { SessionsList } from "./sessions-list";

export const dynamic = "force-dynamic";

export default async function MySessionsPage() {
  const session = await requireSession();
  const admin = adminClient();

  const { data: rows } = await admin
    .from("user_sessions")
    .select(
      "id, ip_address, user_agent, device, login_at, last_active_at, logout_at, is_revoked",
    )
    .eq("user_id", session.user.id)
    .order("login_at", { ascending: false })
    .limit(50);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="mb-6 animate-fade-up">
        <p className="text-xs uppercase tracking-widest text-[--color-brand-600] font-semibold">
          บัญชี · ความปลอดภัย
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight font-display mt-2">
          อุปกรณ์ <span className="accent">ที่เข้าใช้</span>
        </h1>
        <p className="text-zinc-600 mt-2 text-sm">
          ตรวจสอบอุปกรณ์ทั้งหมดที่ Login เข้าระบบ — กดออกจากระบบได้ทันทีถ้าเจอที่น่าสงสัย
        </p>
      </div>
      <SessionsList rows={rows ?? []} />
    </div>
  );
}
