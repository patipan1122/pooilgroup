// Resolve the canonical app URL for building absolute links (invites, emails,
// LIFF redirects, Telegram callbacks).
//
// Two flavors:
//   - getRequestBaseUrl(req): prefer the actual request origin via forwarded
//     headers. Use this in API routes that build links shown to the same admin
//     who triggered the action — guarantees the link matches whatever domain
//     they're on (vercel.app, custom domain, preview URL, localhost).
//   - getBaseUrl(): env-based fallback for non-request contexts (cron jobs,
//     background workers). Order: NEXT_PUBLIC_APP_URL → VERCEL_PROJECT_PRODUCTION_URL
//     → VERCEL_URL → http://localhost:3100.

export function getRequestBaseUrl(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) return `${proto}://${host}`;
  return getBaseUrl();
}

export function getBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit && !explicit.includes("localhost")) return explicit;

  const prodUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (prodUrl) return `https://${prodUrl}`;

  const deployUrl = process.env.VERCEL_URL?.trim();
  if (deployUrl) return `https://${deployUrl}`;

  return explicit || "http://localhost:3100";
}
