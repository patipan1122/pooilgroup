// /r/track — entry form (Pooil App design vocab)
import Link from "next/link";
import { TrackForm } from "@/components/repair/track-form";
import { Search, ChevronLeft, Plus } from "lucide-react";

export const dynamic = "force-dynamic";

interface Search { code?: string; error?: string }

export default async function RepairTrackEntryPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const p = await searchParams;
  return (
    <div style={{ maxWidth: 480, margin: "0 auto" }}>
      <Link
        href="/r"
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          fontSize: 12, color: "#1740A3", fontWeight: 600,
          textDecoration: "none", marginBottom: 12,
        }}
      >
        <ChevronLeft size={13} />
        กลับหน้าหลัก
      </Link>

      <div style={{
        background: "white", border: "1px solid #E5EAF2",
        borderRadius: 24, padding: 28, textAlign: "center",
        marginBottom: 12,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: "#EFF4FF", color: "#1740A3",
          display: "grid", placeItems: "center", margin: "0 auto 12px",
        }}>
          <Search size={22} />
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.015em", color: "#0B1220", margin: 0 }}>
          ติดตามใบแจ้งซ่อม
        </h1>
        <p style={{ marginTop: 8, fontSize: 13, color: "#475569", lineHeight: 1.5 }}>
          กรอกเลขที่ใบ + เบอร์โทรที่ใช้ตอนแจ้ง
          <br />
          ระบบจะแสดงสถานะปัจจุบัน + รูปงาน + ช่างที่ดูแล
        </p>
      </div>

      <TrackForm initialCode={p.code ?? ""} initialError={p.error ?? null} />

      <div style={{
        background: "#F8FAFD", border: "1px solid #E5EAF2",
        borderRadius: 14, padding: 14, marginTop: 12,
        fontSize: 11.5, color: "#475569", lineHeight: 1.5,
      }}>
        <p style={{ margin: 0 }}>
          <b style={{ color: "#0B1220" }}>หมายเหตุ:</b> ระบบจำกัดจำนวนครั้งที่ค้นต่อ IP
          (anti-bruteforce) · ถ้าค้นบ่อยเกินไปจะถูกบล็อก 10 นาที
        </p>
        <p style={{ marginTop: 8, marginBottom: 0 }}>
          ลืมเลขที่ใบ? · ดู SMS ที่เคยได้รับ หรือ
          <Link
            href="/r/new"
            style={{
              fontWeight: 600, color: "#1740A3", textDecoration: "none",
              marginLeft: 4,
              display: "inline-flex", alignItems: "center", gap: 2,
            }}
          >
            <Plus size={11} /> แจ้งใบใหม่
          </Link>
        </p>
      </div>
    </div>
  );
}
