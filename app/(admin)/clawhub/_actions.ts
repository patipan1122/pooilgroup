"use server";

// ClawHub (JOLLY PLAY) — admin server actions.
//
// Every action re-authorizes with authorizeAction() (server actions are direct POST
// endpoints; the layout gate does NOT protect them) and revalidates the affected
// path so the list refreshes after a mutation.
//
// The MONEY logic for refunds lives in lib/clawhub/refund.ts (approveRefund /
// rejectRefund) — we never re-implement crediting here, we just call it with the
// admin's user id as adminUserId. Redemption/reward/member mutations are simple
// status flips guarded by the org scope.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { clawhubOrgId } from "@/lib/clawhub/org";
import { approveRefund, rejectRefund } from "@/lib/clawhub/refund";
import { pushText } from "@/lib/clawhub/line";
import { authorizeAction, type ActionResult } from "./_lib";

/* ───────────────────────── Refunds ───────────────────────── */

const reviewSchema = z.object({
  requestId: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
});

/**
 * Approve a PENDING_REVIEW refund → credits points via lib/clawhub/refund.ts
 * (idempotent there). Best-effort LINE push to the customer; never blocks the
 * decision if LINE is down.
 */
export async function approveRefundAction(raw: unknown): Promise<ActionResult> {
  const session = await authorizeAction();
  const parsed = reviewSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };

  const res = await approveRefund({
    requestId: parsed.data.requestId,
    adminUserId: session.user.id,
    note: parsed.data.note,
  });
  if (!res.ok) {
    return { ok: false, error: reasonText(res.reason) };
  }

  // Notify the customer (best-effort). We pushText to their LINE id if we can find it.
  await notifyMemberOfRefund(parsed.data.requestId, true).catch(() => undefined);

  revalidatePath("/clawhub/refunds");
  revalidatePath("/clawhub/dashboard");
  return { ok: true };
}

/** Reject a PENDING_REVIEW refund (no points). Best-effort customer push. */
export async function rejectRefundAction(raw: unknown): Promise<ActionResult> {
  const session = await authorizeAction();
  const parsed = reviewSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };

  const res = await rejectRefund({
    requestId: parsed.data.requestId,
    adminUserId: session.user.id,
    note: parsed.data.note,
  });
  if (!res.ok) {
    return { ok: false, error: reasonText(res.reason) };
  }

  await notifyMemberOfRefund(parsed.data.requestId, false, parsed.data.note).catch(
    () => undefined,
  );

  revalidatePath("/clawhub/refunds");
  revalidatePath("/clawhub/dashboard");
  return { ok: true };
}

/** Look up the member's LINE id for a request and push a Thai decision message. */
async function notifyMemberOfRefund(
  requestId: string,
  approved: boolean,
  note?: string,
): Promise<void> {
  const req = await prisma.clawhubRefundRequest.findUnique({
    where: { id: requestId },
    select: { pointsAwarded: true, member: { select: { externalLineId: true } } },
  });
  const lineId = req?.member?.externalLineId;
  if (!lineId) return;
  const msg = approved
    ? `✅ คำขอคืนแต้มของคุณได้รับการอนุมัติแล้ว · ได้รับ ${req?.pointsAwarded ?? 0} แต้ม`
    : `เสียใจด้วยครับ คำขอคืนแต้มของคุณไม่ผ่านการตรวจสอบ${note ? ` · เหตุผล: ${note}` : ""}`;
  await pushText(lineId, msg);
}

/* ───────────────────────── Redemptions ───────────────────────── */

const fulfillSchema = z.object({ redemptionId: z.string().uuid() });

/**
 * Mark a redemption as FULFILLED (staff handed the doll over). Idempotent: a second
 * click on an already-fulfilled or cancelled redemption is a clean no-op.
 */
