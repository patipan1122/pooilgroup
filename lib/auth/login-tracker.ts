// Login attempt tracking + account lock (per CORE_SYSTEM.md §1.2.D)
// 5 failed attempts within window → lock 15 minutes.
// Uses users.failed_login_count + users.locked_until.

import { adminClient } from "../db/server";
import { audit } from "../audit/log";

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export interface LockStatus {
  locked: boolean;
  retryAfterSeconds?: number;
  attemptsRemaining?: number;
}

/**
 * Check if an account is currently locked.
 * Use BEFORE calling Supabase signIn to give an early friendly error.
 */
export async function checkLockStatus(email: string): Promise<LockStatus> {
  const admin = adminClient();
  const { data: user } = await admin
    .from("users")
    .select("id, failed_login_count, locked_until, is_active")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();

  if (!user) return { locked: false };
  if (!user.is_active) return { locked: false };

  if (user.locked_until) {
    const until = new Date(user.locked_until);
    const now = new Date();
    if (until > now) {
      return {
        locked: true,
        retryAfterSeconds: Math.ceil((until.getTime() - now.getTime()) / 1000),
      };
    }
    // Lock expired — clear it
    await admin
      .from("users")
      .update({ locked_until: null, failed_login_count: 0 })
      .eq("id", user.id);
  }

  return {
    locked: false,
    attemptsRemaining: Math.max(0, MAX_ATTEMPTS - user.failed_login_count),
  };
}

/**
 * Record a failed login attempt.
 * Returns the new lock status (may have just been locked).
 */
export async function trackFailedLogin(
  email: string,
  meta: { ipAddress?: string; userAgent?: string },
): Promise<LockStatus> {
  const admin = adminClient();
  const { data: user } = await admin
    .from("users")
    .select("id, org_id, failed_login_count")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();

  // Don't reveal whether email exists — return generic status
  if (!user) return { locked: false, attemptsRemaining: MAX_ATTEMPTS - 1 };

  const newCount = user.failed_login_count + 1;
  const updates: { failed_login_count: number; locked_until?: string | null } = {
    failed_login_count: newCount,
  };

  if (newCount >= MAX_ATTEMPTS) {
    const lockUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
    updates.locked_until = lockUntil.toISOString();
  }

  await admin.from("users").update(updates).eq("id", user.id);

  await audit({
    orgId: user.org_id,
    userId: user.id,
    action: "FAILED_LOGIN",
    resourceType: "user",
    resourceId: user.id,
    diff: { new: { failed_count: newCount, locked: newCount >= MAX_ATTEMPTS } },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  if (newCount >= MAX_ATTEMPTS) {
    return {
      locked: true,
      retryAfterSeconds: LOCK_MINUTES * 60,
    };
  }
  return {
    locked: false,
    attemptsRemaining: MAX_ATTEMPTS - newCount,
  };
}

/**
 * Reset the lock counter on a successful login.
 * Also writes a user_sessions row + audit LOGIN.
 */
export async function recordSuccessfulLogin(
  authUserId: string,
  meta: { ipAddress?: string; userAgent?: string },
): Promise<{ sessionId: string } | null> {
  const admin = adminClient();
  const { data: user } = await admin
    .from("users")
    .select("id, org_id, failed_login_count, locked_until")
    .eq("id", authUserId)
    .maybeSingle();

  if (!user) return null;

  const now = new Date().toISOString();
  await admin
    .from("users")
    .update({
      failed_login_count: 0,
      locked_until: null,
      last_login_at: now,
    })
    .eq("id", user.id);

  // Create session row
  const sessionId = crypto.randomUUID();
  await admin.from("user_sessions").insert({
    id: sessionId,
    org_id: user.org_id,
    user_id: user.id,
    ip_address: meta.ipAddress ?? null,
    user_agent: meta.userAgent ?? null,
    device: parseDevice(meta.userAgent),
    login_at: now,
    last_active_at: now,
  });

  await audit({
    orgId: user.org_id,
    userId: user.id,
    action: "LOGIN",
    resourceType: "user",
    resourceId: user.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { sessionId };
}

/**
 * Mark a session as logged out + audit LOGOUT.
 * If sessionId is omitted, marks the user's most recent active session.
 */
export async function recordLogout(
  authUserId: string,
  sessionId: string | null,
  meta: { ipAddress?: string; userAgent?: string },
): Promise<void> {
  const admin = adminClient();
  const { data: user } = await admin
    .from("users")
    .select("id, org_id")
    .eq("id", authUserId)
    .maybeSingle();
  if (!user) return;

  const now = new Date().toISOString();

  if (sessionId) {
    await admin
      .from("user_sessions")
      .update({ logout_at: now })
      .eq("id", sessionId)
      .eq("user_id", user.id);
  } else {
    // Mark most recent active session
    const { data: latest } = await admin
      .from("user_sessions")
      .select("id")
      .eq("user_id", user.id)
      .is("logout_at", null)
      .order("login_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest) {
      await admin
        .from("user_sessions")
        .update({ logout_at: now })
        .eq("id", latest.id);
    }
  }

  await audit({
    orgId: user.org_id,
    userId: user.id,
    action: "LOGOUT",
    resourceType: "user",
    resourceId: user.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

/**
 * Tiny User-Agent parser — friendly device label like "Chrome on macOS".
 * Good enough; no dependency.
 */
export function parseDevice(ua?: string): string | null {
  if (!ua) return null;
  let browser = "Browser";
  if (/edg\//i.test(ua)) browser = "Edge";
  else if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) browser = "Chrome";
  else if (/firefox\//i.test(ua)) browser = "Firefox";
  else if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) browser = "Safari";
  else if (/opera|opr\//i.test(ua)) browser = "Opera";

  let os = "Unknown OS";
  if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/mac os x|macintosh/i.test(ua)) os = "macOS";
  else if (/windows/i.test(ua)) os = "Windows";
  else if (/linux/i.test(ua)) os = "Linux";

  return `${browser} · ${os}`;
}

export function getMetaFromRequest(req: Request): {
  ipAddress?: string;
  userAgent?: string;
} {
  const ua = req.headers.get("user-agent") ?? undefined;
  // Cloudflare / Vercel forward client IP via these headers
  const ip =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    undefined;
  return { ipAddress: ip, userAgent: ua };
}
