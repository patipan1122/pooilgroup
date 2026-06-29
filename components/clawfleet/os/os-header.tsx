"use client";

/**
 * ClawOS chrome — page header (ชื่อหน้า+คำอธิบายจาก routeMeta) + padding ของเนื้อหา ภายใน AdminShell.
 * Chrome มาตรฐาน (เมนูซ้าย · ติชม Pinpoint · กลับหน้าหลัก · เปลี่ยนโปรแกรม · Audit log) มาจาก AdminShell.
 * - หน้าบ้าน (/clawfleet/os/app): เต็มขอบ ไม่มี header/padding (แอปมือถือคุม layout เอง)
 * - หน้าหลังบ้านอื่น: header + padding
 */
import { usePathname } from "next/navigation";
import { routeMeta } from "./nav";

export function OsChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname.startsWith("/clawfleet/os/app")) return <>{children}</>;
  const meta = routeMeta(pathname);
  return (
    <div style={{ padding: "0 clamp(14px, 3vw, 28px) 48px" }}>
      <div style={{ padding: "20px 0 16px" }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px", color: "#1A1D21" }}>{meta.title}</h1>
        <div style={{ fontSize: 12.5, color: "#9AA1AB", marginTop: 2 }}>{meta.sub}</div>
      </div>
      {children}
    </div>
  );
}
