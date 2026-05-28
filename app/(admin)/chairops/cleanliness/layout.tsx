// Cleanliness layout · same maid PWA shell as /collect.
// MAID-gated; managers/CEO use /dashboard/cleanliness (separate route).
import { requireRole, requireExactRole } from "@/lib/chairops/auth/session";
import { MaidShell } from "../collect/_components/maid-shell";

export default async function CleanlinessLayout({ children }: { children: React.ReactNode }) {
  const session = await requireExactRole("MAID");
  return <MaidShell displayName={session.user.displayName}>{children}</MaidShell>;
}
