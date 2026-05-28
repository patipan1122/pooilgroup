// ChairOps LIFF entry · /liff/chairops?next=/chairops/m/<screen>
// Target of the LINE OA Rich Menu buttons. If the maid already has a session
// → server-redirect straight to the screen. Otherwise the /liff layout's
// LiffBootstrap auto-logs-in via the verified LINE id_token and lands them on
// `next`. (AUDIT D-CO-M7: binding lineUserId↔maid is admin-set on the Pool
// user; this page never writes identity.)
import { redirect } from "next/navigation";
import { getSession } from "@/lib/chairops/auth/session";

export const dynamic = "force-dynamic";

function safeNext(v: string | string[] | undefined): string {
  const p = Array.isArray(v) ? v[0] : v;
  if (!p || !p.startsWith("/") || p.startsWith("//")) return "/chairops/m";
  return p;
}

export default async function ChairopsLiffEntry({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const sp = await searchParams;
  const next = safeNext(sp.next);

  const session = await getSession();
  if (session && session.user.role === "MAID") {
    redirect(next);
  }

  // Not yet authenticated → LiffBootstrap (in the /liff layout) reads ?next
  // from the URL, logs the maid in, and redirects there. Show a calm state.
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="size-12 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
      <div className="space-y-1">
        <p className="text-base font-semibold text-zinc-800">
          กำลังเข้าสู่ระบบ ChairOps
        </p>
        <p className="text-sm text-zinc-500">
          ถ้าค้างนาน · บัญชีนี้อาจยังไม่ได้เปิดใช้ · ติดต่อออฟฟิศ
        </p>
      </div>
    </div>
  );
}
