import type { Metadata, Viewport } from "next";
import { Sora, IBM_Plex_Sans_Thai } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

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
      className={`${sora.variable} ${thaiSans.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full antialiased font-thai bg-zinc-50 text-zinc-900">
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
