// PATCH /api/notifications/[id] — mark single notification read

import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";

export async function PATCH(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  const { id } = await ctx.params;
  const admin = adminClient();

  await admin
    .from("notifications")
    .update({ is_read: true })
    .eq("id", id)
    .eq("user_id", session.user.id);

  return NextResponse.json({ success: true });
}
