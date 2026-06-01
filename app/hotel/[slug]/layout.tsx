// Public hotel layout · inherits Pool's global IBM Plex Sans Thai from
// app/layout.tsx (the same font that the AuditMe Design System v2 uses).
// Provides .hotel-scope for any local style overrides + cream #EEEEE6 base
// + IBM Plex Mono var for tabular-nums on prices.

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
        .hotel-scope { --hotel-bg: #EEEEE6; --hotel-paper: #FAFAF7; --hotel-ink: #0F172A; --hotel-line: rgba(15,23,42,0.10); }
        .hotel-scope .mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-feature-settings: 'tnum'; }
        .hotel-scope .tnum { font-feature-settings: 'tnum'; }
        .hotel-scope .label-en {
          font-family: 'IBM Plex Mono', ui-monospace, monospace;
          font-size: 10px; font-weight: 600; letter-spacing: 0.18em;
          text-transform: uppercase; color: #64748B;
        }
      `}</style>
      {children}
    </div>
  );
}
