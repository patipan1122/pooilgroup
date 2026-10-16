// Telegram Mini App `initData` validation — SECURITY CRITICAL.
// ────────────────────────────────────────────────────────────────────
// This is the ONLY thing standing between "anyone who can reach this
// URL" and "signs documents as a specific Pooilgroup user." Every
// Mini-App-facing API route (app/api/telegram/webapp/**) MUST call
// `resolveTelegramWebAppUser()` before touching any data — there is no
// cookie/session fallback for this surface by design.
//
// This file implements Telegram's OFFICIAL Mini App auth pattern
// ("Validating data received via the Mini App", Telegram Bot API docs).
// Do NOT "simplify" this into reading `initDataUnsafe` fields directly,
// trusting a client-supplied user id, or skipping the HMAC/timing-safe
// compare — those are exactly the shortcuts that turn this into an
// auth bypass. If you're reading this because you want to change the
// algorithm below, re-read the official docs first; every step here was
// copied from them intentionally, including the exact byte-for-byte
// data_check_string construction.
//
// Algorithm (verified against Telegram's docs):
//   1. Client sends the RAW `initData` string via the
//      `X-Telegram-Init-Data` request header on every Mini-App API call
//      (never `initDataUnsafe` — that's client-side-parsed and
//      unsigned from the server's point of view).
//   2. Parse `initData` as a URL query string. Pull out + remove `hash`
//      — that's the signature to verify against.
//   3. data_check_string = every REMAINING field as `key=value`, sorted
//      alphabetically by key, joined with "\n" (a real newline byte,
//      not the two-character string "\\n").
//   4. secret_key = HMAC_SHA256(key="WebAppData", data=<bot token>)
//   5. computed_hash = HMAC_SHA256(key=secret_key, data=data_check_string),
//      hex-encoded.
//   6. Compare computed_hash to the `hash` field using a CONSTANT-TIME
//      comparison (crypto.timingSafeEqual) — reject on any mismatch,
//      including length mismatch (timingSafeEqual throws on unequal
//      lengths, so that's checked explicitly first).
//   7. Reject if `auth_date` is older than 24h (replay protection) or
//      implausibly in the future (clock-skew guard).
//   8. Only then: parse the JSON-encoded `user` field to get the
//      Telegram user's numeric `id`, and resolve which Pooilgroup
//      account this is via `users.telegram_user_id` — the EXACT SAME
//      pairing mechanism already live in
//      app/api/telegram/webhook/route.ts's `handlePairingStart`
//      (set by the "/start <token>" deep-link flow). No separate
//      linking mechanism is invented here.
// ────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import { adminClient } from "@/lib/db/server";
import type { DbUser } from "@/lib/auth/session";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Replay window — initData older than this is rejected even if the
// signature is valid. 24h per the task spec; Telegram itself doesn't
// expire initData, so this bound is ours to enforce.
const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;
// Small forward clock-skew allowance (server clock slightly behind the
// client/Telegram server that stamped auth_date) — NOT a security hole,
// just avoids false rejections from real-world clock drift.
const MAX_FUTURE_SKEW_SECONDS = 60;

export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface VerifiedInitData {
  user: TelegramWebAppUser;
  authDate: number;
}

/**
 * Verify an `initData` string's HMAC signature + `auth_date` freshness.
 * Pure function, no DB/network access — safe to unit-test directly (see
 * scratchpad test script referenced in the PR description).
 *
 * Returns null on ANY failure (bad signature, expired, malformed, bot
 * token not configured). Callers must treat every failure case
 * identically (generic rejection) — never report WHICH check failed, to
 * avoid giving an attacker a signature-forging oracle.
 */
