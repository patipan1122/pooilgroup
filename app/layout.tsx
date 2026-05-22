import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, IBM_Plex_Sans_Thai, IBM_Plex_Mono, Anuphan } from "next/font/google";
import { Toaster } from "sonner";
import { ServiceWorkerRegister } from "@/components/layout/sw-register";
import "./globals.css";

// Plus Jakarta Sans — Latin display (Auditmekub/Fastwork-style geometric SaaS)
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

// Anuphan — Thai display (heavy chunky bold for headlines)
const anuphan = Anuphan({
  variable: "--font-thai-display",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// IBM Plex Sans Thai — Thai body
const thaiSans = IBM_Plex_Sans_Thai({
  variable: "--font-thai",
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

// IBM Plex Mono — used by CashHub Redesign numbered pills (.ch-pill .num)
// + tnum-heavy numeric callouts. Scoped to .ch-scope via tokens.css.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pooilgroup ERP",
  description: "ระบบบริหารจัดการ Pooilgroup — ยอดสาขา / เอกสาร / ขนส่งน้ำมัน",
  robots: { index: false, follow: false },
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "Pooilgroup", statusBarStyle: "default" },
};

// CEO 2026-05-20: ปลด zoom lock เพื่อ WCAG 1.4.4 + ผู้สูงอายุที่ขยายดู
// คงค่าอื่นไว้เพื่อ PWA + safe-area
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="th"
      className={`${jakarta.variable} ${anuphan.variable} ${thaiSans.variable} ${plexMono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full antialiased font-thai bg-white text-zinc-900">
        <ServiceWorkerRegister />
        {children}
        <Toaster
          position="top-center"
          richColors
          theme="light"
          toastOptions={{
            style: {
              fontFamily: "var(--font-thai)",
            },
          }}
        />
      </body>
    </html>
  );
}
