import { requireSession } from "@/lib/auth/session";
import { getMySignatureUrl } from "@/lib/docuflow/my-signature";
import { SignatureSettingsForm } from "./signature-form";

// Gate: `requireSession()` ONLY — NO admin-tier gate. This is a personal
// setting every signer needs (staff, not just DocuFlow admins), matching
// the rest of app/(admin)/profile/ (name/password, linked sessions).
export const dynamic = "force-dynamic";

export default async function MySignaturePage() {
  const session = await requireSession();
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
