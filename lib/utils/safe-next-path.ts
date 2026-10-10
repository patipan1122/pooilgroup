// Same-origin relative-path guard — shared by every auth flow that accepts
// a `?next=...` redirect target (login, invite-accept) so they all agree on
// what counts as "safe": a bare "/" is fine, "//evil.com" is rejected as
// protocol-relative, and absolute URLs are rejected since they don't start
// with "/". A similar predicate (`safeRelPath`) also exists standalone in
// app/auth/line-start/route.ts for the LINE login entry point — that one has
// a different fallback default (a LINE-specific landing page) and wasn't
// folded in here to avoid touching unrelated LINE auth code, but the core
// rule is the same.

export function isSafeNextPath(p: string | null | undefined): p is string {
  return !!p && p.startsWith("/") && !p.startsWith("//");
}
