import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getMySignatureUrl } from "@/lib/docuflow/my-signature";
import { SignatureSettingsForm } from "./signature-form";

// Gate: session presence ONLY — NO admin-tier gate. This is a personal
// setting every signer needs (staff, not just DocuFlow admins), matching
// the rest of app/(admin)/profile/ (name/password, linked sessions).
//
// Auth-redirect: uses `getSession()` + a manual `redirect` with `?next=`
// (same pattern app/sign/[placementId]/page.tsx already uses) instead of
// `requireSession()`, which redirects to a bare `/login` with no way
// back. This page is often reached via a self-registration link an admin
// pastes into a LINE chat (see UserSignatureAdminPanel's copy-link
// button) — a logged-out recipient must round-trip back here after
// logging in, not land on the generic dashboard.
export const dynamic = "force-dynamic";

export default async function MySignaturePage() {
  const session = await getSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent("/profile/signature")}`);
  }
  const currentSignatureUrl = await getMySignatureUrl(session.user.id);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto">
      <div className="mb-6 animate-fade-up">
        <p className="text-xs uppercase tracking-widest text-[var(--color-brand-600)] font-semibold">
          บัญชี
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight font-display mt-2">
          ลายเซ็น <span className="accent">ของฉัน</span>
        </h1>
        <p className="text-zinc-600 mt-2 text-sm">
          บันทึกลายเซ็นไว้ครั้งเดียว ใช้เซ็นเอกสารได้ทุกครั้งโดยไม่ต้องวาดใหม่
        </p>
      </div>
      <SignatureSettingsForm currentSignatureUrl={currentSignatureUrl} />
    </div>
  );
}
