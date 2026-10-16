// Layout for /telegram-app — deliberately NOT under app/(admin)/, so it
// never inherits that group's sidebar/top-bar chrome. The root
// app/layout.tsx above this still applies (fonts, <Toaster/>, white body
// background) — same pattern app/sign/[placementId] already uses for a
// chrome-less, full-bleed page.
//
// `./telegram-app.css` is imported here (not globally) so its keyframes/
// vars only ever load for this route — same convention as every other
// module's scoped CSS file (see app/(admin)/docuflow/layout.tsx →
// docuflow.css).
//
// `viewport-fit: cover` is what makes env(safe-area-inset-*) resolve to
// real values on iOS inside Telegram's WebView — root layout's viewport
// intentionally does NOT set this project-wide yet (held pending a
// separate cross-module check), so it's set here, scoped to just this
// route segment.
import type { Metadata, Viewport } from "next";
import "./telegram-app.css";

export const metadata: Metadata = {
  title: "เซ็นเอกสาร",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function TelegramAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
