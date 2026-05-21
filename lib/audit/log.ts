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
  | "UPDATE_USER_MODULES"
  | "DEACTIVATE_USER"
  | "INVITE_ACCEPTED"
  | "CREATE_BRANCH"
  | "UPDATE_BRANCH"
  | "PERMISSION_DENIED"
  | "EXPORT_DATA"
  | "APPROVE_USER_REQUEST"
  | "REJECT_USER_REQUEST"
  | "APPROVE_REGISTER_REQUEST"
  | "REJECT_REGISTER_REQUEST"
  | "IMPERSONATE_START"
  | "IMPERSONATE_END"
  | "ASSIGN_FORM_TEMPLATE"
  | "DOCUFLOW_UPLOAD"
  | "DOCUFLOW_RENEW"
  | "DOCUFLOW_TAG"
  | "DOCUFLOW_DELETE"
  | "DOCUFLOW_SHARE"
  | "VEHICLE_CREATE"
  | "VEHICLE_UPDATE"
  | "DOCUFLOW_SIGN_PLACEMENT_ADD"
  | "DOCUFLOW_SIGN_PLACEMENT_UPDATE"
  | "DOCUFLOW_SIGN_PLACEMENT_DELETE"
  | "DOCUFLOW_SIGN_PLACEMENT_RESET"
  | "DOCUFLOW_SIGNATURE_SIGNED"
  | "DOCUFLOW_ANALYZE"
  | "DOCUFLOW_EXTRACT_METADATA"
  | "DOCUFLOW_SEARCH"
  | "SETTINGS_UPDATED"
  | "BACKUP_TRIGGERED"
  // RULES §12 — sensitive admin actions that change permission scope or
  // module visibility. PERMISSION_CHANGE = grant/revoke a single permission;
  // TOGGLE_MODULE = enable/disable a whole module (cashhub/fuelos/docuflow)
  // for the org or a specific user.
  | "PERMISSION_CHANGE"
  | "TOGGLE_MODULE"
  // Account recovery + admin actions
  | "PASSWORD_RESET_REQUESTED"
  | "ADMIN_UNLOCK_USER"
  // Cron jobs — recorded so we can prove a scheduled job ran (and dedupe).
  | "DEADLINE_REMINDER_T60"
  | "DEADLINE_REMINDER_T30"
  | "MONTHLY_REPORT_GENERATED"
  | "SYSTEM_DIGEST_SENT"
  | "ACCESS_REVIEW_RAN"
  | "PERIOD_CLOSED"
  | "PERIOD_REOPENED"
  | "RESUBMIT_REPORT"
  // Bulk import of external charge-session data (CONNEXT CSV → DailyReport).
  | "BULK_IMPORT_EV_REPORTS"
  // Telegram inline-keyboard reject flow: stores pending state so the next
  // text reply from the same Telegram user resolves into the rejection reason.
  | "TELEGRAM_PENDING_REJECT"
  | "TELEGRAM_PENDING_REJECT_RESOLVED"
  // Recruit module — รับสมัครพนักงาน
  | "RECRUIT_POSTING_CREATED"
  | "RECRUIT_POSTING_PUBLISHED"
  | "RECRUIT_POSTING_CLOSED"
  | "RECRUIT_POSTING_DELETED"
  | "RECRUIT_APPLICATION_SUBMITTED"
  | "RECRUIT_APPLICATION_STATUS_CHANGED"
  | "RECRUIT_APPLICATION_NOTE_ADDED"
  | "RECRUIT_AI_SCORED"
  | "RECRUIT_BLACKLIST_ADDED"
  | "RECRUIT_BLACKLIST_REMOVED"
  // Recruit v2 (Phase B-full per design canvas)
  | "RECRUIT_INTERVIEW_SCHEDULED"
  | "RECRUIT_INTERVIEW_STATUS_CHANGED"
  | "RECRUIT_INTERVIEW_SCORED"
  | "RECRUIT_MESSAGE_SENT"
  | "RECRUIT_RULE_CREATED"
  | "RECRUIT_RULE_UPDATED"
  | "RECRUIT_RULE_DELETED"
  | "RECRUIT_RULES_APPLIED"
  | "RECRUIT_REFERRAL_APPLIED"
  | "RECRUIT_REFERRAL_PAID"
  | "RECRUIT_ERASURE_REQUESTED"
  | "RECRUIT_ERASURE_APPROVED"
  | "RECRUIT_ERASURE_REJECTED"
  // Repair module — ระบบแจ้งซ่อม
  | "REPAIR_TICKET_CREATED"
  | "REPAIR_TICKET_STATUS_CHANGED"
  | "REPAIR_TICKET_ASSIGNED"
  | "REPAIR_TICKET_UNASSIGNED"
  | "REPAIR_TICKET_CLOSED"
  | "REPAIR_TICKET_REOPENED"
  | "REPAIR_TICKET_CANCELLED"
  | "REPAIR_PART_ADDED"
  | "REPAIR_PART_STATUS_CHANGED"
  | "REPAIR_PHOTO_ADDED"
  | "REPAIR_TECHNICIAN_CREATED"
  | "REPAIR_TECHNICIAN_TOGGLED"
  | "REPAIR_CATEGORY_CREATED";

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
