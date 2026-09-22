// Recruit Onboarding · client-side image downscaling before upload.
//
// WHY THIS EXISTS (real bug, not a nice-to-have): onboarding documents route
// THROUGH our server on the way to Google Drive (Drive has no presigned-upload
// equivalent), and Vercel caps a serverless request body at ~4.5 MB — enforced
// by the platform BEFORE our route handler runs, so the candidate gets an
// opaque failure we cannot turn into a helpful Thai message. Meanwhile
// ONBOARDING_MAX_FILE_SIZE is 8 MB and a modern phone camera routinely emits
// 3-8 MB JPEGs, so "passes our own size check, then dies at the platform" is
// the DEFAULT path for a real new hire photographing their ID card.
//
// Fix: shrink on the device first. Long edge capped, re-encoded as JPEG, with
// a quality step-down until it fits comfortably under the platform ceiling.
// PDFs pass through untouched (can't re-encode them here) — they're rejected
// with a clear message if oversized instead.

/** Stay well under Vercel's ~4.5 MB body cap — multipart framing + the other
 *  form fields also count toward it. */
const TARGET_MAX_BYTES = 3.5 * 1024 * 1024;

/** Long-edge cap. 1600px keeps Thai ID-card text and bank-book digits legible
 *  for HR review (they zoom in to verify account numbers) while cutting a
 *  12MP phone photo down by roughly an order of magnitude. */
const MAX_LONG_EDGE = 1600;

const QUALITY_STEPS = [0.85, 0.72, 0.6, 0.5] as const;

function isDownscalableImage(file: File): boolean {
  return (
    file.type === "image/jpeg" ||
    file.type === "image/png" ||
    file.type === "image/webp"
  );
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap is the fast path and handles EXIF orientation on modern
  // browsers; fall back to an <img> for older Safari.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // fall through to the <img> path
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed"));
      el.src = url;
    });
    return img;
  } finally {
    // Revoke on the next tick — Safari needs the URL alive through decode.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function dimensionsOf(src: ImageBitmap | HTMLImageElement): {
  width: number;
  height: number;
} {
  if ("naturalWidth" in src) {
    return { width: src.naturalWidth, height: src.naturalHeight };
  }
  return { width: src.width, height: src.height };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
  });
}

/**
 * Shrink an image file so it survives the platform body cap.
 *
 * Returns the ORIGINAL file unchanged when it's already small enough, when it
 * isn't a re-encodable image (PDF), or when anything in the canvas path fails
 * — never throws, never blocks the candidate. The caller still enforces its
 * own size ceiling afterwards, so a pass-through that's genuinely too large
 * still gets a clear message instead of a silent platform rejection.
 */
export async function downscaleImageForUpload(file: File): Promise<File> {
  if (file.size <= TARGET_MAX_BYTES) return file;
  if (!isDownscalableImage(file)) return file;

  try {
    const src = await loadBitmap(file);
    const { width, height } = dimensionsOf(src);
    if (!width || !height) return file;

    const scale = Math.min(1, MAX_LONG_EDGE / Math.max(width, height));
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(src, 0, 0, targetW, targetH);
    if ("close" in src && typeof src.close === "function") src.close();

    for (const quality of QUALITY_STEPS) {
      const blob = await canvasToBlob(canvas, quality);
      if (!blob) break;
      if (blob.size <= TARGET_MAX_BYTES) {
        const renamed = file.name.replace(/\.(png|webp|jpeg|jpg)$/i, "") + ".jpg";
        return new File([blob], renamed, {
          type: "image/jpeg",
          lastModified: Date.now(),
        });
      }
    }
    return file;
  } catch {
    return file;
  }
}

/** Human-readable size for Thai error copy. */
export function formatFileSizeMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The effective ceiling a file must respect AFTER downscaling — below the
 *  platform's own limit so failures surface as our message, not a raw 413. */
export const ONBOARDING_UPLOAD_HARD_CEILING = 4 * 1024 * 1024;
