"use client";
// Shared header for /repairs/* views — uses Pooil App design CSS classes
// (page-head, page-title, view-tabs, biz-tabs, brand-mark)
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
  Globe,
  Building2,
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
  { key: "overview", href: "/repairs",         label: "ภาพรวม",       icon: LayoutDashboard },
  { key: "triage",   href: "/repairs/triage",  label: "Triage",        icon: Inbox },
  { key: "kanban",   href: "/repairs/kanban",  label: "Kanban",        icon: KanbanSquare },
  { key: "table",    href: "/repairs/table",   label: "ตาราง",         icon: TableIcon },
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
    <div className="page-head">
      <div className="page-head-row">
        <div className="brand-mark">P</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="page-eyebrow">Pooilgroup · Command Center</div>
          <h1 className="page-title">
            {active === "overview" && "ภาพรวมระบบแจ้งซ่อม"}
            {active === "triage" && "Triage Inbox"}
            {active === "kanban" && "Kanban Board"}
            {active === "table" && "ใบทั้งหมด"}
          </h1>
          <div className="page-sub">
            <b className="num">{openCount}</b> เปิดอยู่
            <span style={{ margin: "0 6px" }}>·</span>
            <b className="num" style={{ color: urgentCount > 0 ? "var(--bad)" : "inherit" }}>
              {urgentCount}
            </b>{" "}
            ด่วน
            {newSinceYesterday !== undefined && (
              <>
                <span style={{ margin: "0 6px" }}>·</span>
                <b className="num">+{newSinceYesterday}</b> วันนี้
              </>
            )}
            {ticketTotal !== undefined && (
              <>
                <span style={{ margin: "0 6px" }}>·</span>ทั้งหมด <b className="num">{ticketTotal.toLocaleString()}</b> ใบ
              </>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {companies.length > 1 && (
            <div className="biz-tabs">
              <button
                type="button"
                disabled={pending}
                onClick={() => setCompany(null)}
                className={"biz-tab " + (!currentCompanyId ? "is-active" : "")}
              >
                <Globe size={12} />
                ทั้งหมด
              </button>
              {companies.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={pending}
                  onClick={() => setCompany(c.id)}
                  className={"biz-tab " + (currentCompanyId === c.id ? "is-active" : "")}
                >
                  <Building2 size={12} />
                  {c.name}
                </button>
              ))}
            </div>
          )}

          <Link href="/r/new" target="_blank" className="btn btn-sm">
            <ExternalLink />
            ฟอร์มสาธารณะ
          </Link>
          {canWrite && (
            <Link href="/repairs/new" className="btn btn-primary btn-sm">
              <Plus />
              แจ้งซ่อมใหม่
            </Link>
          )}
        </div>
      </div>

      <div className="view-tabs">
        {VIEWS.map((v) => {
          const isActive = v.key === active;
          const Icon = v.icon;
          return (
            <Link
              key={v.key}
              href={tabHref(v.href)}
              className={"view-tab " + (isActive ? "is-active" : "")}
            >
              <Icon />
              {v.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
