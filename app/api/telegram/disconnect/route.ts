// POST /api/telegram/disconnect — unlink the CALLING user's own Telegram
// account (clears users.telegram_user_id/telegram_chat_id). Personal action,
// same gating posture as /api/telegram/connect — any signed-in user may
// disconnect their own account; no module-admin check needed since it can
// never touch anyone else's row.

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await requireSession();
  const admin = adminClient();

  const { error } = await admin
    .from("users")
    .update({
      telegram_user_id: null,
      telegram_chat_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "DOCUFLOW_TELEGRAM_DISCONNECTED",
    resourceType: "user",
    resourceId: session.user.id,
    diff: { old: { telegramUserId: session.user.telegram_user_id } },
  });

  return NextResponse.json({ success: true });
}
