// Maid-only PWA layout · mobile-first · bottom nav with safe-area inset.
// MAID gate via requireRole; shell shared with /cleanliness and /damage/new.
import { requireRole, requireExactRole } from "@/lib/chairops/auth/session";
import { MaidShell } from "./_components/maid-shell";

export default async function MaidLayout({ children }: { children: React.ReactNode }) {
  const session = await requireExactRole("MAID");
  return <MaidShell displayName={session.user.displayName}>{children}</MaidShell>;
}
