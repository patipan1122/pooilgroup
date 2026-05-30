// Inbound media — download images from LINE or FB and rehost on R2.
//
// LINE serves message media via api-data.line.me with the channel's access
// token; the URL is per-message and tied to our app's bearer.  Facebook
// returns a public CDN URL inside the webhook payload but those URLs expire
// after a short window — so we mirror both to R2 and persist our own URL on
// the InboxMessage row.
//
// Best-effort by design: if a download/upload fails, we return null and let
// the caller fall back to recording the message without media.  The original
// provider message ID stays available for retry.

import { uploadInboundImage, validateImageBuffer, type UploadedImage } from "./storage";

export interface InboundImageAttachment {
  type: "image";
  url: string;
  contentType: string;
  /** provider-specific source ID, kept so we could re-download if needed */
  providerMessageId?: string;
}

const FETCH_TIMEOUT_MS = 8000;
const MAX_FETCH_BYTES = 6 * 1024 * 1024; // 6 MB ceiling on download too

async function fetchAsBuffer(
  url: string,
  init?: RequestInit,
): Promise<{ buf: Buffer; contentType: string | null }> {
  const resp = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) {
    throw new Error(`fetch ${resp.status}`);
  }
  const ab = await resp.arrayBuffer();
  if (ab.byteLength > MAX_FETCH_BYTES) {
    throw new Error(`image too large: ${ab.byteLength}`);
  }
  return { buf: Buffer.from(ab), contentType: resp.headers.get("content-type") };
}

/** Download a LINE image by message id and store it on R2.  Returns null on failure. */
export async function rehostLineImage(opts: {
  orgId: string;
  conversationId: string;
  messageId: string;
  channelAccessToken: string;
}): Promise<InboundImageAttachment | null> {
  try {
    const { buf, contentType } = await fetchAsBuffer(
      `https://api-data.line.me/v2/bot/message/${opts.messageId}/content`,
      { headers: { Authorization: `Bearer ${opts.channelAccessToken}` } },
    );
    const valid = validateImageBuffer(buf);
    if (!valid.ok) {
      console.warn("[inbox:rehostLineImage] invalid image", valid.reason);
      return null;
    }
    const up: UploadedImage = await uploadInboundImage({
      orgId: opts.orgId,
      conversationId: opts.conversationId,
      buffer: buf,
      contentType,
    });
    return {
      type: "image",
      url: up.url,
      contentType: up.contentType,
      providerMessageId: opts.messageId,
    };
  } catch (e) {
    console.error("[inbox:rehostLineImage] failed", (e as Error).message);
    return null;
  }
}

/** Download a Facebook image (public CDN URL) and store it on R2. */
export async function rehostFacebookImage(opts: {
  orgId: string;
  conversationId: string;
  sourceUrl: string;
  providerMessageId?: string;
}): Promise<InboundImageAttachment | null> {
  try {
    const { buf, contentType } = await fetchAsBuffer(opts.sourceUrl);
    const valid = validateImageBuffer(buf);
    if (!valid.ok) {
      console.warn("[inbox:rehostFacebookImage] invalid image", valid.reason);
      return null;
    }
    const up: UploadedImage = await uploadInboundImage({
      orgId: opts.orgId,
      conversationId: opts.conversationId,
      buffer: buf,
      contentType,
    });
    return {
      type: "image",
      url: up.url,
      contentType: up.contentType,
      providerMessageId: opts.providerMessageId,
    };
  } catch (e) {
    console.error("[inbox:rehostFacebookImage] failed", (e as Error).message);
    return null;
  }
}
