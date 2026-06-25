import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import {
  isAdminTier,
  userHasModuleAccess,
  userIsModuleAdmin,
} from "@/lib/auth/module-access";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { isModuleDisabled } from "@/lib/modules";
import { InboxBottomNav } from "@/components/inbox/inbox-bottom-nav";
import "./inbox.css";

export const metadata = { title: "Inbox แชท" };

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

  // Bottom-nav tabs are role-aware: bot trainer = module admin, channels = super admin.
  const canBot = await userIsModuleAdmin(session.user, "inbox");
  const canChannels = isSuperAdmin(session.user.role);

  return (
    <div className="inbox-scope">
      {children}
      <Suspense fallback={null}>
        <InboxBottomNav canBot={canBot} canChannels={canChannels} />
      </Suspense>
    </div>
  );
}
