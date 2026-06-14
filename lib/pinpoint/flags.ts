// Pinpoint / โหมดติชม — feature flag.
//
// With PINPOINT_V1 OFF the runtime is byte-equivalent to today: the overlay
// provider renders nothing, the AI-menu entry is hidden, and the API routes
// 404-equivalent (return 403). The DB migration is additive so it ships
// un-flagged. Flip ON in Vercel after smoke-testing one page.
//
// Read at call time (not module load) so a Vercel env flip takes effect on the
// next request without a rebuild.

function flagOn(name: string): boolean {
  const v = process.env[name];
  return v === "1" || v === "true" || v === "on";
}

// Read server-side (layout, API routes). The client provider receives the
// resolved boolean as a prop from the admin layout — no NEXT_PUBLIC needed.
export function pinpointV1(): boolean {
  return flagOn("PINPOINT_V1");
}
