// Routes a stored R2 public photo URL (ID card / selfie / slip / damage photo)
// through an authed proxy instead of rendering the bare public URL — so page
// HTML never contains a permanently-public link. Interim fix for ultramobileux
// audit P0-1 (2026-10-07); full fix is migrating the bucket to private reads.
// See app/api/chairops/photo/route.ts for the server side of this.
export function toAuthedPhotoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return `/api/chairops/photo?u=${encodeURIComponent(url)}`;
}