export async function fulfillRedemptionAction(raw: unknown): Promise<ActionResult> {
  const session = await authorizeAction();
  const orgId = await clawhubOrgId();
  const parsed = fulfillSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };

  const r = await prisma.clawhubRedemption.findUnique({
    where: { id: parsed.data.redemptionId },
    select: { id: true, orgId: true, status: true },
  });
  if (!r || r.orgId !== orgId) return { ok: false, error: "ไม่พบรายการแลกของ" };
  if (r.status !== "PENDING") return { ok: true }; // already handled — no-op

  await prisma.clawhubRedemption.update({
    where: { id: r.id },
    data: { status: "FULFILLED", fulfilledById: session.user.id, fulfilledAt: new Date() },
  });

  revalidatePath("/clawhub/redemptions");
  revalidatePath("/clawhub/dashboard");
  return { ok: true };
}

/* ───────────────────────── Members ───────────────────────── */

const blockSchema = z.object({
  memberId: z.string().uuid(),
  block: z.boolean(),
});

/** Block / unblock a member (sets/clears blockedAt). */
export async function setMemberBlockedAction(raw: unknown): Promise<ActionResult> {
  await authorizeAction();
  const orgId = await clawhubOrgId();
  const parsed = blockSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };

  const m = await prisma.clawhubMember.findUnique({
    where: { id: parsed.data.memberId },
    select: { id: true, orgId: true },
  });
  if (!m || m.orgId !== orgId) return { ok: false, error: "ไม่พบสมาชิก" };

  await prisma.clawhubMember.update({
    where: { id: m.id },
    data: { blockedAt: parsed.data.block ? new Date() : null },
  });

  revalidatePath(`/clawhub/members/${m.id}`);
  revalidatePath("/clawhub/members");
  return { ok: true };
}

/* ───────────────────────── Rewards (ตุ๊กตา) ───────────────────────── */

const rewardSchema = z.object({
  name: z.string().trim().min(1, "ต้องมีชื่อ").max(120),
  imageUrl: z.string().trim().max(600).optional().or(z.literal("")),
  pointsPrice: z.coerce.number().int().min(1, "ราคาแต้มต้อง ≥ 1"),
  // blank → unlimited stock (null)
  stock: z
    .union([z.coerce.number().int().min(0), z.literal(""), z.null()])
    .optional(),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().default(0),
  sku: z.string().trim().max(60).optional().or(z.literal("")),
  productId: z.string().uuid().optional().or(z.literal("")),
});

function normStock(s: number | "" | null | undefined): number | null {
  if (s === "" || s == null) return null;
  return s;
}
function emptyToNull(s: string | undefined): string | null {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
}

export async function createRewardAction(raw: unknown): Promise<ActionResult> {
  await authorizeAction();
  const orgId = await clawhubOrgId();
  const parsed = rewardSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  const d = parsed.data;

  await prisma.clawhubReward.create({
    data: {
      orgId,
      name: d.name,
      imageUrl: emptyToNull(d.imageUrl),
      pointsPrice: d.pointsPrice,
      stock: normStock(d.stock),
      isActive: d.isActive ?? true,
      sortOrder: d.sortOrder,
      sku: emptyToNull(d.sku),
      productId: emptyToNull(d.productId),
    },
  });

  revalidatePath("/clawhub/dolls");
  return { ok: true };
}

const rewardUpdateSchema = rewardSchema.extend({ id: z.string().uuid() });

export async function updateRewardAction(raw: unknown): Promise<ActionResult> {
  await authorizeAction();
  const orgId = await clawhubOrgId();
  const parsed = rewardUpdateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  const d = parsed.data;

  const existing = await prisma.clawhubReward.findUnique({
    where: { id: d.id },
    select: { id: true, orgId: true },
  });
  if (!existing || existing.orgId !== orgId) return { ok: false, error: "ไม่พบรางวัล" };

  await prisma.clawhubReward.update({
    where: { id: d.id },
    data: {
      name: d.name,
      imageUrl: emptyToNull(d.imageUrl),
      pointsPrice: d.pointsPrice,
      stock: normStock(d.stock),
      isActive: d.isActive ?? true,
      sortOrder: d.sortOrder,
      sku: emptyToNull(d.sku),
      productId: emptyToNull(d.productId),
    },
  });

  revalidatePath("/clawhub/dolls");
  return { ok: true };
}

const toggleRewardSchema = z.object({ id: z.string().uuid(), isActive: z.boolean() });

