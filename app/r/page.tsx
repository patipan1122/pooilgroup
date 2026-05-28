// /r — Public landing (Pooil App design vocab)
import Link from "next/link";
import {
  Plus,
  Search,
  ShieldCheck,
  Clock,
  Camera,
  MessageCircle,
  ChevronRight,
  Sparkles,
} from "lucide-react";

export default function RepairPublicLanding() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720, margin: "0 auto" }}>
      {/* Hero */}
      <div className="rf-hero">
        <div className="rf-hero-mark">P</div>
        <h1>แจ้งซ่อมง่าย ๆ ใน 30 วินาที</h1>
        <div className="sub">
          ถ่ายรูป → กรอกชื่อ + เบอร์ → ส่ง · ได้เลขที่ใบทันที
          <br />
          เก็บลิ้งค์ติดตามสถานะได้ตลอด
        </div>
      </div>

      {/* Primary actions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Link
          href="/r/new"
          style={{
            borderRadius: 20, padding: 24,
            background: "#EFF4FF",
            border: "1.5px solid #DBE6FF",
            textDecoration: "none", color: "inherit",
            display: "flex", flexDirection: "column", gap: 8,
          }}
        >
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: "#1E4FCC", color: "white",
            display: "grid", placeItems: "center",
          }}>
            <Plus size={24} />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0B1220", margin: "12px 0 0" }}>
            แจ้งซ่อมใหม่
          </h2>
          <p style={{ fontSize: 12.5, color: "#374151", margin: 0 }}>
            เปิดใบใหม่ · ไม่ต้องสมัครสมาชิก · 30 วินาที
          </p>
          <p style={{
            fontSize: 12.5, fontWeight: 700, color: "#1740A3",
            display: "inline-flex", alignItems: "center", gap: 4,
            marginTop: 6,
          }}>
            เริ่มเปิดใบ <ChevronRight size={14} />
          </p>
        </Link>

        <Link
          href="/r/track"
          style={{
            borderRadius: 20, padding: 24,
            background: "white",
            border: "1.5px solid #E5EAF2",
            textDecoration: "none", color: "inherit",
            display: "flex", flexDirection: "column", gap: 8,
          }}
        >
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: "#0B1220", color: "white",
            display: "grid", placeItems: "center",
          }}>
            <Search size={24} />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0B1220", margin: "12px 0 0" }}>
            ติดตามใบของฉัน
          </h2>
          <p style={{ fontSize: 12.5, color: "#374151", margin: 0 }}>
            มีเลขที่ใบ + เบอร์ที่กรอก · ดูสถานะ + รูป + ช่างได้
          </p>
          <p style={{
            fontSize: 12.5, fontWeight: 700, color: "#0B1220",
            display: "inline-flex", alignItems: "center", gap: 4,
            marginTop: 6,
          }}>
            เปิดดู <ChevronRight size={14} />
          </p>
        </Link>
      </div>

      {/* How-it-works */}
      <div style={{
        background: "white", border: "1px solid #E5EAF2",
        borderRadius: 20, padding: 24,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          marginBottom: 14,
        }}>
          <Sparkles size={14} style={{ color: "#1E4FCC" }} />
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#0B1220", margin: 0 }}>
            หลังจากกดส่ง
          </h3>
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <Step icon={<ShieldCheck size={14} />}
            title="ได้เลขที่ใบทันที"
            sub="เก็บไว้ตามงาน · เช่น RP-2569-0001"
          />
          <Step icon={<Clock size={14} />}
            title="ทีมงานเห็นทันที"
            sub="ด่วนมาก ตอบใน 4 ชม. · ปานกลาง 24 ชม. · ไม่เร่ง 3 วัน"
          />
          <Step icon={<Camera size={14} />}
            title="รูปก่อน/หลัง"
            sub="ทุกขั้นตอนจะมีรูปยืนยันงาน"
          />
          <Step icon={<MessageCircle size={14} />}
            title="ติดตามได้ตลอด"
            sub="เปิดลิ้งค์ /r/track + เลขที่ใบ + เบอร์ของคุณ"
          />
        </ul>
      </div>

      <div style={{ textAlign: "center", fontSize: 11.5, color: "#94A3B8" }}>
        ลิงก์นี้สามารถแชร์ทาง LINE / แปะที่ร้านได้
      </div>
    </div>
  );
}

function Step({
  icon, title, sub,
}: {
  icon: React.ReactNode; title: string; sub: string;
}) {
  return (
    <li style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <span style={{
        width: 32, height: 32, borderRadius: 8,
        background: "#EFF4FF", color: "#1740A3",
        display: "grid", placeItems: "center", flexShrink: 0,
      }}>
        {icon}
      </span>
      <div>
        <div style={{ fontWeight: 700, fontSize: 13.5, color: "#0B1220" }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "#475569" }}>{sub}</div>
      </div>
    </li>
  );
}
