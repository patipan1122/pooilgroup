// GET /api/notifications  : list current user's notifications (latest 20)
// PATCH /api/notifications : mark all as read (body: {})

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  const admin = adminClient();

  const { data, error } = await admin
    .from("notifications")
    .select("id, type, module, title, body, link, is_read, created_at")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const unread = (data ?? []).filter((n) => !n.is_read).length;
  return NextResponse.json({ notifications: data ?? [], unread });
}

export async function PATCH() {
  const session = await requireSession();
  const admin = adminClient();

  await admin
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", session.user.id)
    .eq("is_read", false);

  return NextResponse.json({ success: true });
}
