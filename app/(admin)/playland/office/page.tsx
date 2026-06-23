// Playland · "หลังร้าน" (Back-office hub)
//
// หน้ารวมงานจัดการทั้งหมด — landing ของโหมดหลังร้าน · การ์ดใหญ่กดง่าย ลิงก์ไปหน้าเดิม
// (ไม่ย้าย route เดิม → ลิงก์ทุกหน้ายังทำงาน · หน้าปลายทางคุม role gate ของตัวเอง)

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/module-access";
import { requirePlaylandAccess } from "@/lib/playland/role-guard";
import { PlaylandModeSwitch } from "@/components/playland/mode-switch";
import {
  BarChart3, Clock, CalendarClock, Users, Watch, ShieldAlert, History, Settings, Sparkles,
} from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "หลังร้าน · Playland" };

type HubItem = {
  href: string;
  title: string;
  desc: string;
  icon: React.ComponentType<{ size?: number }>;
  adminOnly?: boolean;
};

const ITEMS: HubItem[] = [
  { href: "/playland/reports", title: "รายงาน", desc: "ยอดขาย · จำนวนเด็ก · สรุปรายวัน/เดือน", icon: BarChart3 },
  { href: "/playland/shifts", title: "กะ · ปิดวัน", desc: "เปิด/ปิดกะ · นับเงิน · ส่งยอดสิ้นวัน", icon: Clock },
  { href: "/playland/bookings", title: "การจอง", desc: "รายการจองล่วงหน้า · ยืนยัน · ยกเลิก", icon: CalendarClock },
  { href: "/playland/members", title: "สมาชิก", desc: "ทะเบียนเด็ก · ครอบครัว · ประวัติการเล่น", icon: Users },
  { href: "/playland/wristbands", title: "สายรัดข้อมือ · อุปกรณ์", desc: "ออกสายรัด · ผูกอุปกรณ์ · สถานะ", icon: Watch },
  { href: "/playland/overrides", title: "เปิดประตูเอง", desc: "สั่งเปิดประตูด้วยมือ · บันทึกเหตุผล", icon: ShieldAlert, adminOnly: true },
  { href: "/playland/audit", title: "Audit Log", desc: "ประวัติการกระทำทั้งหมดในระบบ", icon: History, adminOnly: true },
  { href: "/playland/settings", title: "ตั้งค่า", desc: "สาขา · แพ็กเกจ · สินค้า · อุปกรณ์ · โปรโมชั่น", icon: Settings, adminOnly: true },
];

export default async function PlaylandOfficeHub() {
  const session = await requireSession();
  requirePlaylandAccess(session.user.role);
  const admin = isAdminTier(session.user.role);
  const items = ITEMS.filter((it) => !it.adminOnly || admin);

  return (
    <div className="pl-page" style={{ overflowY: "auto" }}>
      <header className="pl-header">
        <div>
          <div className="pl-eyebrow">
            <Sparkles size={11} />
            <span className="pl-logo-text" style={{ fontSize: "1rem" }}>
              Play <span className="pl-logo-a">a</span> lot
            </span>
            · หลังร้าน
          </div>
          <h1>จัดการระบบ</h1>
        </div>
        <PlaylandModeSwitch />
      </header>

      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "20px 24px 0" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/playland/brand/mascot-skye.png" alt="" width={56} height={56} style={{ objectFit: "contain" }} />
        <div style={{ fontSize: "0.9rem", color: "var(--pl-text-muted)", lineHeight: 1.5, maxWidth: 560 }}>
          ส่วนหลังร้าน — งานจัดการที่ไม่ต้องรีบ · รายงาน ตั้งค่า และดูประวัติ ·
          กดปุ่ม <strong style={{ color: "var(--pl-text)" }}>หน้าร้าน</strong> มุมขวาบนเพื่อกลับไปงานเคาน์เตอร์
        </div>
      </div>

      <div className="pl-hub-grid">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <Link key={it.href} href={it.href} className="pl-hub-card">
              <div className="pl-hub-ico"><Icon size={22} /></div>
              <div className="pl-hub-title">{it.title}</div>
              <div className="pl-hub-desc">{it.desc}</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
