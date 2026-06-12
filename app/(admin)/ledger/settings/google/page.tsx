// Ledger · การเชื่อมต่อ Google (Drive + Gmail) — connect once, pull receipts.
// admin tier only. Drive is org-level (shared ChairopsDriveConnection); Gmail is
// multi-mailbox per company (ledger_email_connection). Email section gated by
// LEDGER_EMAIL_SCAN_V1.
import { requireRole } from "@/lib/auth/session";
import { resolveScope } from "../../_scope";
import { LedgerHeader, NoCompanyState } from "../../_components/LedgerHeader";
import { listLedgerMailboxes } from "@/lib/ledger/gmail";
import { getDriveConnection } from "@/lib/chairops/storage/drive";
import { testDriveConnection } from "@/lib/ledger/drive";
import { GoogleConnectCard } from "./_components/GoogleConnectCard";
import { SettingsBack } from "../_components/SettingsBack";

export const dynamic = "force-dynamic";

const EMAIL_SCAN_ENABLED =
  process.env.LEDGER_EMAIL_SCAN_V1 === "1" || process.env.LEDGER_EMAIL_SCAN_V1 === "true";

export default async function LedgerGoogleSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; branch?: string }>;
}) {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const sp = await searchParams;
  const scope = await resolveScope(session.user.org_id, sp);

  if (!scope.companyId) {
    return (
      <div className="p-4 sm:p-6">
        <SettingsBack companyId={null} />
        <LedgerHeader title="การเชื่อมต่อ Google" scope={scope} />
        <NoCompanyState />
      </div>
    );
  }

  const companyName =
    scope.companies.find((c) => c.id === scope.companyId)?.name ?? "บริษัทนี้";

  const [mailboxes, driveConn] = await Promise.all([
    EMAIL_SCAN_ENABLED ? listLedgerMailboxes(scope.orgId, scope.companyId) : Promise.resolve([]),
    getDriveConnection(scope.orgId),
  ]);
  // Health check only when a connection exists — avoids Drive API call when not yet connected.
  const driveHealth = driveConn ? await testDriveConnection(scope.orgId) : null;

  return (
    <div className="p-4 pb-24 sm:p-6 lg:pb-6">
      <SettingsBack companyId={scope.companyId} />
      <LedgerHeader
        title="การเชื่อมต่อ Google"
        subtitle="เชื่อม Drive (เก็บไฟล์ใบเสร็จ) และ Gmail (ดึงค่าใช้จ่ายจากอีเมล)"
        scope={scope}
      />
      <div className="mx-auto mt-4 max-w-2xl">
        <GoogleConnectCard
          companyId={scope.companyId}
          companyName={companyName}
          driveConnected={!!driveConn}
          driveEmail={driveConn?.driveEmail ?? null}
          driveHealthy={driveHealth?.ok ?? null}
          driveHealthReason={driveHealth?.reason ?? null}
          mailboxes={mailboxes}
          emailScanEnabled={EMAIL_SCAN_ENABLED}
        />
      </div>
    </div>
  );
}
