"use server";

// Recruit inbox channel CRUD — connect LINE OA + Facebook Pages so applicant
// DMs flow into /recruit/messages.
//
// SECURITY:
// - Tokens (access + signing secret) stored encrypted via channel-crypto.ts
// - Webhook signature verified per request inside route handlers
// - Cross-org access blocked by org_id match (no super_admin bypass)
//
// SECRETS WE STORE (per channel, both encrypted):
// - webhookSecret    = provider's signing key (LINE Channel Secret / FB App Secret)
// - accessTokenEnc   = long-lived bot token for outbound replies
// - metadata.verifyToken = our generated random (FB only · for hub.challenge step)

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canRecruitAdmin } from "./role-guard";
import { encryptToken, decryptToken } from "./channel-crypto";
import crypto from "node:crypto";

export type ChannelType = "LINE" | "FACEBOOK";

export async function createChannel(input: {
  type: ChannelType;
  displayName: string;
  externalId?: string;
  accessToken?: string; // long-lived bot token (LINE Channel Access Token / FB Page Access Token)
  providerSecret?: string; // LINE Channel Secret / FB App Secret · used for HMAC verify
  metadata?: Record<string, unknown>;
}) {
  const session = await requireSession();
  if (!canRecruitAdmin(session.user.role)) throw new Error("ไม่มีสิทธิ์");

  const displayName = input.displayName.trim();
  if (!displayName) throw new Error("ตั้งชื่อเรียกของ channel");

  // FB requires a "verify token" we choose so FB can echo it back when
  // confirming webhook ownership. Generate one we'll show to admin.
  // P2-11: store encrypted at rest (admin sees decrypted value in UI · webhook decrypts before compare).
  const verifyToken =
    input.type === "FACEBOOK"
      ? crypto.randomBytes(24).toString("hex")
      : null;
  const verifyTokenEnc = verifyToken ? encryptToken(verifyToken) : null;

  // Encrypt secrets at rest. Empty strings stored as null so prod can detect
  // partial setup and flag "missing token" state.
  const providerSecretEnc = input.providerSecret?.trim()
    ? encryptToken(input.providerSecret.trim())
    : null;
  const accessTokenEnc = input.accessToken?.trim()
    ? encryptToken(input.accessToken.trim())
    : null;

  // Status: active only when BOTH secrets present (verify + reply ready)
  const status = providerSecretEnc && accessTokenEnc ? "active" : "setup";

  const channel = await prisma.recruitInboxChannel.create({
    data: {
      orgId: session.user.org_id,
      type: input.type,
      displayName,
      externalId: input.externalId?.trim() || null,
      accessTokenEnc,
      webhookSecret: providerSecretEnc, // repurposed — was random scaffolding
      status,
      metadata: {
        ...(input.metadata ?? {}),
        ...(verifyTokenEnc ? { verifyTokenEnc } : {}),
      } as object,
      createdById: session.user.id,
    },
  });

  revalidatePath("/recruit/settings/channels");
  return {
    ok: true,
    id: channel.id,
    verifyToken, // FB only · admin copies this into FB App "Verify Token" field
  };
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
      accessTokenEnc: true,
      metadata: true,
    },
  });
  return channels.map((c) => {
    // P2-11: read either new encrypted `verifyTokenEnc` or legacy plaintext `verifyToken`.
    const md = (c.metadata ?? {}) as { verifyToken?: string; verifyTokenEnc?: string };
    const verifyToken = md.verifyTokenEnc
      ? decryptToken(md.verifyTokenEnc)
      : (md.verifyToken ?? null);
    return {
      id: c.id,
      type: c.type as ChannelType,
      displayName: c.displayName,
      externalId: c.externalId,
      status: c.status,
      lastEventAt: c.lastEventAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      hasProviderSecret: !!c.webhookSecret,
      hasAccessToken: !!c.accessTokenEnc,
      verifyToken, // FB only · admin pastes this into FB App webhook config
    };
  });
}

/** Re-issue a provider secret or access token after admin gets a fresh value from LINE/FB. */
export async function updateChannelSecrets(
  id: string,
  input: {
    providerSecret?: string;
    accessToken?: string;
    externalId?: string;
  },
) {
  const session = await requireSession();
  if (!canRecruitAdmin(session.user.role)) throw new Error("ไม่มีสิทธิ์");

  const existing = await prisma.recruitInboxChannel.findUnique({
    where: { id },
    select: { orgId: true, accessTokenEnc: true, webhookSecret: true },
  });
  if (!existing) throw new Error("ไม่พบ channel");
  if (existing.orgId !== session.user.org_id) throw new Error("ไม่มีสิทธิ์");

  const data: Record<string, unknown> = {};
  if (input.providerSecret?.trim()) {
    data.webhookSecret = encryptToken(input.providerSecret.trim());
  }
  if (input.accessToken?.trim()) {
    data.accessTokenEnc = encryptToken(input.accessToken.trim());
  }
  if (input.externalId !== undefined) {
    data.externalId = input.externalId.trim() || null;
  }

  // Re-evaluate status — active only when both secrets present
  const nextProviderSecret = data.webhookSecret ?? existing.webhookSecret;
  const nextAccessToken = data.accessTokenEnc ?? existing.accessTokenEnc;
  data.status = nextProviderSecret && nextAccessToken ? "active" : "setup";

  await prisma.recruitInboxChannel.update({ where: { id }, data });
  revalidatePath("/recruit/settings/channels");
  return { ok: true };
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
