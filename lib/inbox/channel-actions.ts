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

/**
 * Variant of bulkCreateFacebookChannels that takes PLAINTEXT page access
 * tokens (pasted from Graph API Explorer JSON).  Encrypts them on the
 * server boundary then dispatches to the same upsert+subscribe logic.
 * Used by /inbox/settings/channels/facebook-paste when OAuth dialog is
 * blocked (shared subdomain etc.).
 */
export async function bulkImportFacebookFromPlaintext(input: {
  pages: Array<{
    id: string;
    name: string;
    accessToken: string; // plaintext from /me/accounts
    businessTag: string;
  }>;
}): Promise<{ created: number; updated: number; subscribed: number; errors: string[] }> {
  await requireInboxAdmin();
  const encrypted = input.pages.map((p) => ({
    id: p.id,
    name: p.name,
    accessTokenEnc: encryptToken(p.accessToken),
    businessTag: p.businessTag,
  }));
  return bulkCreateFacebookChannels({ pages: encrypted });
}

/**
 * Bulk-import Facebook Pages from the OAuth flow.  Each entry already has
 * the page access token encrypted (by the callback).  For each page we:
 *   - upsert an InboxChannel (idempotent on org × externalId)
 *   - subscribe the page to the app's webhook so messages route to us
 *
 * Returns counts so the picker UI can toast a summary.
 */
export async function bulkCreateFacebookChannels(input: {
  pages: Array<{
    id: string; // FB Page ID — stored as externalId
    name: string;
    accessTokenEnc: string; // already encrypted by the OAuth callback
    businessTag: string;
  }>;
}): Promise<{ created: number; updated: number; subscribed: number; errors: string[] }> {
  // Clear the short-lived OAuth cookie once we've consumed its page list so
  // a back-button revisit doesn't re-submit stale tokens (audit FB-003).
  // Done at the top so it fires even if the loop below throws midway.
  const { clearOauthCookie } = await import("./facebook-import");
  await clearOauthCookie().catch(() => {});
  return bulkCreateFacebookChannelsInternal(input);
}

async function bulkCreateFacebookChannelsInternal(input: {
  pages: Array<{
    id: string;
    name: string;
    accessTokenEnc: string;
    businessTag: string;
  }>;
}): Promise<{ created: number; updated: number; subscribed: number; errors: string[] }> {
  const session = await requireInboxAdmin();
  const errors: string[] = [];
  let created = 0;
  let updated = 0;
  let subscribed = 0;

  // Dynamic import keeps the heavy fetch logic out of unrelated bundles.
  const { subscribePageWebhook } = await import("./facebook-oauth");

  for (const p of input.pages) {
    if (!p.id || !p.name || !p.accessTokenEnc) continue;
    try {
      const existing = await prisma.inboxChannel.findFirst({
        where: {
          orgId: session.user.org_id,
          platform: "FACEBOOK",
          externalId: p.id,
        },
        select: { id: true, metadata: true },
      });
      if (existing) {
        await prisma.inboxChannel.update({
          where: { id: existing.id },
          data: {
            displayName: p.name,
            businessTag: p.businessTag,
            accessTokenEnc: p.accessTokenEnc,
            status: "active",
          },
        });
        updated++;
      } else {
        // Per-channel verifyToken is only used for the legacy per-channel
        // route; the new app-level webhook uses FACEBOOK_APP_SECRET for
        // signature verification.  Still mint one for the metadata blob.
        const verifyToken = crypto.randomBytes(24).toString("hex");
        await prisma.inboxChannel.create({
          data: {
            orgId: session.user.org_id,
            platform: "FACEBOOK",
            displayName: p.name,
            businessTag: p.businessTag,
            externalId: p.id,
            accessTokenEnc: p.accessTokenEnc,
            // No per-page webhook secret — app-level webhook verifies with
            // FACEBOOK_APP_SECRET instead.
            webhookSecret: null,
            botEnabled: false,
            status: "active",
            metadata: { verifyTokenEnc: encryptToken(verifyToken) },
            createdById: session.user.id,
          },
        });
        created++;
      }

      // Subscribe the page so its events flow to the app webhook.  Best
      // effort — failure here just means CEO needs to retry; the channel
      // already exists so the next attempt is cheap.
      try {
        const plainToken = decryptToken(p.accessTokenEnc);
        if (plainToken) {
          await subscribePageWebhook({
            pageId: p.id,
            pageAccessToken: plainToken,
          });
          subscribed++;
        }
      } catch (e) {
        errors.push(`${p.name}: subscribe failed — ${(e as Error).message}`);
      }
    } catch (e) {
      errors.push(`${p.name}: ${(e as Error).message}`);
    }
  }

  revalidatePath("/inbox/settings/channels");
  return { created, updated, subscribed, errors };
}
