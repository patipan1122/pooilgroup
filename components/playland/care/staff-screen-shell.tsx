"use client";

// Playland · Front-of-house STAFF kiosk shell — full-screen wrapper for staff recording screens.
// ใช้เต็มจอ (z-40) ทับ AdminShell + แถบอนุมัติ · พื้นครีม #F7F2EA + กรอบขาว ตรงกับ "Play a lot" kiosk.
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const INK = "#3A3026";
const MUTED = "#8a7f70";
const BLUE = "#2D6CB1";
const LINE = "#ece5d8";

export function StaffScreenShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        // FULL-SCREEN kiosk: ทับ admin sidebar + แถบอนุมัติสีน้ำเงิน
        position: "fixed",
        inset: 0,
        zIndex: 40,
        fontFamily: MITR,
        color: INK,
        background: "#F7F2EA",
        overflowY: "auto",
      }}
    >
      {/* กรอบขาว max-width กึ่งกลาง — สวยบนจอใหญ่ · เต็มจอเล็ก/แท็บเล็ต */}
      <div
        style={{
          width: "100%",
          maxWidth: 1180,
          minHeight: "100dvh",
          margin: "0 auto",
          background: "#fff",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* sticky header — ปุ่มกลับซ้าย + ชื่อหน้ากลาง */}
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 2,
            flex: "none",
            background: "#fff",
            borderBottom: `1px solid ${LINE}`,
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "14px 28px",
          }}
        >
          <Link
            href="/playland"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              background: "#F7F2EA",
              border: `1px solid ${LINE}`,
              borderRadius: 999,
              padding: "8px 16px",
              color: BLUE,
              textDecoration: "none",
              fontSize: 14,
              fontWeight: 500,
              fontFamily: MITR,
              whiteSpace: "nowrap",
            }}
          >
            <ArrowLeft size={16} /> กลับหน้าร้าน
          </Link>
          <div style={{ width: 1, height: 28, background: LINE, flex: "none" }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: "1.25rem", color: INK, lineHeight: 1.2 }}>
              {title}
            </div>
            {subtitle ? (
              <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{subtitle}</div>
            ) : null}
          </div>
        </div>

        {/* เนื้อหา — ฟอร์มวางตรงนี้ */}
        <div style={{ flex: 1, minHeight: 0, padding: "26px 28px 40px" }}>{children}</div>
      </div>
    </div>
  );
}
