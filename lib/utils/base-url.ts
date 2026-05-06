// Resolve the canonical app URL for building absolute links (invites, emails,
// LIFF redirects, Telegram callbacks).
//
// Order of preference:
//   1. NEXT_PUBLIC_APP_URL — explicit override (build-time inline). Use this
//      for stable custom domain (e.g. https://app.pooilgroup.com).
//   2. VERCEL_PROJECT_PRODUCTION_URL — Vercel-provided stable production
//      domain (runtime, e.g. pooilgroup.vercel.app). Survives missing env.
//   3. VERCEL_URL — current deployment URL (runtime, e.g.
//      pooilgroup-xxx.vercel.app). Used for preview deployments.
//   4. http://localhost:3100 — local dev fallback.
//
// Why both NEXT_PUBLIC + VERCEL_*: NEXT_PUBLIC_* is build-time inlined, so if
// the env var was added AFTER deploy, the build still falls back to localhost.
// VERCEL_* is runtime — always reflects the current deployment context.

export function getBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit && !explicit.includes("localhost")) return explicit;

  const prodUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (prodUrl) return `https://${prodUrl}`;

  const deployUrl = process.env.VERCEL_URL?.trim();
  if (deployUrl) return `https://${deployUrl}`;

  return explicit || "http://localhost:3100";
}
