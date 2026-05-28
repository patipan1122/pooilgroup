// Photo URL guard — prevents client from submitting arbitrary URLs (e.g. evil.com/joke.jpg)
// All evidence/cleanliness/damage photos MUST live under R2_PUBLIC_URL.
//
// CRIT-002 fix from SECURITY-REVIEW.md

const ALLOWED_HOSTS: ReadonlySet<string> = new Set<string>([
  // Add explicit allowed CDN hosts here if R2 fronted by Cloudflare images
]);

export function isAllowedPhotoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (typeof url !== "string") return false;
  if (url.length > 2048) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const r2Public = process.env.R2_PUBLIC_URL;
    if (r2Public) {
      const r2 = new URL(r2Public);
      if (u.host === r2.host && u.pathname.startsWith(r2.pathname)) return true;
    }
    if (ALLOWED_HOSTS.has(u.host)) return true;
    return false;
  } catch {
    return false;
  }
}

export function assertAllowedPhotoUrl(url: string | null | undefined, fieldName = "photoUrl"): void {
  if (!isAllowedPhotoUrl(url)) {
    throw new Error(`รูปไม่ถูกต้อง (${fieldName})`);
  }
}

export function assertAllowedPhotoUrls(urls: readonly string[] | undefined, fieldName = "photoUrls"): void {
  if (!urls || urls.length === 0) return;
  for (const u of urls) assertAllowedPhotoUrl(u, fieldName);
}
