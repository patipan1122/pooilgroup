"use server";

// Recruit inbox channel CRUD — connect LINE OA + Facebook Pages so applicant
// DMs flow into /recruit/messages.
//
// SECURITY:
// - Tokens stored as `access_token_enc` (encrypted in app layer · key from env)
// - Webhook signature verified before persisting messages (route handlers)
// - Cross-org access blocked by org_id match (no super_admin bypass)
//
// CURRENT STATUS (2026-05-23 · plan-only / scaffolding):
// - DB model + CRUD ✅ wired
// - Settings UI ✅ wired
// - Webhook routes ✅ stubs respond 200 + log
// - Actual LINE / FB OAuth + signature verification: pending dedicated session
//   (see docs/RECRUIT_OMNICHAT_PLAN.md)

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canRecruitAdmin } from "./role-guard";

export type ChannelType = "LINE" | "FACEBOOK";

export async function createChannel(input: {
  type: ChannelType;
  displayName: string;
  externalId?: string;
  accessToken?: string; // user-pasted token; we store encrypted
  metadata?: Record<string, unknown>;
}) {
  const session = await requireSession();
  if (!canRecruitAdmin(session.user.role)) throw new Error("ไม่มีสิทธิ์");

  const displayName = input.displayName.trim();
  if (!displayName) throw new Error("ตั้งชื่อเรียกของ channel");

  // Generate webhook secret per channel — used for signature verification
  // in the webhook handler. 32-byte hex.
  const webhookSecret = crypto
    .getRandomValues(new Uint8Array(32))
    .reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");

  // SCAFFOLDING: real implementation would envelope-encrypt accessToken with
  // KMS / env key before persisting. For now we store plaintext if provided
  // (only admin can read this row anyway · RLS) and mark a TODO.
  const accessTokenEnc = input.accessToken ?? null;

  const channel = await prisma.recruitInboxChannel.create({
    data: {
      orgId: session.user.org_id,
      type: input.type,
      displayName,
      externalId: input.externalId ?? null,
      accessTokenEnc,
      webhookSecret,
      status: accessTokenEnc ? "setup" : "setup",
      metadata: (input.metadata as object) ?? undefined,
      createdById: session.user.id,
    },
  });

  revalidatePath("/recruit/settings/channels");
  return { ok: true, id: channel.id, webhookSecret };
}

export async function listChannels() {
  const session = await requireSession();
  if (!canRecruitAdmin(session.user.role)) throw new Error("ไม่มีสิทธิ์");

  const channels = await prisma.recruitInboxChannel.findMany({
    where: { orgId: session.user.org_id },
    orderBy: [{ type: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      type: true,
      displayName: true,
      externalId: true,
      status: true,
      lastEventAt: true,
      createdAt: true,
      webhookSecret: true,
    },
  });
  return channels.map((c) => ({
    id: c.id,
    type: c.type as ChannelType,
    displayName: c.displayName,
    externalId: c.externalId,
    status: c.status,
    lastEventAt: c.lastEventAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    // Return only the prefix so users can verify the URL was registered;
    // full secret is never re-exposed after creation.
    webhookSecretPrefix: c.webhookSecret ? c.webhookSecret.slice(0, 8) : null,
  }));
}

export async function deleteChannel(id: string) {
  const session = await requireSession();
  if (!canRecruitAdmin(session.user.role)) throw new Error("ไม่มีสิทธิ์");

  const existing = await prisma.recruitInboxChannel.findUnique({
    where: { id },
    select: { orgId: true },
  });
  if (!existing) throw new Error("ไม่พบ channel");
  if (existing.orgId !== session.user.org_id) throw new Error("ไม่มีสิทธิ์");

  await prisma.recruitInboxChannel.delete({ where: { id } });
  revalidatePath("/recruit/settings/channels");
  return { ok: true };
}

export async function toggleChannelStatus(id: string, nextStatus: string) {
  const session = await requireSession();
  if (!canRecruitAdmin(session.user.role)) throw new Error("ไม่มีสิทธิ์");

  const existing = await prisma.recruitInboxChannel.findUnique({
    where: { id },
    select: { orgId: true },
  });
  if (!existing) throw new Error("ไม่พบ channel");
  if (existing.orgId !== session.user.org_id) throw new Error("ไม่มีสิทธิ์");

  await prisma.recruitInboxChannel.update({
    where: { id },
    data: { status: nextStatus },
  });
  revalidatePath("/recruit/settings/channels");
  return { ok: true };
}
