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

type AuditClient = Pick<Prisma.TransactionClient, "chairopsAuditLog"> | typeof prisma;

export async function writeAudit(
  args: {
    userId: string | null;
    action: string;
    entity: string;
    entityId: string;
    oldValue?: unknown;
    newValue?: unknown;
    metadata?: Record<string, unknown>;
  },
  client: AuditClient = prisma,
) {
  return client.chairopsAuditLog.create({
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
