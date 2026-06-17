// ClawHub (JOLLY PLAY) — server-only org resolver.
// Kept OUT of constants.ts so client components can import the pure constants
// without pulling prisma/pg (node:dns/fs/net/tls) into the browser bundle.
import { prisma } from "@/lib/prisma";

// Cache the resolved org id for the lifetime of the server process. ClawHub is a
// single-tenant deployment (the one Pooilgroup org), but we resolve it from the DB
// rather than hard-coding a uuid — matches how the rest of the repo seeds the org
// (prisma/seed.ts → slug "pooilgroup").
let _cachedOrgId: string | null = null;

/**
 * Resolve the single Pooilgroup org id. Prefers the org with slug "pooilgroup"
 * (the canonical seed slug), then falls back to the first active org, then any org.
 * Throws if no org exists (mis-configured deploy).
 */
export async function clawhubOrgId(): Promise<string> {
  if (_cachedOrgId) return _cachedOrgId;

  const bySlug = await prisma.organization.findUnique({
    where: { slug: "pooilgroup" },
    select: { id: true },
  });
  if (bySlug) {
    _cachedOrgId = bySlug.id;
    return bySlug.id;
  }

  const firstActive = await prisma.organization.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (firstActive) {
    _cachedOrgId = firstActive.id;
    return firstActive.id;
  }

  const any = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (any) {
    _cachedOrgId = any.id;
    return any.id;
  }

  throw new Error("[clawhub] no Organization found — cannot resolve org id");
}
