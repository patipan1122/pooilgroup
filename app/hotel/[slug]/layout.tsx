// Public hotel layout · uses system font stack (no Google Fonts fetch at
// build time). Apple devices get SF Pro Thai + Noto Sans Thai · others get
// platform defaults. Display headings use a serif-leaning stack for editorial feel.

import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export default function HotelPublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="hotel-scope min-h-screen">
      <style>{`
        .hotel-scope { --font-sarabun: ui-serif, Georgia, "Noto Serif Thai", "Times New Roman", serif; }
        .hotel-scope { --font-noto-thai: -apple-system, BlinkMacSystemFont, "Noto Sans Thai", "Segoe UI", "Helvetica Neue", system-ui, sans-serif; }
      `}</style>
      {children}
    </div>
  );
}
