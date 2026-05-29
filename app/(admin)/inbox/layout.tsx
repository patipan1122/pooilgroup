import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier, userHasModuleAccess } from "@/lib/auth/module-access";
import { isModuleDisabled } from "@/lib/modules";

export default async function InboxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (isModuleDisabled("inbox")) redirect("/dashboard");
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) {
    const ok = await userHasModuleAccess(session.user, "inbox");
    if (!ok) redirect("/403");
  }
  return <div className="inbox-scope">{children}</div>;
}
