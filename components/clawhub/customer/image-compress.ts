// ClawHub customer — client-side image downscale + JPEG re-encode to keep the upload
// small (phones shoot 4-12MP; the LCD only needs ~1200px). Returns base64 (no data:
// prefix) + mimeType, ready to POST to /api/clawhub/refund.
//
// Falls back to reading the original file as base64 if canvas/Image decode fails
// (some HEIC files etc.) so the customer is never blocked — the server caps size via
// zod and the vision step degrades gracefully on a bad image.

const MAX_EDGE = 1200;
const JPEG_QUALITY = 0.82;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = url;
  });
}

export type CompressedImage = {
  base64: string; // no data: prefix
  mimeType: string;
  previewUrl: string; // data: URL for <img preview>
};

export async function compressImage(file: File): Promise<CompressedImage> {
  const originalDataUrl = await readAsDataUrl(file);

  try {
    const img = await loadImage(originalDataUrl);
    const { width, height } = img;
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(img, 0, 0, w, h);

    const jpegDataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    const comma = jpegDataUrl.indexOf(",");
    return {
      base64: comma >= 0 ? jpegDataUrl.slice(comma + 1) : jpegDataUrl,
      mimeType: "image/jpeg",
      previewUrl: jpegDataUrl,
    };
  } catch {
    // Fallback: send the original bytes untouched.
    const comma = originalDataUrl.indexOf(",");
    return {
      base64: comma >= 0 ? originalDataUrl.slice(comma + 1) : originalDataUrl,
      mimeType: file.type || "image/jpeg",
      previewUrl: originalDataUrl,
    };
  }
}
