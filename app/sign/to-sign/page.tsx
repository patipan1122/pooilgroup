// /sign/to-sign — "เซ็นทีละหลายฉบับ" (bulk sign) list page
// ────────────────────────────────────────────────────────────────────
// CEO Pinpoint #7 scope expansion (2026-10-13): the real ask behind "เซ็น
// ผ่านลิงก์ LINE" turned out to be "เซ็นครั้งเดียว ใช้ซ้ำได้ทุกฉบับ" — a
// saved signature (already live, see lib/docuflow/my-signature.ts) plus a
// way to sign MANY documents in one sitting instead of opening each one
// individually via /sign/[placementId].
//
// Route placement: deliberately a SIBLING of /sign/[placementId]
// (app/sign/to-sign/, not app/(admin)/docuflow/to-sign/) so it inherits
// the exact same access level as the single-document signer flow —
// `getSession()` only, no DocuFlow module-access gate. This matters
// because an externally-invited signer (invite-document-signer-button.tsx)
// gets an account scoped to ONE document and does NOT necessarily have
// DocuFlow module access — if this page lived under app/(admin)/docuflow/
// it would inherit that layout's `userHasModuleAccess` gate and 403 that
// signer. Next.js resolves the static `/sign/to-sign` segment before the
// dynamic `/sign/[placementId]` one, so there's no routing collision.
//
// Lists every DISTINCT document where the caller has ≥1 unsigned
// `signature`-type placement (auto-fill date/name/text placements are
// excluded — same reasoning /sign/[placementId] already uses: nothing
// for a human to act on there, and the sign endpoint would 400 on them).
// ────────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getMySignatureUrl } from "@/lib/docuflow/my-signature";
import { getToSignDocuments } from "@/lib/docuflow/to-sign";
import { ToSignList } from "@/components/docuflow/to-sign-list";

export const dynamic = "force-dynamic";

export default async function ToSignPage() {
  const session = await getSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent("/sign/to-sign")}`);
  }
  const orgId = session.user.org_id;

  const [documents, savedSignatureUrl] = await Promise.all([
    getToSignDocuments(orgId, session.user.id),
    getMySignatureUrl(session.user.id).catch(() => null),
  ]);

  return (
    <div className="min-h-dvh bg-zinc-50">
      <div className="max-w-2xl mx-auto p-3 sm:p-6 pb-24">
        <ToSignList documents={documents} savedSignatureUrl={savedSignatureUrl} />
      </div>
    </div>
  );
}
