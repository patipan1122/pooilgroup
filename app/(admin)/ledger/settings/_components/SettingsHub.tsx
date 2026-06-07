// SettingsHub — the LedgerLine "ตั้งค่า" landing (mobile-first, iOS/Bainy style).
//
// Replaces the old one-long-scroll of 8 cards. Each setting is now a tappable
// ROW (tinted icon · title · one-line gloss · count/status · chevron) grouped
// into sections, drilling into a focused sub-page. Scannable on a phone, no more
// "เลื่อนยาว หาไม่เจอ". Presentational only — counts/links come from the page.
import Link from "next/link";
import {
  Tags,
  FileSpreadsheet,
  Users,
  ShieldCheck,
  MapPin,
  MessageSquare,
  CloudUpload,
  Boxes,
  ChevronRight,
  Check,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type Tone = "brand" | "emerald" | "amber" | "violet" | "sky" | "rose";

const TONE: Record<Tone, string> = {
  brand: "bg-[var(--color-brand-50)] text-[var(--color-brand-600)]",
  emerald: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  violet: "bg-violet-50 text-violet-600",
  sky: "bg-sky-50 text-sky-600",
  rose: "bg-rose-50 text-rose-600",
};

interface Row {
  href: string;
  icon: LucideIcon;
  tone: Tone;
  title: string;
  subtitle: string;
  /** muted count chip (e.g. number of categories) */
  count?: number | null;
  /** amber attention badge (e.g. "2 รออนุมัติ") */
  badge?: string | null;
  /** right-aligned status text + colour (e.g. เชื่อมแล้ว) */
  status?: { label: string; ok: boolean } | null;
}

export interface HubCounts {
  categories: number;
  members: number;
  pendingMembers: number;
  invites: number;
  branches: number;
  groups: number;
  lineConnected: boolean;
}

function SettingRow({ row }: { row: Row }) {
  const Icon = row.icon;
  return (
    <Link
      href={row.href}
      className="group flex items-center gap-3 px-3.5 py-3 transition active:bg-zinc-50"
    >
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-xl",
          TONE[row.tone],
        )}
        aria-hidden
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-zinc-900">{row.title}</span>
        <span className="block truncate text-xs text-zinc-500">{row.subtitle}</span>
      </span>
      {row.badge && (
        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
          {row.badge}
        </span>
      )}
      {row.status && (
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 text-[11px] font-medium",
            row.status.ok ? "text-emerald-600" : "text-zinc-400",
          )}
        >
          {row.status.ok && <Check className="size-3" aria-hidden />}
          {row.status.label}
        </span>
      )}
      {row.count != null && (
        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-zinc-500">
          {row.count}
        </span>
      )}
      <ChevronRight className="size-4 shrink-0 text-zinc-300" aria-hidden />
    </Link>
  );
}

export function SettingsHub({
  companyId,
  counts,
  stockinOn = false,
}: {
  companyId: string;
  counts: HubCounts;
  stockinOn?: boolean;
}) {
  const qs = `?company=${encodeURIComponent(companyId)}`;

  const groups: { label: string; rows: Row[] }[] = [
    {
      label: "การจดบันทึก",
      rows: [
        {
          href: `/ledger/settings/categories${qs}`,
          icon: Tags,
          tone: "brand",
          title: "หมวดหมู่ค่าใช้จ่าย",
          subtitle: "จัดกลุ่ม · สี · ผูกรหัสบัญชี",
          count: counts.categories,
        },
        ...(stockinOn
          ? [
              {
                href: `/ledger/settings/inventory${qs}`,
                icon: Boxes,
                tone: "amber" as const,
                title: "คลังสินค้า / SKU",
                subtitle: "สินค้าซื้อมาขาย — รับเข้าสต๊อก TRCloud",
              },
            ]
          : []),
        {
          href: `/ledger/settings/export${qs}`,
          icon: FileSpreadsheet,
          tone: "emerald",
          title: "ส่งออก & โปรแกรมบัญชี",
          subtitle: "ตั้งค่าไฟล์ส่งบัญชี / TRCloud",
        },
      ],
    },
    {
      label: "ทีมงาน & สิทธิ์",
      rows: [
        {
          href: `/ledger/settings/members${qs}`,
          icon: Users,
          tone: "sky",
          title: "สมาชิก & คำเชิญ",
          subtitle: "ใครเข้าใช้ระบบได้บ้าง",
          count: counts.members,
          badge:
            counts.pendingMembers > 0 ? `${counts.pendingMembers} รออนุมัติ` : null,
        },
        {
          href: `/ledger/settings/permissions${qs}`,
          icon: ShieldCheck,
          tone: "violet",
          title: "สิทธิ์การใช้งาน",
          subtitle: "ใครยืนยัน/ส่งออก/ดูกำไรได้",
        },
        {
          href: `/ledger/settings/branches${qs}`,
          icon: MapPin,
          tone: "amber",
          title: "สาขา",
          subtitle: "เพิ่ม/แก้สาขา (ใช้ร่วมทุกระบบ)",
          count: counts.branches,
        },
      ],
    },
    {
      label: "การเชื่อมต่อ",
      rows: [
        {
          href: `/ledger/settings/line-groups${qs}`,
          icon: MessageSquare,
          tone: "emerald",
          title: "กลุ่ม LINE → สาขา",
          subtitle: "ดูกลุ่มไลน์ + ผูกแต่ละกลุ่มเข้าสาขา",
          count: counts.groups,
          status: { label: counts.lineConnected ? "เชื่อมแล้ว" : "ยังไม่เชื่อม", ok: counts.lineConnected },
        },
        {
          href: `/ledger/settings/google${qs}`,
          icon: CloudUpload,
          tone: "sky",
          title: "เชื่อมต่อ Google",
          subtitle: "Drive (เก็บไฟล์ใบเสร็จ) + Gmail (ดึงค่าใช้จ่ายจากอีเมล)",
        },
      ],
    },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-1">
      {groups.map((g, gi) => (
        <section key={g.label}>
          <h2
            className={cn(
              "px-1 pb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400",
              gi === 0 ? "pt-0" : "pt-5",
            )}
          >
            {g.label}
          </h2>
          <div className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
            {g.rows.map((row) => (
              <SettingRow key={row.href} row={row} />
            ))}
          </div>
        </section>
      ))}

      <p className="px-1 pt-6 text-center text-xs text-zinc-400">
        ผู้ดูแลจัดการทีม/สิทธิ์/สาขาบนมือถือผ่าน LINE ได้เช่นกัน
      </p>
    </div>
  );
}
