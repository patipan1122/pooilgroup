"use client";

// ClawHub home — points balance hero (big number + expiry countdown) + 4 big action
// tiles. If the member hasn't consented yet, we route them to register/consent first.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useClawhub } from "./liff-context";
import { CwHeader, CwMembershipCard, CwMascot, CW_MASCOT } from "./ui";

export function HomeScreen() {
  const router = useRouter();
  const { member, profile } = useClawhub();

  // No consent yet → send to register before anything else.
  useEffect(() => {
    if (member && !member.consented) {
      router.replace("/liff/clawhub?screen=register");
    }
  }, [member, router]);

  const balance = member?.balance ?? 0;
  const greetName = member?.fullName || member?.displayName || profile?.displayName || "";

  const actions: {
    href: string;
    emoji: string;
    label: string;
    sub: string;
    accent: string;
    soft: string;
  }[] = [
    {
      href: "/liff/clawhub?screen=refund",
      emoji: "💸",
      label: "ขอคืนแต้ม",
      sub: "ตู้มีปัญหา · ถ่ายรูปจอ",
      accent: "var(--cw-brand-700)",
      soft: "var(--cw-brand-50)",
    },
    {
      href: "/liff/clawhub?screen=rewards",
      emoji: "🧸",
      label: "แลกตุ๊กตา",
      sub: "ใช้แต้มแลกของรางวัล",
      accent: "var(--cw-teal)",
      soft: "var(--cw-teal-soft)",
    },
    {
      href: "/liff/clawhub?screen=points",
      emoji: "⭐",
      label: "แต้ม & ประวัติ",
      sub: "ดูแต้ม · รายการย้อนหลัง",
      accent: "var(--cw-brand-700)",
      soft: "var(--cw-brand-50)",
    },
    {
      href: "/liff/clawhub?screen=help",
      emoji: "💬",
      label: "ช่วยเหลือ",
      sub: "คำถามที่พบบ่อย · ติดต่อ",
      accent: "var(--cw-red)",
      soft: "var(--cw-red-soft)",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-md pb-10">
      <CwHeader title={member ? `สมาชิก ${member.memberCode}` : "สมาชิก"} />

      {/* welcome row — mascot + greeting */}
      <div className="flex items-center gap-3 px-4 pb-2">
        <CwMascot src={CW_MASCOT.knightDragon} alt="อัศวินขี่มังกร JOLLY PLAY" size={72} />
        <div className="min-w-0">
          <p className="text-[16px] font-extrabold leading-tight" style={{ color: "var(--cw-text)" }}>
            สวัสดี{greetName ? ` ${greetName}` : ""} 👋
          </p>
          <p className="text-[12.5px]" style={{ color: "var(--cw-text-3)" }}>
            ยินดีต้อนรับกลับสู่ JOLLY PLAY
          </p>
        </div>
      </div>

      {/* digital membership card — the hero */}
      <div className="px-4">
        <CwMembershipCard
          name={greetName}
          memberCode={member?.memberCode ?? "—"}
          balance={balance}
          expiryAt={member?.nearestExpiryAt ?? null}
        />
      </div>

      {/* 4 big action tiles */}
      <div className="mt-4 grid grid-cols-2 gap-3 px-4">
        {actions.map((a) => (
          <a
            key={a.href}
            href={a.href}
            className="cw-card cw-tap flex flex-col gap-1 p-4"
            style={{ minHeight: 116 }}
          >
            <span
              className="grid size-11 place-items-center rounded-2xl text-2xl"
              style={{ background: a.soft }}
            >
              {a.emoji}
            </span>
            <span className="mt-1.5 text-[15.5px] font-extrabold" style={{ color: "var(--cw-text)" }}>
              {a.label}
            </span>
            <span className="text-[12px] leading-snug" style={{ color: "var(--cw-text-3)" }}>
              {a.sub}
            </span>
          </a>
        ))}
      </div>

      <p
        className="mt-7 px-6 text-center text-[11.5px] leading-relaxed"
        style={{ color: "var(--cw-text-3)" }}
      >
        JOLLY PLAY เป็นเครื่องจำหน่ายสินค้าอัตโนมัติ ไม่ใช่การพนัน
      </p>
    </div>
  );
}
