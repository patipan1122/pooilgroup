// /telegram-app — DocuFlow signing, embedded inside Telegram itself.
// ────────────────────────────────────────────────────────────────────
// Replaces the old "notification deep-links OUT to /sign/[placementId]
// in the system browser" pattern with a native-feeling Mini App that
// never leaves Telegram. Single route, SPA-like internal view-state
// (list → preview → signing/success) driven entirely client-side —
// Telegram's BackButton controls in-app state, not browser navigation
// (see app/telegram-app/telegram-mini-app.tsx).
//
// No session/cookie auth here at all: every piece of data this page
// shows comes from client-side fetches carrying the Telegram SDK's raw
// `initData` string, verified fresh on every request server-side
// (lib/telegram/webapp-auth.ts). This page itself renders no server
// data — it's a plain client shell.
//
// `strategy="afterInteractive"` (not `beforeInteractive`): Next.js's App
// Router only allows `beforeInteractive` scripts inside the ROOT layout
// (app/layout.tsx), and loading Telegram's SDK globally on every single
// page of the main admin app would be both wrong (it's irrelevant there)
// and wasteful. `afterInteractive` still runs before the user can
// meaningfully interact with this page; `use-telegram-webapp.ts`'s hook
// briefly polls for `window.Telegram.WebApp` on mount (handles the rare
// case the script hasn't finished executing yet) before falling back to
// "not inside Telegram" cleanly.
import Script from "next/script";
import { TelegramMiniApp } from "./telegram-mini-app";

export const dynamic = "force-dynamic";

export default function TelegramAppPage() {
  return (
    <>
      <Script
        src="https://telegram.org/js/telegram-web-app.js?64"
        strategy="afterInteractive"
      />
      <TelegramMiniApp />
    </>
  );
}
