// Pinpoint — session detail / review. Owner sees own; super_admin reviews + exports.

import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier, isSuperAdmin } from "@/lib/auth/role-guards";
import { pinpointV1 } from "@/lib/pinpoint/flags";
import { getSessionWithPins } from "@/lib/pinpoint/data";
import { SessionReview } from "./_components/SessionReview";

export const dynamic = "force-dynamic";

export default async function PinpointDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!pinpointV1()) redirect("/dashboard");
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) redirect("/dashboard");

  const { id } = await params;
  const result = await getSessionWithPins(session.user.org_id, id);
  if (!result) notFound();

  const sa = isSuperAdmin(session.user.role);
  const isOwner = result.session.author_id === session.user.id;
  if (!sa && !isOwner) redirect("/dashboard");

  return (
    <SessionReview
      session={result.session}
      pins={result.pins}
      canReview={sa}
      r2PublicUrl={process.env.R2_PUBLIC_URL ?? ""}
    />
  );
}
