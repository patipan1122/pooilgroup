// Public surface for ระบบแจ้งซ่อม — NO auth required.
// Routes: /r (landing) · /r/new (submit) · /r/track · /r/track/[code]
import Link from "next/link";
import { Wrench } from "lucide-react";
import "./repair-form.css";

export const dynamic = "force-dynamic";

export default function RepairPublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="rf-root" style={{ minHeight: "100vh", background: "linear-gradient(180deg, #F4F6FA 0%, #FFFFFF 100%)" }}>
      <header style={{
        position: "sticky", top: 0, zIndex: 30,
        background: "rgba(255, 255, 255, 0.92)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid #E5EAF2",
      }}>
        <div style={{
          maxWidth: 1100, margin: "0 auto",
          padding: "0 16px", height: 56,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <Link href="/r" style={{
            display: "flex", alignItems: "center", gap: 8,
            fontWeight: 700, color: "#0B1220", textDecoration: "none",
          }}>
            <span style={{
              width: 32, height: 32, borderRadius: 8,
              background: "linear-gradient(135deg, #1E4FCC, #0B2766)",
              color: "white", display: "grid", placeItems: "center",
            }}>
              <Wrench size={16} />
            </span>
            <span style={{ fontSize: 15, letterSpacing: "-0.01em" }}>ระบบแจ้งซ่อม</span>
          </Link>
          <nav style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
            <Link href="/r/new" style={navLink}>แจ้งใหม่</Link>
            <Link href="/r/track" style={navLink}>ติดตาม</Link>
          </nav>
        </div>
      </header>
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 16px 32px" }}>
        {children}
      </main>
      <footer style={{
        maxWidth: 1100, margin: "0 auto",
        padding: "16px", fontSize: 11.5, color: "#94A3B8",
        textAlign: "center",
      }}>
        © Pooilgroup · ระบบแจ้งซ่อม · ใช้สำหรับแจ้งงานซ่อมภายในเท่านั้น
      </footer>
    </div>
  );
}

const navLink: React.CSSProperties = {
  padding: "0 12px", height: 34,
  display: "inline-flex", alignItems: "center",
  borderRadius: 7, fontWeight: 600, color: "#374151",
  textDecoration: "none",
};
