import Link from "next/link";
import {
  Zap,
  Fuel,
  Coffee,
  Store,
  Hotel,
  Flame,
  ArrowRight,
  Clock,
} from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { BackButton } from "@/components/ui/back-button";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

interface ImportSource {
  slug: string;
  emoji: string;
  Icon: typeof Zap;
  title: string;
  subtitle: string;
  status: "ready" | "coming_soon";
  /** business_type ที่ source นี้นำเข้า (สำหรับนับล่าสุด) */
  businessType?: string;
}

const SOURCES: ImportSource[] = [
  {
    slug: "ev-connext",
    emoji: "⚡",
    Icon: Zap,
    title: "EV CONNEXT",
    subtitle: "Looker Studio · PEA VOLTA · CSV รายชาร์จ",
    status: "ready",
    businessType: "ev_station",
  },
  {
    slug: "fuel-trcloud",
    emoji: "⛽",
    Icon: Fuel,
    title: "ปั๊มน้ำมัน TRCloud",
    subtitle: "ยอดน้ำมันรายวัน · จาก TRCloud / PT POS",
    status: "coming_soon",
  },
  {
    slug: "lpg",
    emoji: "🔥",
    Icon: Flame,
    title: "ปั๊มแก๊ส LPG",
    subtitle: "ยอด LPG รายวัน · จากระบบ POS แต่ละสาขา",
    status: "coming_soon",
  },
  {
    slug: "cafe-amazon",
    emoji: "☕",
    Icon: Coffee,
    title: "Café Amazon POS",
    subtitle: "ยอด POS Café · จากระบบ POS ของ PTTOR",
    status: "coming_soon",
  },
  {
    slug: "7-eleven",
    emoji: "🏪",
    Icon: Store,
    title: "7-Eleven POS",
    subtitle: "ยอด POS 7-Eleven · ผ่าน CP All",
    status: "coming_soon",
  },
  {
    slug: "hotel-pms",
    emoji: "🏨",
    Icon: Hotel,
    title: "โรงแรม PMS",
    subtitle: "Occupancy + Revenue จาก PMS",
    status: "coming_soon",
  },
];

export default async function ImportHubPage() {
  const session = await requireRole("super_admin", "org_admin", "admin");
  const admin = adminClient();

  // For each "ready" source, peek at the last import (best-effort)
  // — joined via audit_logs (BULK_IMPORT_EV_REPORTS) to surface "last imported X ago"
  const { data: lastEvImport } = await admin
    .from("audit_logs")
    .select("created_at, diff")
    .eq("org_id", session.user.org_id)
    .eq("action", "BULK_IMPORT_EV_REPORTS")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastEvAt = lastEvImport?.created_at as string | undefined;
  const lastEvSummary =
    (lastEvImport?.diff as { new?: Record<string, unknown> } | null)?.new ?? null;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      <BackButton label="ภาพรวม" fallbackHref="/cashhub/dashboard" />

      <header className="mb-6 animate-fade-up">
        <p className="text-xs uppercase tracking-widest text-[var(--color-brand-600)] font-semibold">
          DATA IMPORT
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display mt-2">
          📥 <span className="accent">ศูนย์นำเข้าข้อมูล</span>
        </h1>
        <p className="text-zinc-600 mt-2 text-sm max-w-2xl">
          เลือกประเภทข้อมูลที่ต้องการนำเข้าระบบ · ระบบจะแปลงเป็น DailyReport
          และแสดงในหน้า ภาพรวม / รายงาน / Leaderboard ได้ปกติ
        </p>
      </header>

      <div className="grid sm:grid-cols-2 gap-3 animate-fade-up delay-100">
        {SOURCES.map((s) => {
          const isReady = s.status === "ready";
          const showLastEv = s.slug === "ev-connext" && lastEvAt;
          const Card = isReady ? Link : "div";
          const cardProps = isReady ? { href: `/cashhub/import/${s.slug}` } : {};

          return (
            <Card
              key={s.slug}
              {...(cardProps as { href: string })}
              className={
                "rounded-2xl border-2 p-4 transition-all bg-white " +
                (isReady
                  ? "border-zinc-200 hover:border-[var(--color-brand-400)] hover:shadow-sm cursor-pointer"
                  : "border-zinc-100 opacity-70 cursor-not-allowed")
              }
            >
              <div className="flex items-start gap-3">
                <div
                  className={
                    "size-11 rounded-xl flex items-center justify-center text-2xl shrink-0 " +
                    (isReady
                      ? "bg-[var(--color-brand-50)] border border-[var(--color-brand-200)]"
                      : "bg-zinc-50 border border-zinc-200")
                  }
                >
                  {s.emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h3 className="font-bold text-sm truncate">{s.title}</h3>
                    {isReady ? (
                      <Badge tone="brand" className="!text-[10px]">
                        พร้อมใช้
                      </Badge>
                    ) : (
                      <Badge tone="neutral" className="!text-[10px]">
                        <Clock className="size-2.5 mr-0.5" />
                        เร็ว ๆ นี้
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5 truncate">
                    {s.subtitle}
                  </p>

                  {showLastEv && (
                    <div className="mt-2 text-[11px] text-zinc-600 bg-zinc-50 rounded-lg px-2 py-1 border border-zinc-100">
                      <span className="font-semibold">ครั้งล่าสุด</span>:{" "}
                      {formatRelative(lastEvAt!)}
                      {lastEvSummary && (
                        <>
                          {" · "}
                          {String(lastEvSummary.reportsCreated ?? 0)} ใหม่
                          {" · "}
                          {String(lastEvSummary.createdBranches ?? 0)} สาขา
                        </>
                      )}
                    </div>
                  )}
                </div>
                {isReady && (
                  <ArrowRight className="size-4 text-zinc-400 shrink-0 mt-1" />
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <p className="mt-6 text-[11px] text-zinc-400 text-center">
        อยากเพิ่ม source ใหม่? บอก dev team — เพิ่มที่นี่ได้เรื่อย ๆ
      </p>
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const min = Math.round((now - then) / 60000);
  if (min < 1) return "เมื่อสักครู่";
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ชั่วโมงที่แล้ว`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} วันที่แล้ว`;
  return new Date(iso).toLocaleDateString("th-TH");
}
