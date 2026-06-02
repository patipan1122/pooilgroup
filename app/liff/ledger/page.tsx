// LedgerLine — LINE Mini App (LIFF) entry · /liff/ledger
//
// Phone-first capture+confirm for front-line staff: take/upload a receipt photo
// → it's parsed by AI (/api/ledger/ocr) → staff eyeballs the read-back fields →
// edits if wrong → confirms (POST /api/ledger/expenses). The expense is created
// as status=draft (NEVER auto-post — an accountant still finalises it later in
// the web review pane); this LIFF flow just speeds up first capture from the field.
//
// Auth: the /liff layout's LiffBootstrap auto-logs-in via the verified LINE
// id_token (same as ChairOps/ClawFleet). This page is a thin server shell; all
// interaction lives in the client capture component, which talks ONLY to the
// /api/ledger/* HTTP routes (Partition B) — it never imports server code, so it
// stays self-contained and compiles even before those routes land.

import { LedgerCaptureApp } from "./_components/ledger-capture-app";

export const dynamic = "force-dynamic";

export default function LedgerLiffPage() {
  return (
    <div className="mx-auto w-full max-w-md">
      <LedgerCaptureApp />
    </div>
  );
}
