// Repair — server actions
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { putObject } from "@/lib/r2/upload";
import { getOrgAdminIds, sendNotificationToMany } from "@/lib/notifications/send";
import { audit } from "@/lib/audit/log";
import {
  canRepairWrite,
  canRepairAdmin,
  canRepairActOnTicket,
} from "./role-guard";
import { computeSlaDates } from "./sla";
import { normalizePhone, normalizeTicketCode } from "./slug";
import type {
  RepairTicketStatus,
  RepairPhotoPhase,
  RepairPartStatus,
} from "@/lib/generated/prisma/enums";
import { canTransition } from "./types";

const PhoneSchema = z
  .string()
  .min(8)
  .max(20)
  .transform((v) => normalizePhone(v))
  .refine((v): v is string => v !== null, { message: "เบอร์โทรไม่ถูกต้อง" });

const NameSchema = z.string().trim().min(2, "ชื่ออย่างน้อย 2 ตัวอักษร").max(100);

const CreateTicketSchema = z.object({
  orgId: z.string().uuid().optional(), // optional · use first active org if public
  companyId: z.string().uuid().nullish(),
  branchId: z.string().uuid().nullish(),
  categoryId: z.string().uuid().nullish(),
  title: z.string().trim().min(5, "หัวเรื่องอย่างน้อย 5 ตัวอักษร").max(200),
  description: z.string().trim().max(2000).default(""),
  customerImpact: z.string().trim().max(500).nullish(),
  urgency: z.enum(["URGENT", "NORMAL", "LOW"]).default("NORMAL"),
  source: z.enum(["GUIDED", "FREEFORM", "INTERNAL"]).default("FREEFORM"),
  reporterName: NameSchema,
  reporterPhone: PhoneSchema,
  reporterEmail: z.string().email().optional().or(z.literal("")),
  // Photo data URLs (already compressed client-side) — base64 strings
  photos: z
    .array(
      z.object({
        phase: z.enum(["BEFORE", "DURING", "AFTER", "PART", "RECEIPT"]).default("BEFORE"),
        dataUrl: z.string().startsWith("data:image/"),
      }),
    )
    .max(6)
    .default([]),
  ipAddress: z.string().nullish(),
});

export type CreateTicketInput = z.input<typeof CreateTicketSchema>;
export type CreateTicketResult = {
  ok: true;
  id: string;
  ticketCode: string;
} | {
  ok: false;
  error: string;
};

/**
 * Public ticket creation — no auth required. Uses adminClient to bypass RLS.
 * Called from /repairs/new public form OR from admin "+ แจ้งซ่อมใหม่" button.
 */
