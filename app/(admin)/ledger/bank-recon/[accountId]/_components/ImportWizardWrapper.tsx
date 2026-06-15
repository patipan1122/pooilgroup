"use client";

// Client wrapper so ImportWizard's onSuccess can call useRouter().push()
// (ImportWizard is already a client component; this just wires the redirect).

import { useRouter } from "next/navigation";
import { ImportWizard } from "../../_components/ImportWizard";

interface Props {
  bankAccountId: string;
  accountName: string;
  companyId: string;
  period: string;
}

export function ImportWizardWrapper({ bankAccountId, accountName, companyId, period }: Props) {
  const router = useRouter();
  return (
    <ImportWizard
      bankAccountId={bankAccountId}
      accountName={accountName}
      // go straight to this account's reconcile board (the old /[batchId] route was removed)
      onSuccess={() => {
        router.push(`/ledger/bank-recon/${bankAccountId}/reconcile?company=${companyId}&period=${period}`);
      }}
    />
  );
}
