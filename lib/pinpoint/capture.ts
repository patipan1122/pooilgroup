// Pinpoint — best-effort page capture (client only).
//
// Architecture decisions (workshop):
//  • snapdom, NOT html2canvas — html2canvas breaks on modern Tailwind (oklch,
//    backdrop-filter, web fonts). snapdom clones the node + inlines CSS/fonts.
//  • Lazy-imported ONLY here, so the ~library cost is paid only when comment
//    mode is actually used (0 bundle cost on every other admin page).
//  • Capture MUST NEVER block saving a pin — every failure resolves to null and
//    the pin still saves with its structured target (url + selector + comment).
//  • One capture per page-visit, deduped by pathname in the provider.

const MAX_DIM = 1600; // cap longest side → keeps webp small

/** Capture document.body to a compressed webp Blob. Returns null on any failure
 *  (capture is decoration; the pin's structured target is the real record). */
export async function captureBody(): Promise<Blob | null> {
  try {
    if (typeof window === "undefined") return null;
    // Wait for fonts so text/icons render in the clone.
    if (document.fonts?.ready) {
      await Promise.race([
        document.fonts.ready,
        new Promise((r) => setTimeout(r, 800)),
      ]);
    }

    const mod = await import("@zumer/snapdom");
    const snapdom = (mod as { snapdom?: unknown }).snapdom ?? mod.default;
    if (typeof snapdom !== "function") return null;

    const scale = Math.min(
      1,
      MAX_DIM / Math.max(window.innerWidth, window.innerHeight || 1),
    );
    const result = await (
      snapdom as (
        el: Element,
        opts?: Record<string, unknown>,
      ) => Promise<{ toBlob: (o?: Record<string, unknown>) => Promise<Blob> }>
    )(document.body, {
      backgroundColor: "#ffffff",
      scale: scale > 0 ? scale : 1,
      fast: true,
      embedFonts: true,
      // Drop our own overlay UI from the capture so pins/toolbar never appear
      // in the screenshot (snapdom removes matched nodes from the clone).
      exclude: ["[data-pinpoint-ui]"],
      excludeMode: "remove",
    });

    // snapdom BlobType is "webp" (not the MIME "image/webp").
    const blob = await result.toBlob({ type: "webp", quality: 0.7 });
    return blob ?? null;
  } catch (err) {
    console.warn("[pinpoint] captureBody failed (non-fatal)", err);
    return null;
  }
}

/** Upload a captured blob via the shared /api/r2/sign → PUT flow.
 *  Returns the R2 key (under users/<id>/) or null. */
export async function uploadCapture(blob: Blob): Promise<string | null> {
  try {
    const signRes = await fetch("/api/r2/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: `pinpoint-${Date.now()}.webp`,
        contentType: "image/webp",
        size: blob.size,
      }),
    });
    if (!signRes.ok) return null;
    const { uploadUrl, key } = (await signRes.json()) as {
      uploadUrl: string;
      key: string;
    };
    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/webp" },
      body: blob,
    });
    if (!putRes.ok) return null;
    return key;
  } catch (err) {
    console.warn("[pinpoint] uploadCapture failed (non-fatal)", err);
    return null;
  }
}

/** True when the device is realistically a touch phone — we skip snapdom there
 *  (unstable + heavy) and save pins with structured target only. */
export function isLikelyMobile(): boolean {
  if (typeof window === "undefined") return false;
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  return coarse && window.innerWidth < 768;
}
