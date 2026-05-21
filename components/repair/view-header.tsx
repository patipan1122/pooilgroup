"use client";
// Shared header for all /repairs/* admin views.
// View tabs (Overview / Triage / Kanban / Table) + business filter chip row.
// Mirrors the Pooil App design (Linear/Stripe density).

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import {
  LayoutDashboard,
  Inbox,
  KanbanSquare,
  Table as TableIcon,
  Plus,
  ExternalLink,
  Building2,
  Globe,
} from "lucide-react";

interface Company {
  id: string;
  code: string;
  name: string;
}

interface Props {
  active: "overview" | "triage" | "kanban" | "table";
  companies: Company[];
  currentCompanyId: string | null;
  openCount: number;
  urgentCount: number;
  canWrite: boolean;
  ticketTotal?: number;
  newSinceYesterday?: number;
}

const VIEWS: Array<{
  key: Props["active"];
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: "overview", href: "/repairs", label: "ภาพรวม", icon: LayoutDashboard },
  { key: "triage", href: "/repairs/triage", label: "Triage Inbox", icon: Inbox },
  { key: "kanban", href: "/repairs/kanban", label: "Kanban", icon: KanbanSquare },
  { key: "table", href: "/repairs/table", label: "ตาราง", icon: TableIcon },
];

export function RepairViewHeader({
  active,
  companies,
  currentCompanyId,
  openCount,
  urgentCount,
  canWrite,
  ticketTotal,
  newSinceYesterday,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setCompany(id: string | null) {
    const next = new URLSearchParams(sp.toString());
    if (id) next.set("company", id);
    else next.delete("company");
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  }

  function tabHref(href: string) {
    if (!currentCompanyId) return href;
    return `${href}?company=${currentCompanyId}`;
  }

  return (
    <div className="bg-white border-b border-zinc-200">
      {/* Top row: title + actions */}
      <div className="px-4 sm:px-6 lg:px-8 pt-4 pb-2 flex flex-wrap items-start gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="size-10 rounded-xl bg-gradient-to-br from-blue-600 to-blue-900 grid place-items-center text-white font-extrabold text-base shrink-0">
            P
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-blue-600">
              Pooilgroup · Command Center
            </div>
            <h1 className="text-[19px] sm:text-[22px] font-extrabold tracking-tight text-zinc-900 leading-tight">
              {active === "overview" && "ภาพรวมระบบแจ้งซ่อม"}
              {active === "triage" && "Triage Inbox"}
              {active === "kanban" && "Kanban Board"}
              {active === "table" && "ใบทั้งหมด"}
            </h1>
            <p className="text-xs text-zinc-500 mt-0.5 leading-tight tabular-nums">
              <span className="font-semibold text-zinc-700">{openCount}</span> เปิดอยู่ ·{" "}
              <span className="font-semibold text-red-600">{urgentCount}</span> ด่วน
              {newSinceYesterday !== undefined && (
                <>
                  {" "}
                  · <span className="font-semibold text-zinc-700">+{newSinceYesterday}</span>{" "}
                  วันนี้
                </>
              )}
              {ticketTotal !== undefined && (
                <> · ทั้งหมด {ticketTotal.toLocaleString()} ใบ</>
              )}
            </p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap gap-2">
          <Link
            href="/r/new"
            target="_blank"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-zinc-200 bg-white text-zinc-700 font-semibold text-xs hover:bg-zinc-50"
            title="เปิดฟอร์มสาธารณะในแท็บใหม่"
          >
            <ExternalLink className="size-3.5" />
            ฟอร์มสาธารณะ
          </Link>
          {canWrite && (
            <Link
              href="/repairs/new"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm shadow-blue-600/20"
            >
              <Plus className="size-3.5" />
              แจ้งซ่อมใหม่
            </Link>
          )}
        </div>
      </div>

      {/* Business tabs */}
      {companies.length > 1 && (
        <div className="px-4 sm:px-6 lg:px-8 py-2 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={pending}
            onClick={() => setCompany(null)}
            className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11.5px] font-medium transition-colors ${
              !currentCompanyId
                ? "bg-zinc-900 text-white shadow-sm"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
            }`}
          >
            <Globe className="size-3" />
            ทั้งหมด
          </button>
          {companies.map((c) => {
            const active = currentCompanyId === c.id;
            return (
              <button
                key={c.id}
                type="button"
                disabled={pending}
                onClick={() => setCompany(c.id)}
                className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11.5px] font-medium transition-colors ${
                  active
                    ? "bg-zinc-900 text-white shadow-sm"
                    : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                }`}
              >
                <Building2 className="size-3" />
                {c.name}
              </button>
            );
          })}
        </div>
      )}

      {/* View tabs */}
      <div className="px-4 sm:px-6 lg:px-8 flex items-center gap-0.5 overflow-x-auto -mb-px">
        {VIEWS.map((v) => {
          const isActive = v.key === active;
          const Icon = v.icon;
          return (
            <Link
              key={v.key}
              href={tabHref(v.href)}
              className={`inline-flex items-center gap-1.5 px-3 py-2.5 text-[12.5px] font-semibold border-b-2 transition-colors whitespace-nowrap ${
                isActive
                  ? "text-blue-700 border-blue-600"
                  : "text-zinc-500 hover:text-zinc-900 border-transparent"
              }`}
            >
              <Icon className="size-3.5" />
              {v.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