export async function toggleRewardActiveAction(raw: unknown): Promise<ActionResult> {
  await authorizeAction();
  const orgId = await clawhubOrgId();
  const parsed = toggleRewardSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };

  const existing = await prisma.clawhubReward.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, orgId: true },
  });
  if (!existing || existing.orgId !== orgId) return { ok: false, error: "ไม่พบรางวัล" };

  await prisma.clawhubReward.update({
    where: { id: parsed.data.id },
    data: { isActive: parsed.data.isActive },
  });

  revalidatePath("/clawhub/dolls");
  return { ok: true };
}

/**
 * Upload a reward image (admin uploads from the form). The client compresses the
 * image and sends the base64 bytes; we decode and putObject SERVER-SIDE — exactly
 * like the customer refund flow (app/api/clawhub/refund). We deliberately do NOT
 * use a browser→R2 presigned PUT here: that path is blocked by R2 bucket CORS on
 * any origin not in the allowlist (e.g. the pooilgroup.com custom domain), which
 * silently broke admin uploads. Server-side upload eliminates that whole class of
 * bugs (same reason app/api/docuflow/upload-proxy exists).
 */
const uploadSchema = z.object({
  base64: z.string().min(1),
  mimeType: z.string().trim().min(1).max(100),
  ext: z.string().trim().max(8).optional(),
});

export async function uploadRewardImageAction(
  raw: unknown,
): Promise<{ ok: true; publicUrl: string; key: string } | { ok: false; error: string }> {
  await authorizeAction();
  const orgId = await clawhubOrgId();
  const parsed = uploadSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  if (!parsed.data.mimeType.startsWith("image/")) {
    return { ok: false, error: "ต้องเป็นรูปภาพเท่านั้น" };
  }

  // Strip an optional data: prefix defensively, then decode.
  const raw64 = parsed.data.base64;
  const b64 = raw64.includes(",") ? raw64.slice(raw64.indexOf(",") + 1) : raw64;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(b64, "base64");
  } catch {
    return { ok: false, error: "รูปไม่ถูกต้อง" };
  }
  if (bytes.length < 100) return { ok: false, error: "รูปไม่ถูกต้อง" };
  if (bytes.length > 5 * 1024 * 1024) {
    return { ok: false, error: "รูปใหญ่เกินไป (เกิน 5MB) — ลองย่อรูปก่อน" };
  }

  const { putObject } = await import("@/lib/clawhub/r2");
  const ext = (parsed.data.ext ?? "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 6) || "jpg";
  const rand = Math.random().toString(36).slice(2, 10);
  const key = `clawhub/rewards/${orgId}/${rand}.${ext}`;
  try {
    const publicUrl = await putObject(key, bytes, parsed.data.mimeType);
    return { ok: true, publicUrl, key };
  } catch (e) {
    console.error("[clawhub.reward-image] R2 upload failed", e);
    return { ok: false, error: "อัปโหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

/**
 * Bulk-create rewards in one shot. The client uploads each image individually via
 * uploadRewardImageAction (small per-call payloads → no body-size limit), then sends
 * only the lightweight metadata (name/imageUrl/points/stock) here. createMany keeps
 * it to a single round-trip. Used by the "เพิ่มหลายตัว" multi-upload flow.
 */
const bulkItemSchema = z.object({
  name: z.string().trim().min(1, "ต้องมีชื่อ").max(120),
  imageUrl: z.string().trim().max(600).optional().or(z.literal("")),
  pointsPrice: z.coerce.number().int().min(1, "ราคาแต้มต้อง ≥ 1"),
  stock: z.union([z.coerce.number().int().min(0), z.literal(""), z.null()]).optional(),
});
const bulkSchema = z.object({ items: z.array(bulkItemSchema).min(1).max(50) });

export async function createRewardsBulkAction(
  raw: unknown,
): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  await authorizeAction();
  const orgId = await clawhubOrgId();
  const parsed = bulkSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };

  await prisma.clawhubReward.createMany({
    data: parsed.data.items.map((d, i) => ({
      orgId,
      name: d.name,
      imageUrl: emptyToNull(d.imageUrl),
      pointsPrice: d.pointsPrice,
      stock: normStock(d.stock),
      isActive: true,
      sortOrder: i,
    })),
  });

  revalidatePath("/clawhub/dolls");
  return { ok: true, created: parsed.data.items.length };
}

/* ───────────────────────── Inbox ───────────────────────── */

const replySchema = z.object({
  conversationId: z.string().uuid(),
  text: z.string().trim().min(1, "พิมพ์ข้อความก่อนส่ง").max(2000),
});

/**
 * Admin replies to a conversation: pushText to the customer's LINE id and log an
 * OUT message. We mark byBot=false (a human admin sent it). If the LINE push fails
 * we still log the attempt but report the failure so the admin knows to retry.
 */
export async function replyConversationAction(raw: unknown): Promise<ActionResult> {
  await authorizeAction();
  const orgId = await clawhubOrgId();
  const parsed = replySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };

  const conv = await prisma.clawhubConversation.findUnique({
    where: { id: parsed.data.conversationId },
    select: { id: true, orgId: true, lineUserId: true },
  });
  if (!conv || conv.orgId !== orgId) return { ok: false, error: "ไม่พบบทสนทนา" };

  const sent = await pushText(conv.lineUserId, parsed.data.text);
  if (!sent.ok) {
    return { ok: false, error: `ส่งข้อความไม่สำเร็จ: ${sent.error ?? "LINE error"}` };
  }

  await prisma.$transaction([
    prisma.clawhubMessage.create({
      data: {
        orgId,
        conversationId: conv.id,
        direction: "OUT",
        kind: "TEXT",
        text: parsed.data.text,
        byBot: false,
      },
    }),
    prisma.clawhubConversation.update({
      where: { id: conv.id },
      data: {
        lastMessageText: parsed.data.text,
        lastMessageAt: new Date(),
      },
    }),
  ]);

  revalidatePath(`/clawhub/inbox/${conv.id}`);
  revalidatePath("/clawhub/inbox");
  return { ok: true };
}

