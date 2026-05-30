// LIFF client helper — load liff sdk on demand, init once.
// Returns user profile if running inside LINE webview.
// In dev/preview without LIFF_ID, returns null gracefully.

"use client";

import type { Liff } from "@line/liff";

let liffPromise: Promise<Liff | null> | null = null;
let lastLiffError: string | null = null;

export function getLiffInitError(): string | null {
  return lastLiffError;
}

export async function getLiff(): Promise<Liff | null> {
  if (typeof window === "undefined") return null;
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) {
    lastLiffError = "env NEXT_PUBLIC_LIFF_ID not set on this deploy";
    return null;
  }
  if (liffPromise) return liffPromise;

  liffPromise = (async () => {
    try {
      const mod = await import("@line/liff");
      const liff = (mod.default ?? mod) as Liff;
      await liff.init({ liffId, withLoginOnExternalBrowser: false });
      lastLiffError = null;
      return liff;
    } catch (err) {
      const msg =
        err instanceof Error
          ? `${err.name}: ${err.message}`
          : typeof err === "object" && err !== null
            ? JSON.stringify(err).slice(0, 240)
            : String(err);
      lastLiffError = `liff.init failed: ${msg} (liffId=${liffId})`;
      console.warn("[liff] init failed", err);
      liffPromise = null;
      return null;
    }
  })();
  return liffPromise;
}

export interface LiffProfile {
  userId: string;
  displayName: string;
  pictureUrl?: string;
  isInClient: boolean;
}

export async function getLiffProfile(): Promise<LiffProfile | null> {
  const liff = await getLiff();
  if (!liff) return null;
  if (!liff.isLoggedIn()) {
    try {
      liff.login();
    } catch {
      /* in preview environments login may fail */
    }
    return null;
  }
  try {
    const p = await liff.getProfile();
    return {
      userId: p.userId,
      displayName: p.displayName,
      pictureUrl: p.pictureUrl,
      isInClient: liff.isInClient(),
    };
  } catch {
    return null;
  }
}

// Get LINE id_token (JWT signed by LINE) for server-side verification.
// Server MUST verify this token via LINE's verify endpoint before trusting
// the userId — never trust profile.userId alone (Agent3 P0 finding).
export async function getLiffIdToken(): Promise<string | null> {
  const liff = await getLiff();
  if (!liff) return null;
  if (!liff.isLoggedIn()) return null;
  try {
    return liff.getIDToken();
  } catch {
    return null;
  }
}

export async function liffClose(): Promise<void> {
  const liff = await getLiff();
  if (!liff) return;
  if (liff.isInClient()) liff.closeWindow();
}
