"use client";

// Client wrapper so ImportWizard's onSuccess can call useRouter().push()
// (ImportWizard is already a client component; this just wires the redirect).

import { useRouter } from "next/navigation";
import { ImportWizard } from "../../_components/ImportWizard";

interface Props {
  bankAccountId: string;
  accountName: string;
}

export function ImportWizardWrapper({ bankAccountId, accountName }: Props) {
  const router = useRouter();
  return (
    <ImportWizard
      bankAccountId={bankAccountId}
      accountName={accountName}
      onSuccess={(batchId) => {
        router.push(`/ledger/bank-recon/${bankAccountId}/${batchId}`);
      }}
    />
  );
}
