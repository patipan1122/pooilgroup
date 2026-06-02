// Cleanliness layout · dual-mode.
//   MAID  → maid PWA shell (mobile, bottom-nav · same as /collect)
//   MANAGER+ → bare wrapper (parent /dashboard layout already supplies header/nav)
// CEO 2026-06-02: "Cleanliness manager view = BUILD" — drop the hard MAID lock
// so managers/CEO/admin/office can view recent reports across branches.
import { requireAuth } from "@/lib/chairops/auth/session";
import { MaidShell } from "../collect/_components/maid-shell";

export default async function CleanlinessLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuth();
  if (session.user.role === "MAID") {
    return <MaidShell displayName={session.user.displayName}>{children}</MaidShell>;
  }
  // MANAGER / CEO / ADMIN / OFFICE / TECHNICIAN → plain container.
  // /chairops/dashboard layout is not nested over this route, so we render a
  // light shell so the page renders standalone too.
  return <div className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6">{children}</div>;
}