export async function createTicket(input: CreateTicketInput): Promise<CreateTicketResult> {
  const parsed = CreateTicketSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const data = parsed.data;

  // If admin called, session.user.org_id wins; if public, we need a default org.
  // For Pooil, the deployment has 1 org. We resolve it via the first active org.
  let orgId = data.orgId;
  let createdByUserId: string | null = null;
  let session: Awaited<ReturnType<typeof requireSession>> | null = null;
  try {
    session = await requireSession();
    orgId = session.user.org_id;
    createdByUserId = session.user.id;
  } catch {
    // public submission — no session
  }
  if (!orgId) {
    // Pick the first active org (Pooil single-tenant deployment)
    const admin = adminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: orgs } = await (admin.from as any)("organizations")
      .select("id")
      .eq("is_active", true)
      .limit(1);
    orgId = (orgs?.[0]?.id as string | undefined) ?? undefined;
    if (!orgId) return { ok: false, error: "ระบบยังไม่พร้อม · กรุณาติดต่อ admin" };
  }

  // Generate ticket code via DB RPC (atomic per-org sequence)
  const admin = adminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: codeRow, error: codeErr } = await (admin.rpc as any)(
    "repair_next_ticket_code",
    { p_org_id: orgId },
  );
  if (codeErr || typeof codeRow !== "string") {
    return { ok: false, error: "สร้างเลขใบไม่สำเร็จ · ลองอีกครั้ง" };
  }
  const ticketCode = codeRow as string;

  const sla = computeSlaDates(data.urgency);

  // Create ticket
  const ticket = await prisma.repairTicket.create({
    data: {
      orgId,
      companyId: data.companyId ?? null,
      branchId: data.branchId ?? null,
      categoryId: data.categoryId ?? null,
      ticketCode,
      title: data.title,
      description: data.description,
      customerImpact: data.customerImpact || null,
      status: "NEW",
      urgency: data.urgency,
      source: data.source,
      reporterName: data.reporterName,
      reporterPhone: data.reporterPhone,
      reporterEmail: data.reporterEmail || null,
      reporterUserId: createdByUserId,
      responseDueAt: sla.responseDueAt,
      resolveDueAt: sla.resolveDueAt,
      ipAddress: data.ipAddress ?? null,
    },
  });

  // CREATED timeline event
  await prisma.repairTimelineEvent.create({
    data: {
      orgId,
      ticketId: ticket.id,
      kind: "CREATED",
      actorUserId: createdByUserId,
      actorName: session?.user.name ?? data.reporterName,
      payload: { source: data.source },
    },
  });

  // Upload photos (server-side via R2 putObject)
  // Photo data URL is base64-encoded image — already compressed client-side.
  for (let i = 0; i < data.photos.length; i++) {
    const ph = data.photos[i];
    try {
      const b64 = ph.dataUrl.split(",")[1] ?? "";
      const buf = Buffer.from(b64, "base64");
      const ct = ph.dataUrl.match(/^data:([^;]+);/)?.[1] ?? "image/webp";
      const ext = ct.includes("png") ? "png" : ct.includes("jpeg") ? "jpg" : "webp";
      const key = `repair/${orgId}/${ticket.id}/${Date.now()}-${i}.${ext}`;
      const publicUrl = await putObject(key, buf, ct);
      await prisma.repairPhoto.create({
        data: {
          orgId,
          ticketId: ticket.id,
          phase: ph.phase as RepairPhotoPhase,
          r2Key: key,
          r2PublicUrl: publicUrl,
          contentType: ct,
          sizeBytes: buf.byteLength,
          uploadedById: createdByUserId,
          uploadedByName: session?.user.name ?? data.reporterName,
          expiresAt: ph.phase === "RECEIPT"
            ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // receipt 1 year
            : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // others 90 days
        },
      });
    } catch (e) {
      console.error("[repair.createTicket] photo upload failed", e);
      // Skip the failed photo — don't fail the whole ticket
    }
  }

  // Audit log (works even on public submissions where userId is null)
  await audit({
    orgId,
    userId: createdByUserId,
    action: "REPAIR_TICKET_CREATED",
    resourceType: "repair_ticket",
    resourceId: ticket.id,
    diff: { new: { ticketCode, title: data.title, urgency: data.urgency, source: data.source } },
  });

  // Notify all org admins
  try {
    const adminIds = await getOrgAdminIds(orgId);
    if (adminIds.length > 0) {
      await sendNotificationToMany(adminIds, {
        orgId,
        type: data.urgency === "URGENT" ? "danger" : "info",
        module: "repairs",
        title: `แจ้งซ่อมใหม่: ${ticketCode}`,
        body: `${data.title.slice(0, 80)} · จาก ${data.reporterName}`,
        link: `/repairs/triage?selected=${ticket.id}`,
      });
    }
  } catch (e) {
    console.error("[repair.createTicket] notify failed", e);
  }

  revalidatePath("/repairs");
  revalidatePath("/repairs/triage");
  revalidatePath("/repairs/kanban");
  revalidatePath("/repairs/table");

  return { ok: true, id: ticket.id, ticketCode };
}

// =============================================================
// Ticket status transitions (admin-side)
// =============================================================

const ChangeStatusSchema = z.object({
  ticketId: z.string().uuid(),
  to: z.enum(["NEW", "ACK", "IN_PROGRESS", "WAITING_PARTS", "RESOLVED", "CLOSED", "CANCELLED"]),
  comment: z.string().trim().max(500).optional(),
});

