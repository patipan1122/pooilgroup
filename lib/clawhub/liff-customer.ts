"use client";

// ClawHub customer LIFF loader — RESILIENT init for the JOLLY PLAY mini-app.
//
// Why a dedicated loader (not the shared lib/line/liff-client): the shared one
// calls liff.init() ONCE and gives up on failure. On the iOS LINE in-app webview
// liff.init throws "TypeError: Load failed" intermittently — either the bundled
// `import("@line/liff")` chunk fails to load, or a freshly-created LIFF app's
// metadata hasn't propagated yet. ledger/chairops survive this via an OAuth
// fallback that mints a Pool session — but ClawHub customers are NOT Pool users,
// so we instead make init itself robust:
//   1. load the SDK via npm import, falling back to LINE's CDN <script>
//      (https://static.line-scdn.net/liff/edge/2/sdk.js — allowed by our CSP),
//   2. retry liff.init a few times with backoff (covers transient Load-failed +
//      propagation lag right after the LIFF was created).
// Isolated to ClawHub — leaves every other module's LIFF untouched.

import type { Liff } from "@line/liff";

const CDN_SDK = "https://static.line-scdn.net/liff/edge/2/sdk.js";

let cachedLiff: Liff | null = null;
let initPromise: Promise<Liff | null> | null = null;
let lastError: string | null = null;

export function clawhubLiffError(): string | null {
  return lastError;
}

function windowLiff(): Liff | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { liff?: Liff };
  return w.liff && typeof w.liff.init === "function" ? w.liff : null;
}

function loadFromCdn(): Promise<Liff | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(null);
      return;
    }
    const existing = windowLiff();
    if (existing) {
      resolve(existing);
      return;
    }
    const prior = document.querySelector<HTMLScriptElement>(
      "script[data-clawhub-liff-sdk]",
    );
    const onReady = () => resolve(windowLiff());
    if (prior) {
      prior.addEventListener("load", onReady, { once: true });
      prior.addEventListener("error", () => resolve(null), { once: true });
      // If it already loaded before this caller attached, windowLiff() is set.
      if (windowLiff()) resolve(windowLiff());
      return;
    }
    const s = document.createElement("script");
    s.src = CDN_SDK;
    s.async = true;
    s.dataset.clawhubLiffSdk = "1";
    s.addEventListener("load", onReady, { once: true });
    s.addEventListener("error", () => resolve(null), { once: true });
    document.head.appendChild(s);
  });
}

async function loadSdk(): Promise<Liff | null> {
  // Prefer the bundled npm package; fall back to the CDN <script> if the dynamic
  // import chunk fails to load (a common iOS-webview "Load failed" cause).
  try {
    const mod = await import("@line/liff");
    const liff = (mod.default ?? mod) as Liff;
    if (liff && typeof liff.init === "function") return liff;
  } catch {
    /* fall through to CDN */
  }
  return loadFromCdn();
}

/** Boot the ClawHub LIFF (with SDK-load fallback + init retry). Caches one init. */
export async function getClawhubLiff(liffId?: string): Promise<Liff | null> {
  if (typeof window === "undefined") return null;
  if (!liffId) {
    lastError = "ยังไม่ได้ตั้งค่า LIFF ID (env NEXT_PUBLIC_CLAWHUB_LIFF_ID)";
    return null;
  }
  if (cachedLiff) return cachedLiff;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const liff = await loadSdk();
    if (!liff) {
      lastError = "โหลดตัว LIFF SDK ไม่สำเร็จ (เครือข่าย/เบราว์เซอร์)";
      initPromise = null;
      return null;
    }
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await liff.init({ liffId, withLoginOnExternalBrowser: true });
        lastError = null;
        cachedLiff = liff;
        return liff;
      } catch (err) {
        lastErr = err;
        // Backoff: 500ms, 1000ms — covers transient Load-failed + LIFF metadata
        // propagation right after creation.
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    const msg =
      lastErr instanceof Error
        ? `${lastErr.name}: ${lastErr.message}`
        : String(lastErr);
    lastError = `liff.init failed: ${msg} (liffId=${liffId})`;
    initPromise = null; // allow a later manual retry (reload) to try again
    return null;
  })();
  return initPromise;
}

export type ClawhubLiffProfile = {
  userId: string;
  displayName: string;
  pictureUrl?: string;
};

/** Profile if logged in; triggers liff.login() inside the webview otherwise. */
export async function getClawhubProfile(
  liffId?: string,
): Promise<ClawhubLiffProfile | null> {
  const liff = await getClawhubLiff(liffId);
  if (!liff) return null;
  if (!liff.isLoggedIn()) {
    try {
      liff.login();
    } catch {
      /* preview / non-LINE context */
    }
    return null;
  }
  try {
    const p = await liff.getProfile();
    return {
      userId: p.userId,
      displayName: p.displayName,
      pictureUrl: p.pictureUrl,
    };
  } catch {
    return null;
  }
}

/** LINE id_token (JWT) for server-side verification. Null if not logged in. */
export async function getClawhubIdToken(liffId?: string): Promise<string | null> {
  const liff = await getClawhubLiff(liffId);
  if (!liff || !liff.isLoggedIn()) return null;
  try {
    return liff.getIDToken();
  } catch {
    return null;
  }
}
