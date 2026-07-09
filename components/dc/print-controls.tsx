"use client";

// DC · ปุ่มพิมพ์ + auto-print (ใช้คู่กับ <DcPrintDoc>).
//   <PrintButton href="/dc/.../print" /> — เปิดหน้าเอกสารพิมพ์ในแท็บใหม่
//   <AutoPrint />                          — วางในหน้า print route → เด้ง print อัตโนมัติเมื่อโหลดเสร็จ

import { useEffect } from "react";
import Link from "next/link";
import { Printer } from "lucide-react";

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
