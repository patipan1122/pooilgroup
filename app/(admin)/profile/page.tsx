import Link from "next/link";
import { ShieldCheck, ChevronRight, MessageSquare, Smartphone } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await requireSession();
  const lineLinked = !!session.user.line_user_id;
  const telegramLinked = !!session.user.telegram_user_id;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto">
      <div className="mb-6 animate-fade-up">
        <p className="text-xs uppercase tracking-widest text-[var(--color-brand-600)] font-semibold">
          บัญชี
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight font-display mt-2">
          โปรไฟล์ <span className="accent">ของฉัน</span>
        </h1>
        <p className="text-zinc-600 mt-2 text-sm">
          แก้ไขข้อมูลส่วนตัว · เปลี่ยนรหัสผ่าน
        </p>
      </div>
      <ProfileForm
        userId={session.user.id}
        name={session.user.name}
        email={session.user.email}
        phone={session.user.phone}
        role={session.user.role}
      />

      <Link
        href="/profile/sessions"
        className="mt-4 flex items-center justify-between gap-3 rounded-2xl border-2 border-zinc-200 bg-white px-4 py-3.5 hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]/40 transition-colors animate-fade-up delay-200"
      >
        <span className="flex items-center gap-3">
          <span className="size-10 rounded-xl bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] flex items-center justify-center text-[var(--color-brand-700)]">
            <ShieldCheck className="size-5" />
          </span>
          <span>
            <span className="block font-semibold text-sm">
              อุปกรณ์ที่เข้าใช้
            </span>
            <span className="block text-xs text-zinc-500">
              ดู Login จากที่ไหนบ้าง · ออกจากระบบที่ไม่ใช่ของคุณ
            </span>
          </span>
        </span>
        <ChevronRight className="size-5 text-zinc-400" />
      </Link>

      <Card className="mt-4 animate-fade-up delay-250">
        <CardHeader>
          <CardTitle>ช่องทางแจ้งเตือน</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <ChannelRow
            icon={<MessageSquare className="size-5" />}
            name="Telegram Bot"
            description="รับการแจ้งเตือน + อนุมัติงานจาก Telegram โดยตรง"
            linked={telegramLinked}
            disabled
          />
          <ChannelRow
            icon={<Smartphone className="size-5" />}
            name="LINE LIFF"
            description="ใช้ Rich Menu บน LINE เพื่อกรอกรายงานสาขา"
            linked={lineLinked}
            disabled
          />
          <p className="text-xs text-zinc-400 pt-1 border-t border-zinc-100">
            ⏳ ผูกบัญชี Telegram / LINE ใช้งานได้หลังจาก Admin ตั้ง Bot/Channel
            (Phase ถัดไป)
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function ChannelRow({
  icon,
  name,
  description,
  linked,
  disabled,
}: {
  icon: React.ReactNode;
  name: string;
  description: string;
  linked: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-zinc-100 text-zinc-600 flex items-center justify-center">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-sm">{name}</div>
          <div className="text-xs text-zinc-500">{description}</div>
        </div>
      </div>
      {linked ? (
        <Badge tone="success">ผูกแล้ว</Badge>
      ) : (
        <Badge tone={disabled ? "neutral" : "warning"}>
          {disabled ? "ยังไม่พร้อม" : "ยังไม่ผูก"}
        </Badge>
      )}
    </div>
  );
}
