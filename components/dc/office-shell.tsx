// DC office content wrapper.
// CEO 2026-06-29: เลิกใช้ "shell ครีมแยก" ของ DC — ให้ DC ทุกหน้าใช้กรอบมาตรฐาน AdminShell
// ชุดเดียวกับทุกโปรแกรม (เมนูซ้าย/หัวบน/สลับโปรแกรม เหมือนกันหมด · กดข้ามหน้าเมนูไม่เปลี่ยน).
// เดิมไฟล์นี้วาด sidebar+topbar ครีมเต็มจอเอง → ทำให้ DC เหมือน "คนละระบบ".
// ตอนนี้เหลือเป็นแค่ตัวห่อบาง ๆ: ยังคง CSS vars (--primary ฯลฯ) + ฟอนต์/สครอลบาร์ของธีม DC
// ให้เนื้อหา (เนื้อหาใช้ var(--primary) อยู่) แต่ทิ้ง layout เต็มจอ (display:block) ให้ AdminShell
// เป็นคนคุมกรอบ/เมนู. ทุกหน้า /dc/office/* ที่ห่อด้วย <DcOfficeShell> จึงสลับมาใช้กรอบเดียวกันทันที
// โดยไม่ต้องแก้ทีละหน้า.
import "./dc-redesign.css";

export type DcNavKey =
  | "dash" | "po" | "suppliers" | "ship" | "grn"
  | "products" | "warehouses" | "transfer" | "count" | "reports" | "recon";

export type DcOfficeShellProps = {
  active?: DcNavKey;
  warehouseName?: string;
  userName?: string;
  userRole?: string;
  badges?: { po?: number; ship?: number; grn?: number };
  taskStrip?: { tracking: number; grn: number; inTransit: number } | null;
  children: React.ReactNode;
};

export function DcOfficeShell({ children }: DcOfficeShellProps) {
  // .dcx = CSS vars + ฟอนต์ + สครอลบาร์ของธีม DC (เนื้อหาพึ่ง var(--primary)).
  // override layout เต็มจอของ .dcx ออก → ไหลเป็นเนื้อหาปกติใน AdminShell.
  return (
    <div
      className="dcx"
      style={{ display: "block", height: "auto", overflow: "visible", background: "transparent" }}
    >
      {children}
    </div>
  );
}
