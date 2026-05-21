// Audit log middleware — every mutation must call writeAudit
// Immutable · who/when/old/new
import { prisma } from "@/lib/prisma";

export async function writeAudit(args: {
  userId: string | null;
  action: string;
  entity: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, unknown>;
}) {
  return prisma.chairopsAuditLog.create({
    data: {
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
