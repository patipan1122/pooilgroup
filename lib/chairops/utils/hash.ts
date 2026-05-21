// SHA-256 helpers for file deduplication (image hash, CSV hash)
import { createHash } from "crypto";

export function sha256Hex(buf: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(buf).digest("hex");
}
