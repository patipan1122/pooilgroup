// LedgerLine — invite accept (LIFF) · /liff/ledger/join?invite=<token>
//
// An invited person opens the admin's link → the LedgerLine LIFF logs them in
// with LINE → this page reads ?invite, fetches the verified id_token, and POSTs
// to /api/ledger/invite/accept which creates their SCOPED member row. Works even
// for people WITHOUT a Pool account (the member is keyed by verified lineUserId).

import { JoinClient } from "./JoinClient";

export const dynamic = "force-dynamic";

export default async function LedgerJoinPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;
  return (
    <div className="mx-auto w-full max-w-md px-4 pb-[env(safe-area-inset-bottom)]">
      <JoinClient token={invite ?? ""} />
    </div>
  );
}
