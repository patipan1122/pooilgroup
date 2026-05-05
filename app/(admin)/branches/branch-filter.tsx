"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import {
  Filter,
  RotateCcw,
  ChevronDown,
  AlertCircle,
  Building2,
  Pencil,
  Phone as PhoneIcon,
  MessageSquare,
  Check,
} from "lucide-react";
import Link from "next/link";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils/cn";

export interface CompanyOption {
  id: string;
  code: string;
  name: string;
}

export interface BranchRow {
  id: string;
  code: string;
  name: string;
  business_type: string;
  province: string | null;
  region: string | null;
  is_active: boolean;
  manager_id: string | null;
  manager: { id: string; name: string; phone: string | null } | null;
  phone: string | null;
  line_group_id: string | null;
  telegram_chat_id: string | null;
  company_id: string | null;
  company: { id: string; code: string; name: string } | null;
  parent_branch_id: string | null;
  manager_count: number;
  manager_max: number;
}

interface Props {
  companies: CompanyOption[];
  branches: BranchRow[];
}

export function BranchFilterAndList({ companies, branches }: Props) {
  const [selectedCompanies, setSelectedCompanies] = useState<Set<string>>(
    new Set(companies.map((c) => c.id)),
  );
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [showOnlyMissingManagers, setShowOnlyMissingManagers] = useState(false);

  const allTypesPresent = useMemo(() => {
    const set = new Set<string>();
    for (const b of branches) set.add(b.business_type);
    return Array.from(set);
  }, [branches]);

  const toggleCompany = (id: string) => {
    const next = new Set(selectedCompanies);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedCompanies(next);
  };

  const toggleType = (type: string) => {
    const next = new Set(selectedTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setSelectedTypes(next);
  };

  const reset = () => {
    setSelectedCompanies(new Set(companies.map((c) => c.id)));
    setSelectedTypes(new Set());
    setShowOnlyMissingManagers(false);
  };

  const filtered = useMemo(() => {
    return branches.filter((b) => {
      if (b.company_id && !selectedCompanies.has(b.company_id)) return false;
      if (selectedTypes.size > 0 && !selectedTypes.has(b.business_type))
        return false;
      if (showOnlyMissingManagers && b.manager_count >= b.manager_max)
        return false;
      return true;
    });
  }, [branches, selectedCompanies, selectedTypes, showOnlyMissingManagers]);

  // Group: company → business_type → branches
  const grouped = useMemo(() => {
    const byCompany = new Map<string, Map<string, BranchRow[]>>();
    for (const b of filtered) {
      const cId = b.company_id ?? "no-company";
      if (!byCompany.has(cId)) byCompany.set(cId, new Map());
      const cMap = byCompany.get(cId)!;
      if (!cMap.has(b.business_type)) cMap.set(b.business_type, []);
      cMap.get(b.business_type)!.push(b);
    }
    return byCompany;
  }, [filtered]);

  const totalMissingManagers = filtered.filter(
    (b) => b.manager_count < b.manager_max,
  ).length;

  // Default: all groups open
  const initialOpen = useMemo(() => {
    const s = new Set<string>();
    for (const [cId, types] of grouped.entries()) {
      for (const t of types.keys()) s.add(`${cId}:${t}`);
    }
    return s;
  }, [grouped]);
  const [openTypes, setOpenTypes] = useState<Set<string>>(initialOpen);

  function toggleGroup(key: string) {
    const next = new Set(openTypes);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpenTypes(next);
  }

  return (
    <>
      {/* Sticky filter bar */}
      <div className="sticky top-0 z-30 -mx-4 sm:-mx-6 lg:-mx-10 px-4 sm:px-6 lg:px-10 py-3 bg-white/85 backdrop-blur-md border-b border-zinc-200 mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold">
            <Filter className="size-3" />
            ตัวกรอง
          </div>

          {/* Company chips */}
          <div className="flex items-center gap-1">
            {companies.map((c) => {
              const on = selectedCompanies.has(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggleCompany(c.id)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-[11px] font-bold border-2 transition-colors",
                    on
                      ? "bg-[var(--color-brand-600)] border-[var(--color-brand-600)] text-white"
                      : "bg-white border-zinc-200 text-zinc-600 hover:border-zinc-400",
                  )}
                >
                  {c.name}
                </button>
              );
            })}
          </div>

          <div className="h-5 w-px bg-zinc-200" />

          {/* Business type icon chips */}
          <div className="flex items-center gap-0.5 flex-wrap">
            {allTypesPresent.map((t) => {
              const cfg = BUSINESS_TYPES[t];
              if (!cfg) return null;
              const on = selectedTypes.has(t);
              const noFilter = selectedTypes.size === 0;
              return (
                <button
                  key={t}
                  onClick={() => toggleType(t)}
                  title={cfg.label}
                  className={cn(
                    "size-7 rounded-md border-2 text-sm flex items-center justify-center transition-colors",
                    on
                      ? "bg-[var(--color-leaf-50)] border-[var(--color-leaf-500)]"
                      : noFilter
                        ? "bg-white border-zinc-200 hover:border-zinc-400"
                        : "bg-zinc-50 border-zinc-200 opacity-50 hover:opacity-80",
                  )}
                >
                  {cfg.emoji}
                </button>
              );
            })}
          </div>

          <div className="h-5 w-px bg-zinc-200" />

          <button
            onClick={() => setShowOnlyMissingManagers((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border-2 transition-colors",
              showOnlyMissingManagers
                ? "bg-amber-100 border-amber-400 text-amber-900"
                : "bg-white border-zinc-200 text-zinc-600 hover:border-amber-300",
            )}
          >
            <AlertCircle className="size-3" />
            ตำแหน่งว่าง ({totalMissingManagers})
          </button>

          <button
            onClick={reset}
            className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-900 font-medium"
          >
            <RotateCcw className="size-3" />
            ล้าง
          </button>
        </div>

        <div className="mt-1 text-[11px] text-zinc-500">
          แสดง <span className="font-bold text-zinc-900 tabular-num">{filtered.length}</span>{" "}
          สาขา จากทั้งหมด {branches.length}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Building2 className="size-6" />}
          title="ไม่มีสาขาที่ตรงกับตัวกรอง"
          description="ลองล้างตัวกรองหรือเปลี่ยนเงื่อนไข"
        />
      ) : (
        <div className="space-y-6">
          {Array.from(grouped.entries()).map(([companyId, byType]) => {
            const company = companies.find((c) => c.id === companyId);
            const totalInCompany = Array.from(byType.values()).reduce(
              (s, list) => s + list.length,
              0,
            );
            return (
              <div key={companyId}>
                {/* Company header — small */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="size-8 rounded-lg bg-[var(--color-brand-600)] text-white flex items-center justify-center font-extrabold text-xs font-display">
                    {company?.code.slice(0, 2) ?? "?"}
                  </div>
                  <div>
                    <div className="font-extrabold text-base text-zinc-900 font-display">
                      {company?.name ?? "ไม่ระบุบริษัท"}
                    </div>
                    <div className="text-[10px] text-zinc-500 -mt-0.5">
                      <span className="tabular-num font-bold">{totalInCompany}</span>{" "}
                      สาขา · {byType.size} ประเภท
                    </div>
                  </div>
                </div>

                {/* Business type accordions — compact */}
                <div className="space-y-2">
                  {Array.from(byType.entries()).map(([type, list]) => {
                    const cfg = BUSINESS_TYPES[type];
                    const key = `${companyId}:${type}`;
                    const isOpen = openTypes.has(key);
                    const missing = list.filter(
                      (b) => b.manager_count < b.manager_max,
                    ).length;
                    return (
                      <div
                        key={type}
                        className="rounded-xl border-2 border-zinc-200 bg-white overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() => toggleGroup(key)}
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-50 transition-colors text-left"
                        >
                          <span className="text-base">{cfg?.emoji ?? "📋"}</span>
                          <span className="font-extrabold font-display text-sm text-zinc-900">
                            {cfg?.label ?? type}
                          </span>
                          <span className="text-[11px] text-zinc-500 ml-1">
                            <span className="tabular-num font-bold text-zinc-700">
                              {list.length}
                            </span>{" "}
                            สาขา
                          </span>
                          {missing > 0 && (
                            <span className="text-[10px] font-bold text-amber-700 px-1.5 py-0.5 rounded-md bg-amber-50 border border-amber-200 ml-auto mr-1">
                              ตำแหน่งว่าง {missing}
                            </span>
                          )}
                          <ChevronDown
                            className={cn(
                              "size-4 text-zinc-400 transition-transform shrink-0",
                              !missing && "ml-auto",
                              isOpen && "rotate-180",
                            )}
                          />
                        </button>

                        {isOpen && (
                          <div className="border-t-2 border-zinc-100 divide-y divide-zinc-100">
                            {list.map((b) => (
                              <BranchCompactRow key={b.id} branch={b} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function BranchCompactRow({ branch: b }: { branch: BranchRow }) {
  const missing = b.manager_max - b.manager_count;
  return (
    <Link
      href={`/branches/${b.id}`}
      className="flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--color-brand-50)]/40 transition-colors group"
    >
      {/* Code + name */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-extrabold tabular-num font-display text-xs">
            {b.code}
          </span>
          <span className="text-xs text-zinc-700 truncate">{b.name}</span>
          {b.province && (
            <span className="text-[10px] text-zinc-400">· {b.province}</span>
          )}
        </div>
      </div>

      {/* Status pills */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Manager count */}
        <span
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold tabular-num",
            missing > 0
              ? "bg-amber-50 text-amber-800 border border-amber-200"
              : "bg-[var(--color-leaf-50)] text-[var(--color-leaf-700)] border border-[var(--color-leaf-200)]",
          )}
          title="ผู้จัดการสาขา"
        >
          ผจก. {b.manager_count}/{b.manager_max}
        </span>
        {/* LINE Group */}
        <span
          className={cn(
            "inline-flex items-center justify-center size-6 rounded-md border",
            b.line_group_id
              ? "bg-[var(--color-leaf-50)] border-[var(--color-leaf-200)] text-[var(--color-leaf-700)]"
              : "bg-zinc-50 border-zinc-200 text-zinc-400",
          )}
          title={b.line_group_id ? `LINE Group: ${b.line_group_id}` : "ยังไม่ตั้ง LINE Group"}
        >
          <MessageSquare className="size-3" />
        </span>
        {/* Telegram */}
        <span
          className={cn(
            "inline-flex items-center justify-center size-6 rounded-md border",
            b.telegram_chat_id
              ? "bg-[var(--color-leaf-50)] border-[var(--color-leaf-200)] text-[var(--color-leaf-700)]"
              : "bg-zinc-50 border-zinc-200 text-zinc-400",
          )}
          title={b.telegram_chat_id ? `Telegram: ${b.telegram_chat_id}` : "ยังไม่ตั้ง Telegram"}
        >
          <span className="text-[10px] font-bold">TG</span>
        </span>
        {/* Phone */}
        <span
          className={cn(
            "inline-flex items-center justify-center size-6 rounded-md border",
            b.phone
              ? "bg-[var(--color-leaf-50)] border-[var(--color-leaf-200)] text-[var(--color-leaf-700)]"
              : "bg-zinc-50 border-zinc-200 text-zinc-400",
          )}
          title={b.phone ?? "ไม่มีเบอร์"}
        >
          <PhoneIcon className="size-3" />
        </span>
        {/* Edit hint */}
        <Pencil className="size-3 text-zinc-400 group-hover:text-[var(--color-brand-600)] transition-colors" />
      </div>
    </Link>
  );
}
