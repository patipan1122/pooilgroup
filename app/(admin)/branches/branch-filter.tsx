"use client";

import { useState, useMemo } from "react";
import { Filter, RotateCcw, MapPin, Phone, MessageSquare, AlertCircle, UserPlus, Pencil, Building2 } from "lucide-react";
import Link from "next/link";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { Badge } from "@/components/ui/badge";
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
      if (selectedTypes.size > 0 && !selectedTypes.has(b.business_type)) return false;
      if (showOnlyMissingManagers && b.manager_count >= b.manager_max) return false;
      return true;
    });
  }, [branches, selectedCompanies, selectedTypes, showOnlyMissingManagers]);

  // Group by company → business type
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

  const totalMissingManagers = filtered.filter((b) => b.manager_count < b.manager_max).length;

  return (
    <>
      {/* Sticky filter bar */}
      <div className="sticky top-0 z-30 -mx-4 sm:-mx-6 lg:-mx-10 px-4 sm:px-6 lg:px-10 py-4 bg-white/85 backdrop-blur-md border-b border-zinc-200 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[--color-brand-600] font-bold">
            <Filter className="size-3.5" />
            ตัวกรอง
          </div>

          {/* Company chips */}
          <div className="flex items-center gap-1.5">
            {companies.map((c) => {
              const on = selectedCompanies.has(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggleCompany(c.id)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-colors",
                    on
                      ? "bg-[--color-brand-600] border-[--color-brand-600] text-white"
                      : "bg-white border-zinc-200 text-zinc-600 hover:border-zinc-400",
                  )}
                >
                  {c.name}
                </button>
              );
            })}
          </div>

          <div className="h-6 w-px bg-zinc-200" />

          {/* Business type chips */}
          <div className="flex items-center gap-1 flex-wrap">
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
                    "size-9 rounded-lg border-2 text-lg flex items-center justify-center transition-colors",
                    on
                      ? "bg-[--color-leaf-50] border-[--color-leaf-500]"
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

          <div className="h-6 w-px bg-zinc-200" />

          <button
            onClick={() => setShowOnlyMissingManagers((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-colors",
              showOnlyMissingManagers
                ? "bg-amber-100 border-amber-400 text-amber-900"
                : "bg-white border-zinc-200 text-zinc-600 hover:border-amber-300",
            )}
          >
            <AlertCircle className="size-3.5" />
            ตำแหน่งว่าง ({totalMissingManagers})
          </button>

          <button
            onClick={reset}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-900 font-medium"
          >
            <RotateCcw className="size-3.5" />
            ล้างตัวกรอง
          </button>
        </div>

        <div className="mt-2 text-xs text-zinc-500">
          แสดง <span className="font-bold text-zinc-900">{filtered.length}</span> สาขา จากทั้งหมด {branches.length}
        </div>
      </div>

      {/* Grouped list */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Building2 className="size-6" />}
          title="ไม่มีสาขาที่ตรงกับตัวกรอง"
          description="ลองล้างตัวกรองหรือเปลี่ยนเงื่อนไข"
        />
      ) : (
        <div className="space-y-10 animate-fade-up delay-200">
          {Array.from(grouped.entries()).map(([companyId, byType]) => {
            const company = companies.find((c) => c.id === companyId);
            const totalInCompany = Array.from(byType.values()).reduce(
              (sum, list) => sum + list.length,
              0,
            );
            return (
              <div key={companyId}>
                {/* Company header */}
                <div className="flex items-center gap-3 mb-5">
                  <div className="size-11 rounded-xl bg-[--color-brand-600] text-white flex items-center justify-center font-extrabold tracking-tight font-display text-lg shadow-blue">
                    {company?.code.slice(0, 2) ?? "?"}
                  </div>
                  <div>
                    <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight font-display text-zinc-900">
                      {company?.name ?? "ไม่ระบุบริษัท"}
                    </h2>
                    <p className="text-xs text-zinc-500 font-medium">
                      {totalInCompany} สาขา · {byType.size} ประเภทธุรกิจ
                    </p>
                  </div>
                </div>

                {/* By business type */}
                <div className="space-y-6 ml-2 sm:ml-4 border-l-2 border-zinc-100 pl-4 sm:pl-6">
                  {Array.from(byType.entries()).map(([type, list]) => {
                    const cfg = BUSINESS_TYPES[type];
                    return (
                      <div key={type}>
                        <p className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-zinc-600 font-bold mb-3">
                          <span className="text-lg leading-none">
                            {cfg?.emoji ?? "📋"}
                          </span>
                          {cfg?.label ?? type}
                          <span className="text-zinc-400">·</span>
                          <span className="text-zinc-500">{list.length} สาขา</span>
                        </p>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                          {list.map((b) => (
                            <BranchCard key={b.id} branch={b} />
                          ))}
                        </div>
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

function BranchCard({ branch: b }: { branch: BranchRow }) {
  const cfg = BUSINESS_TYPES[b.business_type];
  const missingManagers = b.manager_max - b.manager_count;
  const slotsFilled = Math.min(b.manager_count, b.manager_max);

  return (
    <div className="rounded-2xl border-2 border-zinc-200 bg-white p-4 hover:border-[--color-brand-300] transition-colors">
      {/* Top row: code + status */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <div className="font-extrabold tabular-num tracking-tight font-display text-base text-zinc-900">
            {b.code}
          </div>
          <div className="text-sm font-medium text-zinc-700 truncate">
            {b.name}
          </div>
          {b.province && (
            <div className="text-[11px] text-zinc-500 inline-flex items-center gap-1 mt-0.5">
              <MapPin className="size-3" />
              {b.province}
              {b.region && <span className="text-zinc-400">· {b.region}</span>}
            </div>
          )}
        </div>
        {b.is_active ? (
          <Badge tone="success">ใช้งาน</Badge>
        ) : (
          <Badge tone="neutral">ปิด</Badge>
        )}
      </div>

      {/* Manager slots */}
      <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-3 mb-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-600 font-bold">
            ผู้จัดการสาขา
          </p>
          <span
            className={cn(
              "text-[11px] font-bold tabular-num",
              missingManagers > 0 ? "text-amber-700" : "text-[--color-leaf-600]",
            )}
          >
            {b.manager_count}/{b.manager_max}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {b.manager?.name && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-zinc-200 text-xs">
              <span className="size-5 rounded-full bg-[--color-brand-100] text-[--color-brand-700] flex items-center justify-center font-bold text-[10px]">
                {b.manager.name.slice(0, 1)}
              </span>
              <span className="font-medium">{b.manager.name}</span>
            </div>
          )}
          {Array.from({ length: slotsFilled - (b.manager?.name ? 1 : 0) }).map(
            (_, i) => (
              <div
                key={`filled-${i}`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-zinc-200 text-xs text-zinc-400"
              >
                <span className="size-5 rounded-full bg-zinc-100" />
                <span>—</span>
              </div>
            ),
          )}
          {Array.from({ length: missingManagers }).map((_, i) => (
            <Link
              key={`empty-${i}`}
              href={`/branches/${b.id}`}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border-2 border-dashed border-amber-300 text-xs text-amber-700 hover:bg-amber-50 transition-colors"
            >
              <UserPlus className="size-3.5" />
              เพิ่มคน
            </Link>
          ))}
        </div>
      </div>

      {/* Contact / Telegram / LINE */}
      <div className="grid grid-cols-3 gap-2 text-[11px] mb-3">
        <div
          className={cn(
            "rounded-lg p-2 border",
            b.phone ? "bg-white border-zinc-200" : "bg-zinc-50 border-dashed border-zinc-300",
          )}
        >
          <div className="flex items-center gap-1 text-zinc-500 mb-0.5">
            <Phone className="size-3" />
            <span className="font-bold uppercase tracking-wider text-[9px]">เบอร์</span>
          </div>
          <div className={cn("truncate", b.phone ? "font-medium text-zinc-800" : "text-zinc-400")}>
            {b.phone ?? "ยังไม่ตั้ง"}
          </div>
        </div>
        <div
          className={cn(
            "rounded-lg p-2 border",
            b.telegram_chat_id ? "bg-white border-zinc-200" : "bg-zinc-50 border-dashed border-zinc-300",
          )}
        >
          <div className="flex items-center gap-1 text-zinc-500 mb-0.5">
            <MessageSquare className="size-3" />
            <span className="font-bold uppercase tracking-wider text-[9px]">Telegram</span>
          </div>
          <div className={cn("truncate", b.telegram_chat_id ? "font-medium text-zinc-800" : "text-zinc-400")}>
            {b.telegram_chat_id ?? "ยังไม่ตั้ง"}
          </div>
        </div>
        <div
          className={cn(
            "rounded-lg p-2 border",
            b.line_group_id ? "bg-white border-zinc-200" : "bg-zinc-50 border-dashed border-zinc-300",
          )}
        >
          <div className="flex items-center gap-1 text-zinc-500 mb-0.5">
            <MessageSquare className="size-3" />
            <span className="font-bold uppercase tracking-wider text-[9px]">LINE</span>
          </div>
          <div className={cn("truncate", b.line_group_id ? "font-medium text-zinc-800" : "text-zinc-400")}>
            {b.line_group_id ?? "ยังไม่ตั้ง"}
          </div>
        </div>
      </div>

      <Link
        href={`/branches/${b.id}`}
        className="inline-flex items-center gap-1.5 text-xs font-bold text-[--color-brand-700] hover:text-[--color-brand-900]"
      >
        <Pencil className="size-3.5" />
        แก้ไขข้อมูลสาขา
      </Link>
    </div>
  );
}
