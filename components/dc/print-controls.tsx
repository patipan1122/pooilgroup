"use client";

// DC · ปุ่มพิมพ์ + auto-print + ดาวน์โหลด (ใช้คู่กับ <DcPrintDoc>).
//   <PrintButton href="/dc/.../print" /> — เปิดหน้าเอกสารพิมพ์ในแท็บใหม่
//   <AutoPrint />                          — วางในหน้า print route → เด้ง print อัตโนมัติเมื่อโหลดเสร็จ
//   <DcDocDownload pngHref printHref />    — 2 ปุ่ม: 🖼️ ดาวน์โหลดรูป (ส่งไลน์) + 📄 ดาวน์โหลด PDF

import { useEffect } from "react";
import Link from "next/link";
import { Printer, ImageDown, FileDown } from "lucide-react";

export function PrintButton({
  href,
  label = "พิมพ์",
}: {
  href: string;
  label?: string;
}) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="dc-print-hide"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        minHeight: 40,
        padding: "0 14px",
        borderRadius: 10,
        border: "1px solid var(--dc-line, #e7ebf2)",
        background: "#fff",
        color: "var(--dc-ink, #1c2533)",
        fontSize: 13.5,
        fontWeight: 700,
        textDecoration: "none",
        cursor: "pointer",
      }}
    >
      <Printer size={16} /> {label}
    </Link>
  );
}

// ── สไตล์ปุ่มกลาง (เหมือน PrintButton) ────────────────────────────
const docBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  minHeight: 40,
  padding: "0 14px",
  borderRadius: 10,
  border: "1px solid var(--dc-line, #e7ebf2)",
  background: "#fff",
  color: "var(--dc-ink, #1c2533)",
  fontSize: 13.5,
  fontWeight: 700,
  textDecoration: "none",
  cursor: "pointer",
};

/**
 * 2 ปุ่มดาวน์โหลดเอกสาร (ใช้ในหน้ารายละเอียดใบทุกชนิด):
 *   🖼️ ดาวน์โหลดรูป — ลิงก์ไป route `/image` (attachment PNG) → โหลดลงเครื่อง → ส่งลงไลน์
 *   📄 ดาวน์โหลด PDF — เปิด route `/print` แท็บใหม่ (AutoPrint เด้ง print) → ผู้ใช้ "Save as PDF"
 * pngHref เว้นได้ (บางใบยังไม่มีรูป) → โชว์เฉพาะปุ่ม PDF.
 */
export function DcDocDownload({
  pngHref,
  printHref,
  pngLabel = "ดาวน์โหลดรูป",
  pdfLabel = "ดาวน์โหลด PDF",
}: {
  pngHref?: string;
  printHref: string;
  pngLabel?: string;
  pdfLabel?: string;
}) {
  return (
    <div className="dc-print-hide" style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
      {pngHref ? (
        // <a download>: ปล่อยให้เบราว์เซอร์โหลดไฟล์ (route ตั้ง Content-Disposition: attachment)
        <a href={pngHref} download style={docBtnStyle} title="บันทึกเป็นรูป (ส่งลงไลน์ได้)">
          <ImageDown size={16} /> {pngLabel}
        </a>
      ) : null}
      <Link href={printHref} target="_blank" rel="noopener noreferrer" style={docBtnStyle} title="เปิดหน้าเอกสาร → บันทึกเป็น PDF">
        <FileDown size={16} /> {pdfLabel}
      </Link>
    </div>
  );
}

export function AutoPrint() {
  useEffect(() => {
    // หน่วงเล็กน้อยให้รูป/ฟอนต์โหลดก่อนค่อยเด้ง print
    const t = setTimeout(() => {
      try {
        window.print();
      } catch {
        /* ผู้ใช้กดพิมพ์เองได้ */
      }
    }, 450);
    return () => clearTimeout(t);
  }, []);
  return null;
}
