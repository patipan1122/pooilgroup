// ClawHub (JOLLY PLAY) — R2 object-key factory for refund screenshots.
// Reuses the low-level R2 client from @/lib/r2/upload (putObject / getUploadUrl /
// deleteObject) — does NOT reimplement the S3 client. Keys are date-partitioned so
// retention/cleanup-by-month is easy: clawhub/refunds/YYYY/MM/<orgId>/<memberId>-<rand>.jpg

import { putObject, getUploadUrl, deleteObject } from "@/lib/r2/upload";

/** Build the R2 key for a member's refund screenshot. */
export function refundScreenshotKey(orgId: string, memberId: string): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 10);
  return `clawhub/refunds/${yyyy}/${mm}/${orgId}/${memberId}-${rand}.jpg`;
}

// Re-export the low-level R2 ops so ClawHub callers import everything from one place.
export { putObject, getUploadUrl, deleteObject };
