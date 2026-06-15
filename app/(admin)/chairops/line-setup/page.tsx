// /chairops/line-setup — admin-only one-click tool to register the ChairOps
// LINE OA Rich Menu (the 4-button maid menu with the seal mascot). Runs the
// registration server-side via /api/chairops/richmenu/register so the LINE
// access token never leaves Vercel.
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/chairops/auth/session";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { RegisterRichMenuButton } from "./_register-button";

export const dynamic = "force-dynamic";

export default async function LineSetupPage() {
  // ตั้งค่า LINE (กุญแจ channel) = โครงสร้างหลังบ้าน → เฉพาะ Pool super_admin (CEO 2026-06-15)
  const session = await requireRole(ChairopsUserRole.ADMIN);
  if (!isSuperAdmin(session.poolUser.role)) redirect("/chairops?error=forbidden");
  const tokenSet = Boolean(process.env.CHAIROPS_LINE_CHANNEL_ACCESS_TOKEN);
  const liffSet = Boolean(process.env.NEXT_PUBLIC_LIFF_ID);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
          ตั้งค่าเมนู LINE (Rich Menu)
        </h1>
        <p className="text-sm text-zinc-500">
          ดันเมนู 4 ปุ่มของแม่บ้าน (เก็บเงิน · เช็คคลีน · แจ้งซ่อม · เบิกของ) ขึ้น LINE OA
        </p>
      </header>

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/mascot/banner/richmenu-line.jpg"
          alt="ตัวอย่างเมนู Rich Menu"
          className="w-full"
        />
      </div>

      <div className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm">
        <div className="flex items-center gap-2">
          <span>{tokenSet ? "✅" : "⚠️"}</span>
          <span className={tokenSet ? "text-zinc-700" : "font-medium text-amber-700"}>
            {tokenSet
              ? "พบกุญแจ LINE (Channel Access Token) แล้ว"
              : "ยังไม่พบกุญแจ — ใส่ CHAIROPS_LINE_CHANNEL_ACCESS_TOKEN ใน Vercel ก่อน"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span>{liffSet ? "✅" : "⚠️"}</span>
          <span className={liffSet ? "text-zinc-700" : "font-medium text-amber-700"}>
            {liffSet ? "พบ LIFF ID แล้ว" : "ยังไม่พบ NEXT_PUBLIC_LIFF_ID"}
          </span>
        </div>
      </div>

      <RegisterRichMenuButton disabled={!tokenSet || !liffSet} />

      <p className="text-xs leading-relaxed text-zinc-500">
        กดปุ่มแล้วระบบจะสร้างเมนูใหม่และตั้งเป็นเมนูหลักให้แม่บ้านทุกคนทันที · กดซ้ำได้ถ้าอยากอัปเดตรูป
        · ถ้าขึ้นว่ากุญแจว่าง ให้ไปใส่ค่าใน Vercel → Settings → Environment Variables แล้ว deploy
        ใหม่ก่อน
      </p>
    </div>
  );
}
