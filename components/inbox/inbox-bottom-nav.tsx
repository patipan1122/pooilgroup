"use client";

// Inbox · เมนูแถบล่าง (mobile bottom nav) — ตอบแชตลูกค้าผ่านมือถือสะดวก
// แสดงเฉพาะจอเล็ก (<1024px · class inbox-mobile-nav ใน inbox.css) · เดสก์ท็อปใช้ฟิลเตอร์ rail
// ซ่อนเองเมื่อเปิดบทสนทนาอยู่ (?c=) → ให้หน้าแชตเต็มจอ ไม่ทับกล่องพิมพ์ตอบ

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  MessageSquare,
  Hand,
  AlertTriangle,
  Bot,
  PlugZap,
  type LucideIcon,
} from "lucide-react";

type Tab = { href: string; label: string; icon: LucideIcon; key: string };

export function InboxBottomNav({
  canBot,
  canChannels,
}: {
  canBot: boolean;
  canChannels: boolean;
}) {
  const pathname = usePathname() || "";
  const params = useSearchParams();

  // เปิดบทสนทนาอยู่บนมือถือ = หน้าแชตเต็มจอ → ซ่อน nav (ไม่ให้บังกล่องพิมพ์)
  if (pathname === "/inbox" && params.has("c")) return null;

  const onList = pathname === "/inbox";
  const human = params.has("human");
  const urgent = params.has("urgent");

  const tabs: Tab[] = [
    { key: "chat", href: "/inbox", label: "แชต", icon: MessageSquare },
    { key: "human", href: "/inbox?human=1", label: "ต้องตอบ", icon: Hand },
    { key: "urgent", href: "/inbox?urgent=1", label: "ด่วน", icon: AlertTriangle },
  ];
  if (canBot) tabs.push({ key: "bot", href: "/inbox/bot", label: "บอท", icon: Bot });
  if (canChannels)
    tabs.push({
      key: "channels",
      href: "/inbox/settings/channels",
      label: "ช่องทาง",
      icon: PlugZap,
    });

  function isActive(key: string): boolean {
    switch (key) {
      case "chat":
        return onList && !human && !urgent;
      case "human":
        return onList && human;
      case "urgent":
        return onList && urgent;
      case "bot":
        return pathname.startsWith("/inbox/bot");
      case "channels":
        return pathname.startsWith("/inbox/settings");
      default:
        return false;
    }
  }

  return (
    <nav className="inbox-mobile-nav" aria-label="เมนูแถบล่าง กล่องข้อความ">
      {tabs.map((t) => {
        const active = isActive(t.key);
        return (
          <Link
            key={t.key}
            href={t.href}
            className={`inbox-mnav__tab${active ? " is-active" : ""}`}
            aria-label={t.label}
            aria-current={active ? "page" : undefined}
          >
            <t.icon size={21} strokeWidth={active ? 2.4 : 1.9} />
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
