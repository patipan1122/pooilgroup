import { requireRole } from "@/lib/chairops/auth/session";
import { AdminShell } from "@/components/chairops/features/admin-shell";

export default async function PartsLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("OFFICE");
  return <AdminShell session={session}>{children}</AdminShell>;
}
