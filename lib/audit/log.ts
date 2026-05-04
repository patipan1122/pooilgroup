// Audit log helper — call within transactions where possible (RULES §12)

import { adminClient } from "../db/server";
import { withDbDefaults } from "../db/insert";

export type AuditAction =
  | "LOGIN"
  | "LOGOUT"
  | "FAILED_LOGIN"
  | "CREATE_REPORT"
  | "APPROVE_REPORT"
  | "REJECT_REPORT"
  | "UNLOCK_REPORT"
  | "CREATE_USER"
  | "UPDATE_USER"
  | "DEACTIVATE_USER"
  | "CREATE_BRANCH"
  | "UPDATE_BRANCH"
  | "PERMISSION_DENIED"
  | "EXPORT_DATA";

export interface AuditEntry {
  orgId: string;
  userId: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId?: string;
  diff?: { old?: Record<string, unknown>; new?: Record<string, unknown> };
  ipAddress?: string;
  userAgent?: string;
}

export async function audit(entry: AuditEntry): Promise<void> {
  // Audit log uses admin client so it always succeeds even when RLS would block
  const admin = adminClient();
  // audit_logs has no updated_at; use lower-level insert to avoid the helper adding one
  await admin.from("audit_logs").insert({
    id: crypto.randomUUID(),
    org_id: entry.orgId,
    user_id: entry.userId,
    action: entry.action,
    resource_type: entry.resourceType,
    resource_id: entry.resourceId ?? null,
    diff: entry.diff ?? null,
    ip_address: entry.ipAddress ?? null,
    user_agent: entry.userAgent ?? null,
  });
}

void withDbDefaults; // keep import for future use