export async function changeStatus(input: z.input<typeof ChangeStatusSchema>): Promise<{ ok: boolean; error?: string }> {
  const parsed = ChangeStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const session = await requireSession();

  const { ticketId, to, comment } = parsed.data;
  const ticket = await prisma.repairTicket.findFirst({
    where: { id: ticketId, orgId: session.user.org_id },
    include: { assignedTech: { select: { userId: true } } },
  });
  if (!ticket) return { ok: false, error: "ไม่พบใบ" };

  // Permission: admin tier always; staff only if they're the assigned tech
  if (!canRepairActOnTicket(session.user.role, session.user.id, ticket.assignedTech?.userId ?? null)) {
    return { ok: false, error: "ไม่มีสิทธิ์" };
  }

  // Special case: CLOSED is admin-only
  if (to === "CLOSED" && !canRepairAdmin(session.user.role)) {
    return { ok: false, error: "ปิดถาวรได้เฉพาะ admin" };
  }

  if (!canTransition(ticket.status, to as RepairTicketStatus)) {
    return { ok: false, error: `เปลี่ยน ${ticket.status} → ${to} ไม่ได้` };
  }

  const now = new Date();
  const updates: Record<string, unknown> = { status: to };
  if (to === "ACK" && !ticket.acknowledgedAt) updates.acknowledgedAt = now;
  if (to === "IN_PROGRESS" && !ticket.startedAt) updates.startedAt = now;
  if (to === "RESOLVED") {
    updates.resolvedAt = now;
    updates.resolvedById = session.user.id;
  }
  if (to === "CLOSED") {
    updates.closedAt = now;
    updates.closedById = session.user.id;
  }
  if (to === "CANCELLED") updates.cancelledAt = now;

  await prisma.$transaction([
    prisma.repairTicket.update({ where: { id: ticketId }, data: updates }),
    prisma.repairTimelineEvent.create({
      data: {
        orgId: session.user.org_id,
        ticketId,
        kind: to === "CLOSED" ? "CLOSE" : "STATUS_CHANGE",
        actorUserId: session.user.id,
        actorName: session.user.name,
        payload: { from: ticket.status, to, comment: comment ?? null },
      },
    }),
  ]);

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action:
      to === "CLOSED" ? "REPAIR_TICKET_CLOSED"
      : to === "CANCELLED" ? "REPAIR_TICKET_CANCELLED"
      : "REPAIR_TICKET_STATUS_CHANGED",
    resourceType: "repair_ticket",
    resourceId: ticketId,
    diff: { old: { status: ticket.status }, new: { status: to } },
  });

  revalidatePath(`/repairs/${ticketId}`);
  revalidatePath("/repairs");
  revalidatePath("/repairs/triage");
  revalidatePath("/repairs/kanban");
  revalidatePath("/repairs/table");
  return { ok: true };
}

// =============================================================
// Assign technician
// =============================================================

export async function assignTechnician(input: { ticketId: string; technicianId: string | null }): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  if (!canRepairWrite(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์" };

  const ticket = await prisma.repairTicket.findFirst({
    where: { id: input.ticketId, orgId: session.user.org_id },
  });
  if (!ticket) return { ok: false, error: "ไม่พบใบ" };

  let techName: string | null = null;
  if (input.technicianId) {
    const tech = await prisma.repairTechnician.findFirst({
      where: { id: input.technicianId, orgId: session.user.org_id },
    });
    if (!tech) return { ok: false, error: "ไม่พบช่าง" };
    techName = tech.name;
  }

  await prisma.$transaction([
    prisma.repairTicket.update({
      where: { id: input.ticketId },
      data: {
        assignedTechId: input.technicianId,
        assignedAt: input.technicianId ? new Date() : null,
        // Auto-bump NEW → ACK on first assignment
        ...(input.technicianId && ticket.status === "NEW"
          ? { status: "ACK", acknowledgedAt: new Date() }
          : {}),
      },
    }),
    prisma.repairTimelineEvent.create({
      data: {
        orgId: session.user.org_id,
        ticketId: input.ticketId,
        kind: input.technicianId ? "ASSIGN" : "UNASSIGN",
        actorUserId: session.user.id,
        actorName: session.user.name,
        payload: { technicianId: input.technicianId, technicianName: techName },
      },
    }),
  ]);

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: input.technicianId ? "REPAIR_TICKET_ASSIGNED" : "REPAIR_TICKET_UNASSIGNED",
    resourceType: "repair_ticket",
    resourceId: input.ticketId,
    diff: {
      old: { technicianId: ticket.assignedTechId },
      new: { technicianId: input.technicianId, technicianName: techName },
    },
  });

  revalidatePath(`/repairs/${input.ticketId}`);
  revalidatePath("/repairs");
  revalidatePath("/repairs/triage");
  revalidatePath("/repairs/kanban");
  revalidatePath("/repairs/table");
  return { ok: true };
}

// =============================================================
// Comments
// =============================================================

