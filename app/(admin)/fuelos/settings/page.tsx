import Link from "next/link";
import { requireUser, atLeast } from "@/lib/fuelos/auth";
import { PageHeader } from "@/components/fuelos/ui/page-header";
import { cn } from "@/lib/fuelos/utils/cn";
import { Lock, Users, MessageSquare, Landmark, Bot, Satellite } from "lucide-react";
import {
  listUsers,
  getStaffWorkload,
  listChannels,
  listBanks,
  listFaqs,
} from "@/lib/fuelos/settings-data";
import { getGpsConfig } from "@/lib/fuelos/gps/report-data";
import { TeamTab } from "./team-tab";
import { LineTab } from "./line-tab";
import { BankTab } from "./bank-tab";
import { BotTab } from "./bot-tab";
import { GpsTab } from "./gps-tab";

type Tab = "team" | "line" | "bank" | "bot" | "gps";
const TABS: { key: Tab; label: string; icon: typeof Users }[] = [
  { key: "team", label: "พนักงาน", icon: Users },
  { key: "line", label: "ช่องทาง LINE", icon: MessageSquare },
  { key: "bank", label: "บัญชีธนาคาร", icon: Landmark },
  { key: "bot", label: "บอท FAQ", icon: Bot },
  { key: "gps", label: "ติดตามรถ GPS", icon: Satellite },
];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireUser();

  // เฉพาะแอดมินขึ้นไปเท่านั้นที่เข้าหน้าตั้งค่าได้
  if (!atLeast(user.role, "ADMIN")) {
    return (
      <div>
        <PageHeader title="ตั้งค่า" />
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <Lock className="size-8 mx-auto text-zinc-300" />
          <p className="mt-3 font-semibold">เฉพาะแอดมินเท่านั้น</p>
          <p className="text-sm text-zinc-500 mt-1">
            หน้าตั้งค่าระบบเปิดให้เฉพาะผู้ดูแล (แอดมิน) ขึ้นไป · หากต้องการสิทธิ์ โปรดติดต่อผู้ดูแลระบบ
          </p>
        </div>
      </div>
    );
  }

  const sp = await searchParams;
  // แท็บ "ช่องทาง LINE" = โครงสร้างการเชื่อมต่อ (channel id/token/secret) → เฉพาะ
  // เจ้าของระบบ (OWNER = Pool super_admin). แอดมินทั่วไปยังจัดการ พนักงาน/ธนาคาร/บอท ได้
  // (CEO 2026-06-12). org_admin→ADMIN, admin→SALES_HEAD จึงไม่ใช่ OWNER.
  const isOwner = user.role === "OWNER";
  const visibleTabs = TABS.filter((t) => t.key !== "line" || isOwner);
  const tab = (visibleTabs.some((t) => t.key === sp.tab) ? sp.tab : "team") as Tab;

  return (
    <div>
      <PageHeader title="ตั้งค่า" subtitle="จัดการพนักงาน ช่องทาง LINE บัญชีธนาคาร และบอทตอบอัตโนมัติ" />

      {/* tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-5">
        {visibleTabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <Link
              key={t.key}
              href={`/fuelos/settings?tab=${t.key}`}
              className={cn(
                "inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-sm font-medium shrink-0",
                active ? "bg-brand-600 text-white" : "bg-surface border border-border text-zinc-600",
              )}
            >
              <Icon className="size-4" />
              {t.label}
            </Link>
          );
        })}
      </div>

      {tab === "team" && <TeamSection orgId={user.orgId} selfId={user.id} />}
      {tab === "line" && isOwner && <LineSection orgId={user.orgId} />}
      {tab === "bank" && <BankSection orgId={user.orgId} />}
      {tab === "bot" && <BotSection orgId={user.orgId} />}
      {tab === "gps" && <GpsSection orgId={user.orgId} />}
    </div>
  );
}

async function GpsSection({ orgId }: { orgId: string }) {
  const config = await getGpsConfig(orgId);
  return <GpsTab config={config} />;
}

async function TeamSection({ orgId, selfId }: { orgId: string; selfId: string }) {
  const [users, workload] = await Promise.all([listUsers(orgId), getStaffWorkload(orgId)]);
  return <TeamTab users={users} workload={workload} selfId={selfId} />;
}

async function LineSection({ orgId }: { orgId: string }) {
  const channels = await listChannels(orgId);
  return <LineTab channels={channels} />;
}

async function BankSection({ orgId }: { orgId: string }) {
  const banks = await listBanks(orgId);
  return <BankTab banks={banks} />;
}

async function BotSection({ orgId }: { orgId: string }) {
  const faqs = await listFaqs(orgId);
  return <BotTab faqs={faqs} />;
}
