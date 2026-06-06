// LedgerLine LIFF layout — mounts the mobile bottom nav under the /liff/ledger
// surface. Auth/LiffBootstrap stays in the parent app/liff/layout.tsx; this layer
// only adds UI. LiffLedgerNav self-hides everywhere except /liff/ledger/my, and
// that page reserves its own bottom padding, so this layout stays side-effect-free
// on the capture / edit / admin / join routes.
import { LiffLedgerNav } from "@/components/ledger/LiffLedgerNav";

export const dynamic = "force-dynamic";

export default function LedgerLiffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <LiffLedgerNav />
    </>
  );
}