export async function addComment(input: { ticketId: string; body: string }): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const body = input.body.trim();
  if (body.length === 0 || body.length > 1000) {
    return { ok: false, error: "ข้อความ 1-1000 ตัวอักษร" };
  }

  const ticket = await prisma.repairTicket.findFirst({
    where: { id: input.ticketId, orgId: session.user.org_id },
    include: { assignedTech: { select: { userId: true } } },
  });
  if (!ticket) return { ok: false, error: "ไม่พบใบ" };

  if (!canRepairActOnTicket(session.user.role, session.user.id, ticket.assignedTech?.userId ?? null)) {
    return { ok: false, error: "ไม่มีสิทธิ์" };
  }

  await prisma.repairTimelineEvent.create({
    data: {
      orgId: session.user.org_id,
      ticketId: input.ticketId,
      kind: "COMMENT",
      actorUserId: session.user.id,
      actorName: session.user.name,
      payload: { body },
    },
  });

  revalidatePath(`/repairs/${input.ticketId}`);
  return { ok: true };
}

// =============================================================
// Parts
// =============================================================

const AddPartSchema = z.object({
  ticketId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  spec: z.string().trim().max(200).optional(),
  quantity: z.number().int().min(1).max(9999).default(1),
  unit: z.string().trim().min(1).max(20).default("ชิ้น"),
  unitPriceCents: z.number().int().min(0).max(100_000_00).default(0),
  supplier: z.string().trim().max(100).optional(),
});

export async function addPart(input: z.input<typeof AddPartSchema>): Promise<{ ok: boolean; error?: string }> {
  const parsed = AddPartSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const session = await requireSession();
  const d = parsed.data;

  const ticket = await prisma.repairTicket.findFirst({
    where: { id: d.ticketId, orgId: session.user.org_id },
    include: { assignedTech: { select: { userId: true } } },
  });
  if (!ticket) return { ok: false, error: "ไม่พบใบ" };
  if (!canRepairActOnTicket(session.user.role, session.user.id, ticket.assignedTech?.userId ?? null)) {
    return { ok: false, error: "ไม่มีสิทธิ์" };
  }

  // Race-safe: create + sum + rollup in single transaction so concurrent
  // addPart calls cannot lose each other's contribution to partsCostCents.
  const { part, partsCostCents } = await prisma.$transaction(async (tx) => {
    const part = await tx.repairPart.create({
      data: {
        orgId: session.user.org_id,
        ticketId: d.ticketId,
        name: d.name,
        spec: d.spec || null,
        quantity: d.quantity,
        unit: d.unit,
        unitPriceCents: d.unitPriceCents,
        supplier: d.supplier || null,
        addedById: session.user.id,
      },
    });
    const all = await tx.repairPart.findMany({
      where: { ticketId: d.ticketId, status: { not: "CANCELLED" } },
      select: { quantity: true, unitPriceCents: true },
    });
    const partsCostCents = all.reduce((acc, p) => acc + p.quantity * p.unitPriceCents, 0);
    await tx.repairTicket.update({
      where: { id: d.ticketId },
      data: { partsCostCents },
    });
    await tx.repairTimelineEvent.create({
      data: {
        orgId: session.user.org_id,
        ticketId: d.ticketId,
        kind: "PART_ADDED",
        actorUserId: session.user.id,
        actorName: session.user.name,
        payload: {
          partId: part.id,
          name: d.name,
          spec: d.spec ?? null,
          quantity: d.quantity,
          unit: d.unit,
        },
      },
    });
    return { part, partsCostCents };
  });

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "REPAIR_PART_ADDED",
    resourceType: "repair_part",
    resourceId: part.id,
    diff: { new: { ticketId: d.ticketId, name: d.name, qty: d.quantity, unitPriceCents: d.unitPriceCents, partsCostCents } },
  });

  revalidatePath(`/repairs/${d.ticketId}`);
  revalidatePath("/repairs/parts");
  return { ok: true };
}

