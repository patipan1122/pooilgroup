// Damage /new layout · same maid PWA shell as /collect & /cleanliness.
// Only the /new sub-route is maid-scoped; the rest of /damage belongs to office.
import { requireRole, requireExactRole } from "@/lib/chairops/auth/session";
import { MaidShell } from "../../collect/_components/maid-shell";

export default async function DamageNewLayout({ children }: { children: React.ReactNode }) {
  const session = await requireExactRole("MAID");
  return <MaidShell displayName={session.user.displayName}>{children}</MaidShell>;
}
