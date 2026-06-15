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
      // The old /[accountId]/[batchId] detail route was removed — land on this
      // account's reconcile board, scoped to the period the imported statement
      // covers (so the freshly-imported rows are visible, not an empty month).
      // Fall back to the page's current period if the import didn't report one.
      onSuccess={(_batchId, periodStart, periodEnd) => {
        const fromMonth = periodStart?.slice(0, 7) || period;
        const toMonth = periodEnd?.slice(0, 7) || fromMonth;
        const qs = new URLSearchParams({ company: companyId, period: fromMonth });
        if (toMonth && toMonth !== fromMonth) qs.set("periodTo", toMonth);
        router.push(`/ledger/bank-recon/${bankAccountId}/reconcile?${qs.toString()}`);
      }}
    />
  );
}
