"use server";

// Server actions for damage ticket workflow
// All mutations → writeAudit · all role-checked
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { canSeeBranch } from "@/lib/chairops/auth/role-guards";
import { writeAudit } from "@/lib/chairops/audit/log";
import { zUUID } from "@/lib/chairops/schemas/zod-helpers";
import { Prisma } from "@/lib/generated/prisma/client";
import { ChairopsTicketStatus } from "@/lib/generated/prisma/enums";

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const assignSchema = z.object({
  code: z.string().min(1),
  technicianId: zUUID(),
});

export async function assignTicket(
  code: string,
  technicianId: string
): Promise<ActionResult> {
  const parsed = assignSchema.safeParse({ code, technicianId });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  // MANAGER+ can assign · TECHNICIAN cannot reassign themselves
  const session = await requireRole("MANAGER");

  const ticket = await prisma.chairopsDamageTicket.findUnique({
    where: {
      orgId_ticketCode: { orgId: session.user.orgId, ticketCode: parsed.data.code },
    },
  });
  if (!ticket) return { ok: false, error: "ไม่พบตั๋วซ่อม" };

  // HIGH-001: MANAGER must own this branch (canSeeBranch enforces branch isolation)
  if (!canSeeBranch(session.user, ticket.branchId)) {
    return { ok: false, error: "ไม่มีสิทธิ์เข้าถึงตั๋วของสาขานี้" };
  }

  const tech = await prisma.chairopsUser.findFirst({
    where: { id: parsed.data.technicianId, orgId: session.user.orgId },
  });
  if (!tech || !tech.isActive)
    return { ok: false, error: "ไม่พบช่างหรือบัญชีถูกปิดใช้งาน" };
  if (tech.role !== "TECHNICIAN" && tech.role !== "MANAGER")
    return { ok: false, error: "ผู้รับงานต้องเป็นช่างหรือผู้จัดการ" };

  const old = { assignedToId: ticket.assignedToId, status: ticket.status };
  const newStatus =
    ticket.status === "OPEN" ? ChairopsTicketStatus.ASSIGNED : ticket.status;

  const updated = await prisma.chairopsDamageTicket.update({
    where: { id: ticket.id },
    data: { assignedToId: parsed.data.technicianId, status: newStatus },
  });

  await writeAudit({
    userId: session.user.id,
    action: "damage_ticket.assign",
    entity: "DamageTicket",
    entityId: updated.id,
    oldValue: old,
    newValue: { assignedToId: updated.assignedToId, status: updated.status },
    metadata: { ticketCode: updated.ticketCode },
  });

  revalidatePath(`/chairops/damage/${parsed.data.code}`);
  revalidatePath("/chairops/damage");
  return { ok: true };
}

const statusSchema = z.object({
  code: z.string().min(1),
  newStatus: z.enum(ChairopsTicketStatus),
});

const STATUS_TRANSITIONS: Record<ChairopsTicketStatus, ChairopsTicketStatus[]> = {
  OPEN: ["ASSIGNED", "IN_PROGRESS", "CANCELLED"],
  ASSIGNED: ["IN_PROGRESS", "WAITING_PARTS", "CANCELLED", "OPEN"],
  IN_PROGRESS: ["WAITING_PARTS", "DONE", "ASSIGNED"],
  WAITING_PARTS: ["IN_PROGRESS", "DONE", "CANCELLED"],
  DONE: [], // closed — use re-open via admin (not here)
  CANCELLED: [],
};

export async function updateStatus(
  code: string,
  newStatus: ChairopsTicketStatus
): Promise<ActionResult> {
  const parsed = statusSchema.safeParse({ code, newStatus });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const session = await requireRole("TECHNICIAN");
  if (session.user.role === "MAID") {
    return { ok: false, error: "แม่บ้านไม่มีสิทธิ์ทำรายการนี้" };
  }
  const ticket = await prisma.chairopsDamageTicket.findUnique({
    where: {
      orgId_ticketCode: { orgId: session.user.orgId, ticketCode: parsed.data.code },
    },
  });
  if (!ticket) return { ok: false, error: "ไม่พบตั๋วซ่อม" };

  // HIGH-001: managers/office can only act on tickets in their scope
  if (
    session.user.role !== "TECHNICIAN" &&
    !canSeeBranch(session.user, ticket.branchId)
  ) {
    return { ok: false, error: "ไม่มีสิทธิ์เข้าถึงตั๋วของสาขานี้" };
  }
  // technician can only update tickets assigned to them
  if (
    session.user.role === "TECHNICIAN" &&
    ticket.assignedToId !== session.user.id
  ) {
    return { ok: false, error: "ตั๋วนี้ไม่ได้มอบหมายให้คุณ" };
  }

  const allowed = STATUS_TRANSITIONS[ticket.status];
  if (!allowed.includes(parsed.data.newStatus)) {
    return {
      ok: false,
      error: `เปลี่ยนสถานะจาก ${ticket.status} → ${parsed.data.newStatus} ไม่ได้`,
    };
  }

  const old = { status: ticket.status };
  const data: Prisma.ChairopsDamageTicketUpdateInput = { status: parsed.data.newStatus };
  if (parsed.data.newStatus === "DONE") data.closedAt = new Date();

  const updated = await prisma.chairopsDamageTicket.update({
    where: { id: ticket.id },
    data,
  });

  await writeAudit({
    userId: session.user.id,
    action: "damage_ticket.status_change",
    entity: "DamageTicket",
    entityId: updated.id,
    oldValue: old,
    newValue: { status: updated.status, closedAt: updated.closedAt },
    metadata: { ticketCode: updated.ticketCode },
  });

  revalidatePath(`/chairops/damage/${parsed.data.code}`);
  revalidatePath("/chairops/damage");
  return { ok: true };
}

