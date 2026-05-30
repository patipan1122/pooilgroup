// Backup path when the FB OAuth dialog is blocked (shared subdomain etc).
// CEO uses Graph API Explorer to call /me/accounts, copies the JSON, and
// pastes it here.  We parse, render the same picker UI, then import.

import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { Section } from "@/components/ui/section";
import { INBOX_BUSINESSES } from "@/lib/inbox/business";
import { PasteImportForm } from "./_components/paste-form";

export const dynamic = "force-dynamic";

export default async function FacebookPastePage() {
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) redirect("/403");

  return (
    <div className="mx-auto max-w-[1100px] p-5 sm:p-8">
      <Section
        number="IS.2"
        label="เชื่อม Facebook (Paste JSON)"
        title="วาง JSON จาก Graph API Explorer"
        description="ทาง bypass OAuth dialog · ใช้เมื่อ FB block redirect ของ shared domain (*.vercel.app) · 3 ขั้น: เปิด Graph API Explorer → generate access token → call /me/accounts → copy JSON มาวางที่นี่"
      >
        <PasteImportForm businesses={INBOX_BUSINESSES} />
        <div className="mt-4 flex items-center gap-3 text-xs text-zinc-500">
          <Link
            href="/inbox/settings/channels"
            className="text-[var(--color-brand-700)] hover:underline"
          >
            ← กลับไปหน้าช่องทาง
          </Link>
          <span>•</span>
          <Link
            href="https://developers.facebook.com/tools/explorer"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--color-brand-700)] hover:underline"
          >
            เปิด Graph API Explorer →
          </Link>
        </div>
      </Section>
    </div>
  );
}