export async function updatePartStatus(input: {
  partId: string;
  status: RepairPartStatus;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  if (!canRepairWrite(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์" };

  const part = await prisma.repairPart.findFirst({
    where: { id: input.partId, orgId: session.user.org_id },
  });
  if (!part) return { ok: false, error: "ไม่พบอะไหล่" };

  const now = new Date();
  const stamps: Record<string, unknown> = {};
  if (input.status === "ORDERED" && !part.orderedAt) {
    stamps.orderedAt = now;
    stamps.orderedById = session.user.id;
  }
  if (input.status === "DELIVERED" && !part.deliveredAt) stamps.deliveredAt = now;
  if (input.status === "INSTALLED" && !part.installedAt) stamps.installedAt = now;

  // Race-safe: status change may flip CANCELLED ↔ active → rollup must
  // recompute inside the same transaction.
  const partsCostCents = await prisma.$transaction(async (tx) => {
    await tx.repairPart.update({
      where: { id: input.partId },
      data: { status: input.status, ...stamps },
    });
    const all = await tx.repairPart.findMany({
      where: { ticketId: part.ticketId, status: { not: "CANCELLED" } },
      select: { quantity: true, unitPriceCents: true },
    });
    const sum = all.reduce((acc, p) => acc + p.quantity * p.unitPriceCents, 0);
    await tx.repairTicket.update({
      where: { id: part.ticketId },
      data: { partsCostCents: sum },
    });
    await tx.repairTimelineEvent.create({
      data: {
        orgId: session.user.org_id,
        ticketId: part.ticketId,
        kind: "PART_UPDATED",
        actorUserId: session.user.id,
        actorName: session.user.name,
        payload: { partId: part.id, name: part.name, status: input.status },
      },
    });
    return sum;
  });

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "REPAIR_PART_STATUS_CHANGED",
    resourceType: "repair_part",
    resourceId: input.partId,
    diff: { old: { status: part.status }, new: { status: input.status, partsCostCents } },
  });

  revalidatePath(`/repairs/${part.ticketId}`);
  revalidatePath("/repairs/parts");
  return { ok: true };
}

// =============================================================
// Photos (server-side · base64 upload, same flow as createTicket photos)
// =============================================================

export async function addPhoto(input: {
  ticketId: string;
  phase: RepairPhotoPhase;
  dataUrl: string;
  caption?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();

  const ticket = await prisma.repairTicket.findFirst({
    where: { id: input.ticketId, orgId: session.user.org_id },
    include: { assignedTech: { select: { userId: true } } },
  });
  if (!ticket) return { ok: false, error: "ไม่พบใบ" };

  if (!canRepairActOnTicket(session.user.role, session.user.id, ticket.assignedTech?.userId ?? null)) {
    return { ok: false, error: "ไม่มีสิทธิ์" };
  }

  if (!input.dataUrl.startsWith("data:image/")) {
    return { ok: false, error: "ไฟล์ไม่ใช่รูป" };
  }
  // Reject SVG entirely (XSS vector if ever rendered inline)
  if (input.dataUrl.startsWith("data:image/svg")) {
    return { ok: false, error: "ไฟล์ SVG ไม่รองรับ · ใช้ JPG/PNG/WebP" };
  }

  try {
    const b64 = input.dataUrl.split(",")[1] ?? "";
    const buf = Buffer.from(b64, "base64");
    if (buf.byteLength > 1_500_000) {
      return { ok: false, error: "รูปใหญ่เกิน 1.5MB · ลดขนาดก่อน" };
    }
    const ct = input.dataUrl.match(/^data:([^;]+);/)?.[1] ?? "image/webp";
    const ext = ct.includes("png") ? "png" : ct.includes("jpeg") ? "jpg" : "webp";
    const key = `repair/${session.user.org_id}/${input.ticketId}/${Date.now()}.${ext}`;
    const publicUrl = await putObject(key, buf, ct);
    await prisma.repairPhoto.create({
      data: {
        orgId: session.user.org_id,
        ticketId: input.ticketId,
        phase: input.phase,
        r2Key: key,
        r2PublicUrl: publicUrl,
        contentType: ct,
        sizeBytes: buf.byteLength,
        caption: input.caption?.trim() || null,
        uploadedById: session.user.id,
        uploadedByName: session.user.name,
        expiresAt: input.phase === "RECEIPT"
          ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
          : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.repairTimelineEvent.create({
      data: {
        orgId: session.user.org_id,
        ticketId: input.ticketId,
        kind: "PHOTO_ADDED",
        actorUserId: session.user.id,
        actorName: session.user.name,
        payload: { phase: input.phase, caption: input.caption ?? null },
      },
    });
    await audit({
      orgId: session.user.org_id,
      userId: session.user.id,
      action: "REPAIR_PHOTO_ADDED",
      resourceType: "repair_photo",
      resourceId: input.ticketId,
      diff: { new: { phase: input.phase } },
    });
  } catch (e) {
    console.error("[repair.addPhoto] upload failed", e);
    return { ok: false, error: "อัปโหลดรูปไม่สำเร็จ" };
  }

  revalidatePath(`/repairs/${input.ticketId}`);
  return { ok: true };
}

// =============================================================
// Labor cost (manual entry — includes travel/diem)
// =============================================================

const SetLaborCostSchema = z.object({
  ticketId: z.string().uuid(),
  laborCostCents: z.number().int().min(0).max(10_000_000_00),
  note: z.string().trim().max(200).optional(),
});

export async function setLaborCost(input: z.input<typeof SetLaborCostSchema>): Promise<{ ok: boolean; error?: string }> {
  const parsed = SetLaborCostSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const session = await requireSession();
  // Tighter than canRepairActOnTicket — cost integrity is a write-tier concern.
  if (!canRepairWrite(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์" };

  const ticket = await prisma.repairTicket.findFirst({
    where: { id: parsed.data.ticketId, orgId: session.user.org_id },
  });
  if (!ticket) return { ok: false, error: "ไม่พบใบ" };

  if (ticket.laborCostCents === parsed.data.laborCostCents) return { ok: true };

  await prisma.$transaction([
    prisma.repairTicket.update({
      where: { id: parsed.data.ticketId },
      data: { laborCostCents: parsed.data.laborCostCents },
    }),
    prisma.repairTimelineEvent.create({
      data: {
        orgId: session.user.org_id,
        ticketId: parsed.data.ticketId,
        kind: "COMMENT",
        actorUserId: session.user.id,
        actorName: session.user.name,
        payload: {
          body:
            "อัปเดตค่าแรง: " +
            (parsed.data.laborCostCents / 100).toLocaleString("th-TH") +
            " บาท" +
            (parsed.data.note ? ` · ${parsed.data.note}` : ""),
          laborCostCents: parsed.data.laborCostCents,
        },
      },
    }),
  ]);

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "REPAIR_LABOR_COST_SET",
    resourceType: "repair_ticket",
    resourceId: parsed.data.ticketId,
    diff: {
      old: { laborCostCents: ticket.laborCostCents },
      new: { laborCostCents: parsed.data.laborCostCents },
    },
  });

  revalidatePath(`/repairs/${parsed.data.ticketId}`);
  revalidatePath("/repairs");
  revalidatePath("/repairs/triage");
  return { ok: true };
}

// =============================================================
// ETA
// =============================================================

export async function setEta(input: { ticketId: string; etaAt: string | null }): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();

  const ticket = await prisma.repairTicket.findFirst({
    where: { id: input.ticketId, orgId: session.user.org_id },
    include: { assignedTech: { select: { userId: true } } },
  });
  if (!ticket) return { ok: false, error: "ไม่พบใบ" };
  if (!canRepairActOnTicket(session.user.role, session.user.id, ticket.assignedTech?.userId ?? null)) {
    return { ok: false, error: "ไม่มีสิทธิ์" };
  }

  const etaDate = input.etaAt ? new Date(input.etaAt) : null;
  if (input.etaAt && etaDate && Number.isNaN(etaDate.getTime())) {
    return { ok: false, error: "วันเวลาผิดรูปแบบ" };
  }

  await prisma.$transaction([
    prisma.repairTicket.update({ where: { id: input.ticketId }, data: { etaAt: etaDate } }),
    prisma.repairTimelineEvent.create({
      data: {
        orgId: session.user.org_id,
        ticketId: input.ticketId,
        kind: "ETA_SET",
        actorUserId: session.user.id,
        actorName: session.user.name,
        payload: { etaAt: etaDate?.toISOString() ?? null },
      },
    }),
  ]);

  revalidatePath(`/repairs/${input.ticketId}`);
  return { ok: true };
}

// =============================================================
// Technician CRUD (admin only)
// =============================================================

const CreateTechnicianSchema = z.object({
  kind: z.enum(["INTERNAL", "VENDOR"]),
  userId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(20).optional(),
  lineId: z.string().trim().max(100).optional(),
  specialties: z.array(z.string()).default([]),
  notes: z.string().trim().max(500).optional(),
});

export async function createTechnician(input: z.input<typeof CreateTechnicianSchema>): Promise<{ ok: boolean; error?: string; id?: string }> {
  const parsed = CreateTechnicianSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const session = await requireSession();
  if (!canRepairAdmin(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์" };
  const d = parsed.data;

  const tech = await prisma.repairTechnician.create({
    data: {
      orgId: session.user.org_id,
      kind: d.kind,
      userId: d.kind === "INTERNAL" ? d.userId ?? null : null,
      name: d.name,
      phone: d.phone || null,
      lineId: d.lineId || null,
      specialties: d.specialties,
      notes: d.notes || null,
    },
  });

  revalidatePath("/repairs/technicians");
  return { ok: true, id: tech.id };
}

export async function toggleTechnicianActive(input: { id: string }): Promise<{ ok: boolean }> {
  const session = await requireSession();
  if (!canRepairAdmin(session.user.role)) return { ok: false };
  const tech = await prisma.repairTechnician.findFirst({
    where: { id: input.id, orgId: session.user.org_id },
  });
  if (!tech) return { ok: false };
  await prisma.repairTechnician.update({
    where: { id: input.id },
    data: { isActive: !tech.isActive },
  });
  revalidatePath("/repairs/technicians");
  return { ok: true };
}

// =============================================================
// Category CRUD (admin)
// =============================================================

const CreateCategorySchema = z.object({
  slug: z.string().trim().min(1).max(40).regex(/^[a-z0-9-]+$/, "slug = a-z, 0-9, dash"),
  label: z.string().trim().min(1).max(60),
  emoji: z.string().trim().max(4).optional(),
  defaultUrgency: z.enum(["URGENT", "NORMAL", "LOW"]).default("NORMAL"),
  sortOrder: z.number().int().min(0).max(999).default(50),
});

export async function createCategory(input: z.input<typeof CreateCategorySchema>): Promise<{ ok: boolean; error?: string }> {
  const parsed = CreateCategorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const session = await requireSession();
  if (!canRepairAdmin(session.user.role)) return { ok: false, error: "ไม่มีสิทธิ์" };

  try {
    await prisma.repairCategory.create({
      data: { orgId: session.user.org_id, ...parsed.data, emoji: parsed.data.emoji || null },
    });
  } catch {
    return { ok: false, error: "slug ซ้ำ" };
  }
  revalidatePath("/repairs/categories");
  return { ok: true };
}

// =============================================================
// Public tracking lookup (no auth)
// =============================================================

export async function trackLookup(input: { ticketCode: string; phone: string }): Promise<
  | { ok: true; ticketId: string; orgId: string }
  | { ok: false; error: string }
> {
  // Rate-limit per ticket code + per phone: 5 attempts per 15 min.
  // (Brute-forcing the 4-digit seq becomes 1500x slower; full sweep = 50 hr.)
  const { checkRateLimit } = await import("@/lib/rate-limit");

  const code = normalizeTicketCode(input.ticketCode);
  if (!code) return { ok: false, error: "เลขที่ใบไม่ถูกต้อง" };
  const phone = normalizePhone(input.phone);
  if (!phone) return { ok: false, error: "เบอร์โทรไม่ถูกต้อง" };

  // Bucket on the ticket-code prefix (catches enumeration of sequential codes)
  const codeBucket = await checkRateLimit({
    bucket: `repair:track:code:${code}`,
    max: 5,
    windowSec: 15 * 60,
  });
  if (codeBucket.limited) {
    return { ok: false, error: "ลองมากเกินไป · รออีกประมาณ 15 นาที" };
  }

  // Also bucket per phone (one user trying many codes)
  const phoneBucket = await checkRateLimit({
    bucket: `repair:track:phone:${phone}`,
    max: 10,
    windowSec: 15 * 60,
  });
  if (phoneBucket.limited) {
    return { ok: false, error: "ลองมากเกินไป · รออีกประมาณ 15 นาที" };
  }

  const ticket = await prisma.repairTicket.findFirst({
    where: { ticketCode: code, reporterPhone: phone },
    select: { id: true, orgId: true },
  });
  if (!ticket) {
    // Constant-ish delay on miss to slow brute-force probing
    await new Promise((r) => setTimeout(r, 250));
    return { ok: false, error: "ไม่พบใบ · เช็คเลขที่+เบอร์อีกครั้ง" };
  }
  return { ok: true, ticketId: ticket.id, orgId: ticket.orgId };
}