const usePartsSchema = z.object({
  code: z.string().min(1),
  items: z
    .array(
      z.object({
        partId: zUUID(),
        qty: z.number().int().positive(),
      })
    )
    .min(1, "ต้องเลือกอะไหล่อย่างน้อย 1 รายการ"),
});

export async function useParts(
  code: string,
  items: { partId: string; qty: number }[]
): Promise<ActionResult> {
  const parsed = usePartsSchema.safeParse({ code, items });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const session = await requireRole("TECHNICIAN");
  if (session.user.role === "MAID") {
    return { ok: false, error: "แม่บ้านไม่มีสิทธิ์ทำรายการนี้" };
  }

  const ticket = await prisma.chairopsDamageTicket.findUnique({
    where: {
      orgId_ticketCode: { orgId: session.user.orgId, ticketCode: parsed.data.code },
    },
  });
  if (!ticket) return { ok: false, error: "ไม่พบตั๋วซ่อม" };

  // HIGH-001: branch isolation
  if (
    session.user.role !== "TECHNICIAN" &&
    !canSeeBranch(session.user, ticket.branchId)
  ) {
    return { ok: false, error: "ไม่มีสิทธิ์เข้าถึงตั๋วของสาขานี้" };
  }
  if (
    session.user.role === "TECHNICIAN" &&
    ticket.assignedToId !== session.user.id
  ) {
    return { ok: false, error: "ตั๋วนี้ไม่ได้มอบหมายให้คุณ" };
  }

  if (ticket.status === "DONE" || ticket.status === "CANCELLED") {
    return { ok: false, error: "ตั๋วปิดแล้ว ใช้อะไหล่ไม่ได้" };
  }

  // Transaction: validate stock → decrement + create movements
  try {
    await prisma.$transaction(async (tx) => {
      for (const it of parsed.data.items) {
        const part = await tx.chairopsSparePart.findFirst({
          where: { id: it.partId, orgId: session.user.orgId },
        });
        if (!part) throw new Error(`ไม่พบอะไหล่ ${it.partId}`);
        if (part.stockOnHand < it.qty)
          throw new Error(`อะไหล่ "${part.name}" สต็อกไม่พอ (เหลือ ${part.stockOnHand})`);

        await tx.chairopsSparePart.update({
          where: { id: it.partId },
          data: { stockOnHand: { decrement: it.qty } },
        });

        await tx.chairopsSparePartMovement.create({
          data: {
            orgId: session.user.orgId,
            partId: it.partId,
            branchId: ticket.branchId,
            delta: -it.qty,
            reason: `used-in-damage-${ticket.ticketCode}`,
            refTicketId: ticket.id,
            byUserId: session.user.id,
          },
        });
      }
    });

    await writeAudit({
      userId: session.user.id,
      action: "damage_ticket.use_parts",
      entity: "DamageTicket",
      entityId: ticket.id,
      oldValue: null,
      newValue: { items: parsed.data.items },
      metadata: { ticketCode: ticket.ticketCode },
    });

    revalidatePath(`/chairops/damage/${parsed.data.code}`);
    revalidatePath("/chairops/parts");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" };
  }
}

const closeSchema = z.object({
  code: z.string().min(1),
  notes: z.string().trim().max(1000).optional(),
});

export async function closeTicket(
  code: string,
  notes?: string
): Promise<ActionResult> {
  const parsed = closeSchema.safeParse({ code, notes });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const session = await requireRole("TECHNICIAN");
  if (session.user.role === "MAID") {
    return { ok: false, error: "แม่บ้านไม่มีสิทธิ์ทำรายการนี้" };
  }
  const ticket = await prisma.chairopsDamageTicket.findUnique({
    where: {
      orgId_ticketCode: { orgId: session.user.orgId, ticketCode: parsed.data.code },
    },
  });
  if (!ticket) return { ok: false, error: "ไม่พบตั๋วซ่อม" };

  // HIGH-001: branch isolation
  if (
    session.user.role !== "TECHNICIAN" &&
    !canSeeBranch(session.user, ticket.branchId)
  ) {
    return { ok: false, error: "ไม่มีสิทธิ์เข้าถึงตั๋วของสาขานี้" };
  }
  if (
    session.user.role === "TECHNICIAN" &&
    ticket.assignedToId !== session.user.id
  ) {
    return { ok: false, error: "ตั๋วนี้ไม่ได้มอบหมายให้คุณ" };
  }

  if (ticket.status === "DONE" || ticket.status === "CANCELLED") {
    return { ok: false, error: "ตั๋วปิดไปแล้ว" };
  }

  const old = { status: ticket.status, notes: ticket.notes, closedAt: ticket.closedAt };
  const updated = await prisma.chairopsDamageTicket.update({
    where: { id: ticket.id },
    data: {
      status: "DONE",
      closedAt: new Date(),
      notes: parsed.data.notes ?? ticket.notes,
    },
  });

  await writeAudit({
    userId: session.user.id,
    action: "damage_ticket.close",
    entity: "DamageTicket",
    entityId: updated.id,
    oldValue: old,
    newValue: { status: updated.status, notes: updated.notes, closedAt: updated.closedAt },
    metadata: { ticketCode: updated.ticketCode },
  });

  revalidatePath(`/chairops/damage/${parsed.data.code}`);
  revalidatePath("/chairops/damage");
  return { ok: true };
}
