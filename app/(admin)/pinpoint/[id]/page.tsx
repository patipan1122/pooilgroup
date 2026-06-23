// Pinpoint — session detail / review. Owner sees own; super_admin reviews + exports.

import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";
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

  const { id } = await params;
  const result = await getSessionWithPins(session.user.org_id, id);
  if (!result) notFound();

  // โหมดติชมเปิดให้พนักงานทุก role ส่งความเห็นได้ (ดู create route) → เจ้าของรอบ
  // ต้องเปิดดูรอบของตัวเองได้ไม่ว่าจะ role ไหน. ความปลอดภัย = org-scope (getSessionWithPins)
  // + เจ้าของ/super เท่านั้น. super_admin รีวิว/ส่งออกได้ (canReview); เจ้าของดูอย่างเดียว.
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
