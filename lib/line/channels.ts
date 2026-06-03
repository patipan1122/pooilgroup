// Per-module LINE channel registry.
//
// CEO rule (2026-06-03): every program/module uses its OWN LINE channels —
// NEVER share/mix one channel across modules. So LINE Login + LIFF are selected
// by module here instead of a single global env.
//
// BACKWARD-COMPATIBLE: module "default" returns the original shared env values,
// so ChairOps / HotelBook / etc. (which don't pass a module) behave EXACTLY as
// before. Only "ledger" routes to LedgerLine's own channel; if its env is unset
// it falls back to the default so nothing hard-breaks.
//
// NOTE on env: NEXT_PUBLIC_* are inlined at build time and safe in client code.
// loginSecretForModule reads a NON-public env and must only run server-side
// (it returns undefined in the browser — never bundled).

export type LineModule = "ledger" | "default";

/** Pick the module from a path (used by the shared LIFF bootstrap on /liff/*). */
export function lineModuleFromPath(path: string | null | undefined): LineModule {
  return path && path.startsWith("/liff/ledger") ? "ledger" : "default";
}

/** Normalise an arbitrary string (URL param / cookie) to a known module. */
export function asLineModule(v: string | null | undefined): LineModule {
  return v === "ledger" ? "ledger" : "default";
}

/** The LIFF app id for a module (PUBLIC — safe in client). */
export function liffIdForModule(m: LineModule): string | undefined {
  if (m === "ledger") {
    return process.env.NEXT_PUBLIC_LEDGER_LIFF_ID || process.env.NEXT_PUBLIC_LIFF_ID;
  }
  return process.env.NEXT_PUBLIC_LIFF_ID;
}

/** The LINE Login channel id for a module — derived from the LIFF id prefix
 *  ("{channelId}-{liffAppId}"). Used as the OAuth client_id + verify client_id.
 *  Channel id is not secret. */
export function loginChannelIdForModule(m: LineModule): string | undefined {
  return liffIdForModule(m)?.split("-")[0];
}

/** The LINE Login channel SECRET for a module — SERVER ONLY (non-public env). */
export function loginSecretForModule(m: LineModule): string | undefined {
  if (m === "ledger") {
    return (
      process.env.LEDGER_LINE_LOGIN_CHANNEL_SECRET ||
      process.env.CHAIROPS_LINE_LOGIN_CHANNEL_SECRET
    );
  }
  return process.env.CHAIROPS_LINE_LOGIN_CHANNEL_SECRET;
}