export function verifyInitData(initData: string): VerifiedInitData | null {
  if (!BOT_TOKEN) {
    console.error(
      "[telegram/webapp-auth] TELEGRAM_BOT_TOKEN not set — rejecting all Mini App requests",
    );
    return null;
  }
  if (!initData || typeof initData !== "string") return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }

  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete("hash");

  // Step 3: data_check_string. Sort by key (not insertion order — Telegram
  // sends fields in an arbitrary order), format "key=value", join with a
  // real newline byte (0x0A).
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  // Step 4-5: secret_key = HMAC_SHA256("WebAppData", bot_token), then
  // computed_hash = HMAC_SHA256(secret_key, data_check_string).
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();
  const computedHashHex = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  // Step 6: constant-time compare. timingSafeEqual throws on length
  // mismatch rather than returning false, so guard that explicitly first
  // (both are hex SHA-256 digests = 64 chars when well-formed, but never
  // assume attacker input is well-formed).
  const hashBuf = Buffer.from(hash, "hex");
  const computedBuf = Buffer.from(computedHashHex, "hex");
  if (hashBuf.length !== computedBuf.length) return null;
  if (!crypto.timingSafeEqual(hashBuf, computedBuf)) return null;

  // Step 7: auth_date freshness / replay protection.
  const authDateRaw = params.get("auth_date");
  const authDate = authDateRaw ? Number.parseInt(authDateRaw, 10) : NaN;
  if (!Number.isFinite(authDate)) return null;
  const ageSeconds = Date.now() / 1000 - authDate;
  if (ageSeconds > MAX_AUTH_AGE_SECONDS) return null; // too old — replay
  if (ageSeconds < -MAX_FUTURE_SKEW_SECONDS) return null; // implausibly future

  // Step 8 (partial — just parsing, DB lookup happens in the caller):
  // `user` is a JSON-encoded object Telegram includes alongside the
  // signed fields (it's itself covered by the hash above, since it's one
  // of the "remaining fields" hashed in step 3 — tampering with it
  // invalidates the signature).
  const userJson = params.get("user");
  if (!userJson) return null;
  let user: TelegramWebAppUser;
  try {
    user = JSON.parse(userJson);
  } catch {
    return null;
  }
  if (!user || typeof user.id !== "number" || !Number.isFinite(user.id)) {
    return null;
  }

  return { user, authDate };
}

export interface ResolvedWebAppUser {
  id: string;
  orgId: string;
  name: string;
  role: DbUser["role"];
  telegramUserId: string;
}

export type ResolveWebAppResult =
  | { ok: true; user: ResolvedWebAppUser }
  | { ok: false; reason: "invalid" | "not_connected" };

/**
 * Full request-level resolution for a Mini-App-facing API route:
 *   1. Pull `X-Telegram-Init-Data` off the request.
 *   2. Verify it (see verifyInitData above) — fresh on EVERY request,
 *      deliberately. There is no session/cookie for this surface; the
 *      initData validation itself IS the auth, and it's cheap + stateless
 *      enough to redo every time rather than caching a "logged in" state.
 *   3. Resolve the verified Telegram user id to a Pooilgroup `users` row
 *      via `telegram_user_id` — same pairing table/column the webhook's
 *      `handlePairingStart` already writes to via "/start <token>".
 *
 * `reason: "not_connected"` (valid Telegram signature, but this Telegram
 * account isn't paired to any active Pooilgroup user yet) is a distinct,
 * expected case — callers must surface a "connect your account first" UI
 * for it, not a generic error. `reason: "invalid"` covers everything else
 * (missing header, bad signature, expired, malformed) and should map to a
 * flat 401 — never leak which sub-check failed.
 */
export async function resolveTelegramWebAppUser(
  req: Request,
): Promise<ResolveWebAppResult> {
  const initData = req.headers.get("x-telegram-init-data");
  if (!initData) return { ok: false, reason: "invalid" };

  const verified = verifyInitData(initData);
  if (!verified) return { ok: false, reason: "invalid" };

  const admin = adminClient();
  const telegramUserId = verified.user.id.toString();
  const { data } = await admin
    .from("users")
    .select("id, org_id, name, role")
    .eq("telegram_user_id", telegramUserId)
    .eq("is_active", true)
    .maybeSingle();

  if (!data) return { ok: false, reason: "not_connected" };

  return {
    ok: true,
    user: {
      id: data.id as string,
      orgId: data.org_id as string,
      name: data.name as string,
      role: data.role as DbUser["role"],
      telegramUserId,
    },
  };
}
