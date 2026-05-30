// Inbox media storage helpers — uploads images to Cloudflare R2 (Pool's
// shared object store). Two flows:
//   - INBOUND  : customer-sent images downloaded from LINE/FB, kept private
//                under a per-conversation prefix so admins see them in /inbox.
//   - BOT ASSET: CEO-uploaded images attached to bot reply templates
//                (e.g., "นี่คือจุดหยอดเหรียญ"), keyed per topic so the bot
//                can attach one along with the canned text.
//
// Both buckets share the same R2 bucket — paths are namespaced.  Public R2
// URLs are required because LINE/FB fetch outbound image URLs from the
// public internet to deliver them to customers.

import { randomUUID } from "node:crypto";
import { putObject } from "@/lib/r2/upload";

export interface UploadedImage {
  url: string;
  key: string;
  contentType: string;
}

// Map a MIME type (or extension hint) to an extension we want to store under.
// R2 keys keep the extension so the URL is browser/LINE friendly.
function extFor(contentType: string | undefined | null): { ext: string; mime: string } {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("png")) return { ext: "png", mime: "image/png" };
  if (ct.includes("webp")) return { ext: "webp", mime: "image/webp" };
  if (ct.includes("gif")) return { ext: "gif", mime: "image/gif" };
  // Default to jpeg — covers LINE (image/jpeg) and most FB-CDN URLs.
  return { ext: "jpg", mime: "image/jpeg" };
}

/** Upload a customer-sent image (from LINE / FB) and return the public URL. */
export async function uploadInboundImage(opts: {
  orgId: string;
  conversationId: string;
  buffer: Buffer;
  contentType?: string | null;
}): Promise<UploadedImage> {
  const { ext, mime } = extFor(opts.contentType);
  const ym = new Date().toISOString().slice(0, 7); // YYYY-MM
  const key = `inbox/${opts.orgId}/inbound/${ym}/${opts.conversationId}/${randomUUID()}.${ext}`;
  const url = await putObject(key, opts.buffer as unknown as Uint8Array, mime);
  return { url, key, contentType: mime };
}

/** Upload a CEO-supplied bot template image and return the public URL. */
export async function uploadBotAssetImage(opts: {
  orgId: string;
  businessTag: string;
  topic: string;
  buffer: Buffer;
  contentType?: string | null;
}): Promise<UploadedImage> {
  const { ext, mime } = extFor(opts.contentType);
  // randomUUID prevents LINE/FB from serving a stale cached image after the
  // CEO uploads a replacement — every upload produces a fresh URL.
  const key = `inbox/${opts.orgId}/bot/${opts.businessTag}/${opts.topic}-${randomUUID()}.${ext}`;
  const url = await putObject(key, opts.buffer as unknown as Uint8Array, mime);
  return { url, key, contentType: mime };
}

/**
 * Validate that a buffer is an acceptable image (size + magic bytes).
 * Used at the upload boundary so neither customers nor admins can push
 * arbitrary binaries into our bucket.
 */
export function validateImageBuffer(buf: Buffer): { ok: true } | { ok: false; reason: string } {
  if (!buf || buf.byteLength === 0) return { ok: false, reason: "ไฟล์ว่าง" };
  if (buf.byteLength > 5 * 1024 * 1024) {
    return { ok: false, reason: "ไฟล์ใหญ่เกิน 5 MB" };
  }
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isGif = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46;
  const isWebP =
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  if (!isJpeg && !isPng && !isGif && !isWebP) {
    return { ok: false, reason: "รองรับเฉพาะ JPEG / PNG / GIF / WebP" };
  }
  return { ok: true };
}
