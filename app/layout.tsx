import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, IBM_Plex_Sans_Thai, Anuphan } from "next/font/google";
import { Toaster } from "sonner";
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

export const metadata: Metadata = {
  title: "Pool Group ERP",
  description: "ระบบบริหารจัดการ Pool Group — ยอดสาขา / เอกสาร / ขนส่งน้ำมัน",
  robots: { index: false, follow: false },
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "Pool Group", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="th"
      className={`${jakarta.variable} ${anuphan.variable} ${thaiSans.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full antialiased font-thai bg-white text-zinc-900">
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
