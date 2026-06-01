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

// ─────────────────────────────────────────────────────────────────────────
// Connection health check — ask the provider directly why messages aren't
// flowing. Read-only (no writes). Surfaces the exact broken link per channel:
//   - token still valid?
//   - (FB) is the page subscribed to OUR app + receiving the "messages" field?
// ─────────────────────────────────────────────────────────────────────────
// NOTE: not exported — "use server" files may only export async functions.
// The client re-declares a matching type locally.
interface ChannelHealth {
  tokenValid: boolean;
  detail: string; // human Thai summary of what's wrong / right
  subscribed?: boolean; // FB only — page subscribed to our app
  hasMessagesField?: boolean; // FB only — subscribed to "messages" events
}

export async function checkChannelHealth(id: string): Promise<ChannelHealth> {
  const session = await requireInboxAdmin();
  const c = await prisma.inboxChannel.findUnique({
    where: { id },
    select: {
      orgId: true,
      platform: true,
      externalId: true,
      accessTokenEnc: true,
    },
  });
  if (!c) throw new Error("ไม่พบช่องทาง");
  if (c.orgId !== session.user.org_id) throw new Error("ไม่มีสิทธิ์");

  const token = decryptToken(c.accessTokenEnc);
  if (!token) {
    return { tokenValid: false, detail: "ยังไม่ได้ใส่ Access Token — ใส่ก่อนถึงจะรับข้อความได้" };
  }

  try {
    if (c.platform === "LINE") {
      const resp = await fetch("https://api.line.me/v2/bot/info", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        return {
          tokenValid: false,
          detail: `Token ใช้ไม่ได้ (LINE ตอบ ${resp.status}) — ออก Channel Access Token ใหม่`,
        };
      }
      return {
        tokenValid: true,
        detail:
          "Token ใช้ได้ ✓ — ถ้ายังไม่เข้าข้อความ ตรวจ Webhook URL ใน LINE Developers Console (Messaging API → Webhook → เปิด Use webhook)",
      };
    }

    // FACEBOOK
    const FB = "https://graph.facebook.com/v19.0";
    const pageId = c.externalId;
    if (!pageId) {
      return {
        tokenValid: false,
        detail: "ไม่มี Page ID (External ID) — ใส่ Page ID ก่อนถึงจะตรวจ subscribe ได้",
      };
    }
    // 1) token valid? (page name)
    const nameResp = await fetch(
      `${FB}/${pageId}?fields=name&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!nameResp.ok) {
      const t = await nameResp.text().catch(() => "");
      return {
        tokenValid: false,
        detail: `Token เพจหมดอายุ/ใช้ไม่ได้ (FB ตอบ ${nameResp.status}) — เชื่อมใหม่ด้วย token ถาวร (System User). ${t.slice(0, 120)}`,
      };
    }
    // 2) subscribed to our app + which fields?
    const appId = process.env.FACEBOOK_APP_ID;
    const subResp = await fetch(
      `${FB}/${pageId}/subscribed_apps?access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!subResp.ok) {
      return {
        tokenValid: true,
        subscribed: false,
        detail: "Token ใช้ได้ ✓ แต่ตรวจการ subscribe ไม่ได้ — token อาจขาดสิทธิ์ pages_manage_metadata",
      };
    }
    const subJson = (await subResp.json()) as {
      data?: Array<{ id?: string; subscribed_fields?: string[] }>;
    };
    const apps = subJson.data ?? [];
    const ours = appId ? apps.find((a) => a.id === appId) : apps[0];
    const subscribed = !!ours;
    const hasMessages = !!ours?.subscribed_fields?.includes("messages");

    if (!subscribed) {
      return {
        tokenValid: true,
        subscribed: false,
        hasMessagesField: false,
        detail: "Token ใช้ได้ ✓ แต่เพจนี้ยังไม่ได้ subscribe เข้าแอปเรา — กด \"เชื่อม/subscribe ใหม่\" (token ตอน import น่าจะหมดอายุ)",
      };
    }
    if (!hasMessages) {
      return {
        tokenValid: true,
        subscribed: true,
        hasMessagesField: false,
        detail: "เพจ subscribe แล้ว แต่ยังไม่รับ field \"messages\" — กด subscribe ใหม่เพื่อเพิ่ม",
      };
    }
    return {
      tokenValid: true,
      subscribed: true,
      hasMessagesField: true,
      detail:
        "พร้อมรับข้อความ ✓ — ถ้าลูกค้าจริงยังไม่เข้า แปลว่าแอปยังอยู่โหมด Development (ต้องทำ App Review + เปิด Live). ข้อความจากแอดมินแอปจะเข้าได้",
    };
  } catch (e) {
    return { tokenValid: false, detail: `ตรวจไม่สำเร็จ: ${(e as Error).message}` };
  }
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
/**
 * Preferred Facebook connect path: the admin pastes ONE user access token
 * (from Graph API Explorer). We:
 *   1. upgrade it to a long-lived (60-day) user token, then
 *   2. enumerate the pages via /me/accounts.
 * Page tokens derived from a long-lived user token are PERMANENT (never
 * expire) — that's the whole point of going through the user token instead
 * of pasting raw page tokens, which would die in ~1h.
 *
 * Returns the page list (with permanent page tokens) for the picker UI to
 * select + tag, then bulkImportFacebookFromPlaintext does the actual save.
 */
export async function fetchFacebookPagesFromUserToken(input: {
  userToken: string;
}): Promise<{
  pages: Array<{ id: string; name: string; access_token: string; category?: string }>;
  longLived: boolean;
}> {
  await requireInboxAdmin();
  const token = input.userToken.trim();
  if (!token) throw new Error("ยังไม่ได้วาง Access Token");

  const { upgradeToLongLived, listUserPages } = await import("./facebook-oauth");

  // Try to upgrade to a long-lived (60-day) user token. If the pasted token
  // is already long-lived FB returns it fine; if it's a page token (wrong
  // kind) the exchange fails and we fall back to using it as-is so we can
  // still show a helpful error from listUserPages.
  let userToken = token;
  let longLived = false;
  try {
    const upgraded = await upgradeToLongLived({ shortLivedToken: token });
    if (upgraded.access_token) {
      userToken = upgraded.access_token;
      longLived = true;
    }
  } catch {
    // keep raw token; listUserPages will surface a clear error if invalid
  }

  const pages = await listUserPages({ userAccessToken: userToken });
  if (pages.length === 0) {
    throw new Error(
      "ดึงเพจไม่ได้ — ตรวจว่า Token มาจากบัญชีที่เป็นแอดมินเพจ และให้สิทธิ์ pages_show_list ครบ",
    );
  }
  return {
    pages: pages.map((p) => ({
      id: p.id,
      name: p.name,
      access_token: p.access_token,
      category: p.category,
    })),
    longLived,
  };
}

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
