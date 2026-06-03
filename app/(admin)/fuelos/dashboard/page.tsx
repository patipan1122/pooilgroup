import Link from "next/link";
import { requireUser } from "@/lib/fuelos/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/fuelos/ui/page-header";
import { formatBaht, bkkStartOfToday } from "@/lib/fuelos/utils/format";
import {
  MessageSquareWarning, FileText, ClipboardList, TrendingUp, Bell, ArrowRight,
} from "lucide-react";

function startOfToday() {
  return bkkStartOfToday();
}

export default async function DashboardPage() {
  const user = await requireUser();
  const org = user.orgId;
  const today = startOfToday();

  const [unanswered, quotesToday, openOrders, ordersToday, overdueCustomers] =
    await Promise.all([
      prisma.conversation.count({ where: { orgId: org, isUnanswered: true } }),
      prisma.quote.count({ where: { orgId: org, quoteDate: { gte: today } } }),
      prisma.order.count({
        where: { orgId: org, status: { in: ["AWAITING_CONFIRM", "DELIVERING", "DELIVERED_UNPAID"] } },
      }),
      prisma.order.findMany({
        where: { orgId: org, createdAt: { gte: today } },
        select: { subtotal: true, totalProfit: true },
      }),
      prisma.customer.count({
        where: {
          orgId: org,
          isActive: true,
          firstOrderAt: { not: null },
          // เกินรอบซื้อ ~ มากกว่า 30 วันไม่ซื้อ (เกณฑ์คร่าว ๆ ใน dashboard)
          lastOrderAt: { lt: new Date(Date.now() - 30 * 864e5) },
        },
      }),
    ]);

  const salesToday = ordersToday.reduce((s, o) => s + Number(o.subtotal), 0);
  const profitToday = ordersToday.reduce((s, o) => s + Number(o.totalProfit), 0);

  const cards = [
    { label: "แชทค้างตอบ", value: unanswered, href: "/inbox", icon: MessageSquareWarning, accent: unanswered > 0 ? "danger" : "zinc" },
    { label: "ใบเสนอราคาวันนี้", value: quotesToday, href: "/quotes", icon: FileText, accent: "brand" },
    { label: "ออเดอร์ที่ยังไม่ปิด", value: openOrders, href: "/orders", icon: ClipboardList, accent: "brand" },
    { label: "ลูกค้าเกินรอบซื้อ", value: overdueCustomers, href: "/customers?filter=overdue", icon: Bell, accent: overdueCustomers > 0 ? "warning" : "zinc" },
  ];

  const accentClass: Record<string, string> = {
    danger: "bg-danger/10 text-danger",
    warning: "bg-warning/15 text-warning",
    brand: "bg-brand-50 text-brand-700",
    zinc: "bg-surface-2 text-zinc-500",
  };

  return (
    <div>
      <PageHeader title={`สวัสดี ${user.name}`} subtitle="ภาพรวมวันนี้" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c) => (
          <Link
            key={c.label} href={c.href}
            className="rounded-2xl border border-border bg-surface p-4 hover:shadow-sm transition-shadow"
          >
            <div className={`size-9 rounded-xl grid place-items-center mb-3 ${accentClass[c.accent]}`}>
              <c.icon className="size-[18px]" />
            </div>
            <div className="text-2xl font-bold tabular-nums">{c.value}</div>
            <div className="text-xs text-zinc-500 mt-0.5">{c.label}</div>
          </Link>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-3 mt-3">
        <div className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex items-center gap-2 text-zinc-500 text-sm">
            <TrendingUp className="size-4 text-leaf-600" /> ยอดขายวันนี้
          </div>
          <div className="text-3xl font-bold mt-2 tabular-nums">{formatBaht(salesToday)}</div>
          <div className="text-sm text-leaf-700 mt-1">กำไรวันนี้ {formatBaht(profitToday)}</div>
        </div>
        <Link href="/inbox" className="rounded-2xl border border-border bg-gradient-to-br from-brand-600 to-leaf-700 text-white p-5 flex flex-col justify-between hover:shadow-md transition-shadow">
          <div className="text-sm text-white/80">เริ่มงานวันนี้</div>
          <div className="text-lg font-bold mt-1">เปิดกล่องแชทลูกค้า</div>
          <div className="flex items-center gap-1 text-sm mt-3 text-white/90">
            ไปที่กล่องข้อความ <ArrowRight className="size-4" />
          </div>
        </Link>
      </div>
    </div>
  );
}
