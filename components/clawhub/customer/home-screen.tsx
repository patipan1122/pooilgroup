"use client";

// ClawHub home — points balance (big) + nearest expiry + 4 big action buttons.
// If the member hasn't consented yet, we route them to register/consent first.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useClawhub } from "./liff-context";
import { CwHeader, CwBalance, formatThaiDate, daysUntil } from "./ui";

export function HomeScreen() {
  const router = useRouter();
  const { member } = useClawhub();

  // No consent yet → send to register before anything else.
  useEffect(() => {
    if (member && !member.consented) {
      router.replace("/liff/clawhub?screen=register");
    }
  }, [member, router]);

  const balance = member?.balance ?? 0;
  const expDays = daysUntil(member?.nearestExpiryAt ?? null);

  const actions: { href: string; emoji: string; label: string; sub: string }[] = [
    {
      href: "/liff/clawhub?screen=refund",
      emoji: "💸",
      label: "ขอคืนเงิน",
      sub: "ตู้มีปัญหา · ถ่ายรูปจอ",
    },
    {
      href: "/liff/clawhub?screen=rewards",
      emoji: "🧸",
      label: "แลกตุ๊กตา",
      sub: "ใช้แต้มแลกของ",
    },
    {
      href: "/liff/clawhub?screen=points",
      emoji: "⭐",
      label: "แต้ม & ประวัติ",
      sub: "ดูแต้ม · รายการ",
    },
    {
      href: "/liff/clawhub?screen=help",
      emoji: "💬",
      label: "ช่วยเหลือ",
      sub: "คำถามที่พบบ่อย",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-md pb-10">
      <CwHeader title={member ? `สมาชิก ${member.memberCode}` : "สมาชิก"} />

      {/* balance hero */}
      <div className="px-4">
        <div
          className="cw-card overflow-hidden p-5"
          style={{
            background:
              "linear-gradient(135deg, var(--cw-brand-50), var(--cw-bg-2))",
            borderColor: "var(--cw-border-strong)",
          }}
        >
          <div className="text-[13px] font-semibold" style={{ color: "var(--cw-text-2)" }}>
            แต้มของคุณ
          </div>
          <div className="mt-1">
            <CwBalance points={balance} />
          </div>
          {member?.nearestExpiryAt ? (
            <div
              className="mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold"
              style={{ background: "var(--cw-pending-soft)", color: "var(--cw-brand-700)" }}
            >
              ⏳ {member.nearestExpiryPoints.toLocaleString("th-TH")} แต้ม หมดอายุ{" "}
              {formatThaiDate(member.nearestExpiryAt)}
              {expDays != null ? ` (อีก ${expDays} วัน)` : ""}
            </div>
          ) : (
            <div className="mt-2 text-[12.5px]" style={{ color: "var(--cw-text-3)" }}>
              ยังไม่มีแต้มหมดอายุเร็ว ๆ นี้
            </div>
          )}
        </div>
      </div>

      {/* 4 big buttons */}
      <div className="mt-4 grid grid-cols-2 gap-3 px-4">
        {actions.map((a) => (
          <a
            key={a.href}
            href={a.href}
            className="cw-card flex flex-col gap-1 p-4 active:scale-[0.98]"
            style={{ minHeight: 104, transition: "transform 0.08s" }}
          >
            <span className="text-3xl leading-none">{a.emoji}</span>
            <span className="mt-1 text-[15px] font-bold" style={{ color: "var(--cw-text)" }}>
              {a.label}
            </span>
            <span className="text-[12px]" style={{ color: "var(--cw-text-3)" }}>
              {a.sub}
            </span>
          </a>
        ))}
      </div>

      <p className="mt-6 px-6 text-center text-[11.5px]" style={{ color: "var(--cw-text-3)" }}>
        เครื่องจำหน่ายสินค้าอัตโนมัติ ไม่ใช่การพนัน
      </p>
    </div>
  );
}
