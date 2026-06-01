// AuditMe public preview layout
// Hosts Claude.ai/design exports (HTML) + token-extracted React routes.
// No auth — public preview while the product is in design phase.

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AuditMe · Design Preview",
  robots: { index: false, follow: false },
};

export default function AuditMeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="auditme-scope min-h-screen bg-[#EEEEE6]">{children}</div>;
}
