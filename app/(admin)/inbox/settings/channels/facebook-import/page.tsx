// Renders the list of pages the CEO just connected via OAuth, with a
// checkbox per page + business-tag dropdown.  CEO submits and we bulk
// create channels.

import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { Section } from "@/components/ui/section";
import { readOauthCookie } from "@/lib/inbox/facebook-import";
import { INBOX_BUSINESSES } from "@/lib/inbox/business";
import { FacebookImportForm } from "./_components/import-form";

export const dynamic = "force-dynamic";

export default async function FacebookImportPage() {
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) redirect("/403");

  const cookie = await readOauthCookie();
  if (!cookie || cookie.pages.length === 0) {
    redirect("/inbox/settings/channels?fb_error=session+oauth+หมดอายุ+กดเชื่อมใหม่");
  }

  return (
    <div className="mx-auto max-w-[1100px] p-5 sm:p-8">
      <Section
        number="IS.1"
        label="เชื่อม Facebook Pages"
        title="เลือกเพจที่จะนำเข้า"
        description={`พบ ${cookie.pages.length} เพจที่คุณจัดการได้ · ติ๊กเฉพาะที่อยากให้ลูกค้าทักเข้ามาที่ /inbox · จัดกลุ่ม "ธุรกิจ" ให้แต่ละเพจเพื่อใช้กรองในกล่องข้อความ`}
      >
        <FacebookImportForm
          pages={cookie.pages}
          businesses={INBOX_BUSINESSES}
        />
        <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
          <Link
            href="/inbox/settings/channels"
            className="text-[var(--color-brand-700)] hover:underline"
          >
            ← กลับไปหน้าช่องทาง
          </Link>
          <span>session 15 นาที · ถ้าทำไม่ทันให้กด "เชื่อม Facebook" อีกครั้ง</span>
        </div>
      </Section>
    </div>
  );
}