const botToggleSchema = z.object({
  conversationId: z.string().uuid(),
  botEnabled: z.boolean(),
});

/** Toggle "ปิด/เปิดบอทอัตโนมัติ" for a conversation. */
export async function setConversationBotAction(raw: unknown): Promise<ActionResult> {
  await authorizeAction();
  const orgId = await clawhubOrgId();
  const parsed = botToggleSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };

  const conv = await prisma.clawhubConversation.findUnique({
    where: { id: parsed.data.conversationId },
    select: { id: true, orgId: true },
  });
  if (!conv || conv.orgId !== orgId) return { ok: false, error: "ไม่พบบทสนทนา" };

  await prisma.clawhubConversation.update({
    where: { id: conv.id },
    data: { botEnabled: parsed.data.botEnabled },
  });

  revalidatePath(`/clawhub/inbox/${conv.id}`);
  revalidatePath("/clawhub/inbox");
  return { ok: true };
}

/** Mark a conversation read (clear unread badge) — fired when admin opens it. */
export async function markConversationReadAction(
  conversationId: string,
): Promise<ActionResult> {
  await authorizeAction();
  const orgId = await clawhubOrgId();
  const conv = await prisma.clawhubConversation.findUnique({
    where: { id: conversationId },
    select: { id: true, orgId: true, unreadCount: true },
  });
  if (!conv || conv.orgId !== orgId) return { ok: false, error: "ไม่พบบทสนทนา" };
  if (conv.unreadCount === 0) return { ok: true };
  await prisma.clawhubConversation.update({
    where: { id: conv.id },
    data: { unreadCount: 0 },
  });
  revalidatePath("/clawhub/inbox");
  return { ok: true };
}

/* ───────────────────────── helpers ───────────────────────── */

function reasonText(reason?: string): string {
  switch (reason) {
    case "not_found":
      return "ไม่พบคำขอ";
    case "not_pending":
      return "คำขอนี้ถูกตัดสินใจไปแล้ว";
    default:
      return "ดำเนินการไม่สำเร็จ";
  }
}

function firstZodError(err: z.ZodError): string {
  return err.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง";
}
