// Internal helper to create in-app notifications.
// Used by approval flows, security events, register requests etc.
// Telegram delivery (sentTelegram) handled separately by bot module.

import { adminClient } from "../db/server";

export type NotificationType = "info" | "warning" | "danger" | "success";
export type NotificationModule = "core" | "cashhub" | "fuelos" | "docuflow";

export interface NotificationPayload {
  orgId: string;
  userId: string;
  type: NotificationType;
  module?: NotificationModule;
  title: string;
  body: string;
  link?: string;
}

export async function sendNotification(p: NotificationPayload) {
  const admin = adminClient();
  await admin.from("notifications").insert({
    id: crypto.randomUUID(),
    org_id: p.orgId,
    user_id: p.userId,
    type: p.type,
    module: p.module ?? "core",
    title: p.title,
    body: p.body,
    link: p.link ?? null,
  });
}

/** Bulk: send same notification to many users (e.g. all admins) */
export async function sendNotificationToMany(
  userIds: string[],
  p: Omit<NotificationPayload, "userId">,
) {
  if (userIds.length === 0) return;
  const admin = adminClient();
  await admin.from("notifications").insert(
    userIds.map((uid) => ({
      id: crypto.randomUUID(),
      org_id: p.orgId,
      user_id: uid,
      type: p.type,
      module: p.module ?? "core",
      title: p.title,
      body: p.body,
      link: p.link ?? null,
    })),
  );
}

/** Get all admin user IDs for an org (super_admin + org_admin). */
export async function getOrgAdminIds(orgId: string): Promise<string[]> {
  const admin = adminClient();
  const { data } = await admin
    .from("users")
    .select("id")
    .eq("org_id", orgId)
    .in("role", ["super_admin", "org_admin"])
    .eq("is_active", true);
  return (data ?? []).map((u) => u.id);
}
