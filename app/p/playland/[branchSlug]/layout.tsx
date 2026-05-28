// Public Playland routes — NO auth required
// Used for: booking online, mobile face register, payment confirmation

import "../../../(admin)/playland/playland.css";

export const dynamic = "force-dynamic";

export default function PublicPlaylandLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pl-root" style={{ minHeight: "100vh", background: "var(--pl-canvas)" }}>
      {children}
    </div>
  );
}
