// Audit log middleware — every mutation must call writeAudit
// Immutable · who/when/old/new
//
// Wave-0 fix: accept optional transaction client so mutation + audit happen
// in the same DB transaction (atomic). Pass `tx` from inside
// `prisma.$transaction(async (tx) => { ... })` to guarantee that an audit
// row never exists for a rolled-back mutation, and a successful mutation
// never goes un-audited.
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";

type AuditClient =
  | Pick<Prisma.TransactionClient, "chairopsAuditLog" | "chairopsUser">
  | typeof prisma;

// W0: every chairops table now requires orgId (see migration 20260527130540_chairops_w0).
// Caller can pass orgId explicitly · if omitted we derive from the audit actor
// (`ChairopsUser.orgId`). userId=null + no orgId is invalid · throws so we don't
// silently mis-tenant a system audit row.
// See [[chairops-audit-2026-05-25]] · audit Phase-1 BE/SA flagged orgId gap.
export async function writeAudit(
  args: {
    userId: string | null;
    action: string;
    entity: string;
    entityId: string;
    oldValue?: unknown;
    newValue?: unknown;
    metadata?: Record<string, unknown>;
    /** Explicit org · required when userId is null (system/cron actor). */
    orgId?: string;
  },
  client: AuditClient = prisma,
) {
  let orgId = args.orgId;
  if (!orgId) {
    if (!args.userId) {
      throw new Error(
        "writeAudit: orgId is required for system audits (userId=null) · " +
          "pass orgId explicitly from the caller's tenant context",
      );
    }
    const actor = await client.chairopsUser.findUnique({
      where: { id: args.userId },
      select: { orgId: true },
    });
    if (!actor) {
      throw new Error(`writeAudit: actor ChairopsUser ${args.userId} not found`);
    }
    orgId = actor.orgId;
  }

  return client.chairopsAuditLog.create({
    data: {
      orgId,
      userId: args.userId,
      action: args.action,
      entity: args.entity,
      entityId: args.entityId,
      oldValue: (args.oldValue ?? null) as never,
      newValue: (args.newValue ?? null) as never,
      metadata: (args.metadata ?? null) as never,
    },
  });
}
