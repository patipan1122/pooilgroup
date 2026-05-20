// Recruit — slug + ref-id generators
// slug = public link path (e.g. "driver-pooil-may2026-x4f2")
// refId = human-readable application ID (e.g. "APP-2026-001234")

function randomSuffix(len = 4): string {
  return Math.random().toString(36).slice(2, 2 + len);
}

/** Convert Thai/English string to URL-safe slug. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^฀-๿a-z0-9\s-]/g, "") // keep Thai, alphanum, space, dash
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

/** Generate a unique slug from title + random suffix. */
export function makePostingSlug(title: string): string {
  const base = slugify(title);
  const suffix = randomSuffix(4);
  return base ? `${base}-${suffix}` : `post-${Date.now()}-${suffix}`;
}

/** Generate human-readable application ref ID. */
export function makeApplicationRefId(): string {
  const year = new Date().getFullYear();
  const rand = Math.floor(Math.random() * 1000000)
    .toString()
    .padStart(6, "0");
  return `APP-${year}-${rand}`;
}
