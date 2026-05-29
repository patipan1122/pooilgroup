"use server";

// Inbox channel CRUD — connect LINE OAs + Facebook Pages so customer DMs land
// in /inbox. Mirrors the Recruit channel pattern (encrypted secrets, per-channel
// webhook signature) but adds:
//   - businessTag : which business this channel belongs to (chairops/pooil/…)
//   - botEnabled  : turn the AI auto-reply bot ON (only for bot-capable business)
//
// SECURITY:
// - access token + provider signing secret stored encrypted (channel-crypto)
// - webhook signature verified per request in the route handlers
// - cross-org access blocked by org_id match (no super_admin bypass on write)

import { revalidatePath } from "next/cache";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { encryptToken, decryptToken } from "./crypto";
import { isBotCapable } from "./business";

export type InboxPlatform = "LINE" | "FACEBOOK";

async function requireInboxAdmin() {
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) throw new Error("ไม่มีสิทธิ์");
  return session;
}

export async function createChannel(input: {
  platform: InboxPlatform;
  displayName: string;
  businessTag?: string;
  externalId?: string;
  accessToken?: string;
  providerSecret?: string;
}) {
  const session = await requireInboxAdmin();

  const displayName = input.displayName.trim();
  if (!displayName) throw new Error("ตั้งชื่อเรียกของช่องทาง");

  // FB needs a verify token we choose so FB can echo it back when confirming
  // webhook ownership. Generate + store encrypted.
  const verifyToken =
    input.platform === "FACEBOOK" ? crypto.randomBytes(24).toString("hex") : null;
  const verifyTokenEnc = verifyToken ? encryptToken(verifyToken) : null;

  const providerSecretEnc = input.providerSecret?.trim()
    ? encryptToken(input.providerSecret.trim())
    : null;
  const accessTokenEnc = input.accessToken?.trim()
    ? encryptToken(input.accessToken.trim())
    : null;

  const status = providerSecretEnc && accessTokenEnc ? "active" : "setup";

  const channel = await prisma.inboxChannel.create({
    data: {
      orgId: session.user.org_id,
      platform: input.platform,
      displayName,
      businessTag: input.businessTag?.trim() || null,
      externalId: input.externalId?.trim() || null,
      accessTokenEnc,
      webhookSecret: providerSecretEnc,
      botEnabled: false,
      status,
      metadata: verifyTokenEnc ? { verifyTokenEnc } : undefined,
      createdById: session.user.id,
    },
    select: { id: true },
  });

  revalidatePath("/inbox/settings/channels");
  return { ok: true, id: channel.id, verifyToken };
}

export async function listChannels() {
  const session = await requireInboxAdmin();
  const channels = await prisma.inboxChannel.findMany({
    where: { orgId: session.user.org_id },
    orderBy: [{ platform: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      platform: true,
      displayName: true,
      businessTag: true,
      externalId: true,
      botEnabled: true,
      status: true,
      lastEventAt: true,
      createdAt: true,
      webhookSecret: true,
      accessTokenEnc: true,
      metadata: true,
    },
  });
  return channels.map((c) => {
    const md = (c.metadata ?? {}) as { verifyTokenEnc?: string };
    return {
      id: c.id,
      platform: c.platform as InboxPlatform,
      displayName: c.displayName,
      businessTag: c.businessTag,
      externalId: c.externalId,
      botEnabled: c.botEnabled,
      botCapable: isBotCapable(c.businessTag),
      status: c.status,
      lastEventAt: c.lastEventAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      hasProviderSecret: !!c.webhookSecret,
      hasAccessToken: !!c.accessTokenEnc,
      verifyToken: md.verifyTokenEnc ? decryptToken(md.verifyTokenEnc) : null,
    };
  });
}

export async function updateChannel(
  id: string,
  input: {
    displayName?: string;
    businessTag?: string;
    externalId?: string;
    providerSecret?: string;
    accessToken?: string;
  },
) {
  const session = await requireInboxAdmin();
  const existing = await prisma.inboxChannel.findUnique({
    where: { id },
    select: { orgId: true, accessTokenEnc: true, webhookSecret: true, botEnabled: true, businessTag: true },
  });
  if (!existing) throw new Error("ไม่พบช่องทาง");
  if (existing.orgId !== session.user.org_id) throw new Error("ไม่มีสิทธิ์");

  const data: Record<string, unknown> = {};
  if (input.displayName?.trim()) data.displayName = input.displayName.trim();
  if (input.businessTag !== undefined) {
    const tag = input.businessTag.trim() || null;
    data.businessTag = tag;
    // If the new business can't run a bot, force the bot off.
    if (existing.botEnabled && !isBotCapable(tag)) data.botEnabled = false;
  }
  if (input.externalId !== undefined) data.externalId = input.externalId.trim() || null;
  if (input.providerSecret?.trim()) data.webhookSecret = encryptToken(input.providerSecret.trim());
  if (input.accessToken?.trim()) data.accessTokenEnc = encryptToken(input.accessToken.trim());

  const nextProviderSecret = data.webhookSecret ?? existing.webhookSecret;
  const nextAccessToken = data.accessTokenEnc ?? existing.accessTokenEnc;
  data.status = nextProviderSecret && nextAccessToken ? "active" : "setup";

  await prisma.inboxChannel.update({ where: { id }, data });
  revalidatePath("/inbox/settings/channels");
  return { ok: true };
}

export async function setChannelBotEnabled(id: string, enabled: boolean) {
  const session = await requireInboxAdmin();
  const existing = await prisma.inboxChannel.findUnique({
    where: { id },
    select: { orgId: true, businessTag: true },
  });
  if (!existing) throw new Error("ไม่พบช่องทาง");
  if (existing.orgId !== session.user.org_id) throw new Error("ไม่มีสิทธิ์");
  if (enabled && !isBotCapable(existing.businessTag)) {
    throw new Error("บอทเปิดได้เฉพาะธุรกิจที่รองรับ (เช่น เก้าอี้นวด)");
  }
  await prisma.inboxChannel.update({ where: { id }, data: { botEnabled: enabled } });
  revalidatePath("/inbox/settings/channels");
  return { ok: true };
}

export async function deleteChannel(id: string) {
  const session = await requireInboxAdmin();
  const existing = await prisma.inboxChannel.findUnique({
    where: { id },
    select: { orgId: true },
  });
  if (!existing) throw new Error("ไม่พบช่องทาง");
  if (existing.orgId !== session.user.org_id) throw new Error("ไม่มีสิทธิ์");
  await prisma.inboxChannel.delete({ where: { id } });
  revalidatePath("/inbox/settings/channels");
  return { ok: true };
}
