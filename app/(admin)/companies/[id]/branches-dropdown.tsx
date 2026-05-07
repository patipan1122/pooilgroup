"use client";

// Collapsible dropdowns of branches grouped by business type — replaces the
// previous card-grid view per CEO request "ทำเป็นดรอปดาวน์ดีกว่า".
// Each row exposes view + edit; group header has its own "เพิ่มสาขา" link.

import { useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  Edit3,
  ChevronRight,
  Plus,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface BranchRow {
  id: string;
  code: string;
  name: string;
  province: string | null;
  managerName: string | null;
}

interface Group {
  type: string;
  emoji: string;
  label: string;
  branches: BranchRow[];
}

interface Props {
  companyId: string;
  groups: Group[];
}

export function CompanyBranchesDropdown({ companyId, groups }: Props) {
  // Default-open all groups so admin sees everything on first load — they can
  // collapse manually. With 5 business types this is comfortable.
  const [openTypes, setOpenTypes] = useState<Set<string>>(
    () => new Set(groups.map((g) => g.type)),
  );

  const allOpen = openTypes.size === groups.length;
  function toggleAll() {
    setOpenTypes(allOpen ? new Set() : new Set(groups.map((g) => g.type)));
  }
  function toggle(type: string) {
    const next = new Set(openTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setOpenTypes(next);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={toggleAll}
          className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg border-2 border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-[var(--color-brand-800)] text-xs font-bold hover:bg-[var(--color-brand-100)] hover:border-[var(--color-brand-400)] transition-colors"
        >
          <ChevronDown
            className={cn(
              "size-3.5 transition-transform",
              allOpen && "rotate-180",
            )}
          />
          {allOpen ? "ย่อทั้งหมด" : "ขยายทั้งหมด"}
        </button>
      </div>

      {groups.map((g) => {
        const isOpen = openTypes.has(g.type);
        return (
          <div
            key={g.type}
            className="rounded-xl border-2 border-zinc-200 bg-white overflow-hidden"
          >
            <div className="flex items-center gap-2 px-3 py-2.5 bg-zinc-50/50">
              <button
                type="button"
                onClick={() => toggle(g.type)}
                className="flex items-center gap-2 flex-1 min-w-0 text-left hover:text-zinc-900"
              >
                <ChevronDown
                  className={cn(
                    "size-4 text-zinc-400 transition-transform",
                    isOpen && "rotate-180",
                  )}
                />
                <span className="text-lg">{g.emoji}</span>
                <span className="font-extrabold font-display text-sm text-zinc-900">
                  {g.label}
                </span>
                <span className="text-[11px] text-zinc-500 tabular-num">
                  · {g.branches.length} สาขา
                </span>
              </button>
              <Link
                href={`/branches/new?company=${companyId}&type=${g.type}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 px-2 h-7 rounded-md bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] text-[var(--color-brand-700)] text-[11px] font-bold hover:bg-[var(--color-brand-100)] transition-colors shrink-0"
                title={`เพิ่มสาขาประเภท ${g.label}`}
              >
                <Plus className="size-3" />
                เพิ่ม
              </Link>
            </div>
            {isOpen && (
              <div className="divide-y divide-zinc-100">
                {g.branches.map((b) => {
                  const missingMgr = !b.managerName;
                  return (
                    <div
                      key={b.id}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-50/60 transition-colors"
                    >
                      <Link
                        href={`/branches/${b.id}`}
                        className="flex-1 min-w-0 flex items-center gap-2 group/row"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold tabular-num text-zinc-900">
                              {b.code}
                            </span>
                            <span className="text-xs text-zinc-700 truncate">
                              {b.name}
                            </span>
                            {missingMgr && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-red-50 text-red-700 border border-red-300">
                                <AlertTriangle className="size-2.5" />
                                ขาด ผจก.
                              </span>
                            )}
                          </div>
                          {(b.province || b.managerName) && (
                            <div className="text-[11px] text-zinc-400 truncate mt-0.5">
                              {[b.province, b.managerName]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          )}
                        </div>
                        <ChevronRight className="size-4 text-zinc-400 group-hover/row:text-[var(--color-brand-600)] group-hover/row:translate-x-0.5 transition-all shrink-0" />
                      </Link>
                      <Link
                        href={`/branches/${b.id}/edit`}
                        className="inline-flex items-center gap-1 px-2 h-7 rounded-md border border-zinc-200 bg-white text-zinc-700 text-[11px] font-bold hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]/40 hover:text-[var(--color-brand-800)] transition-colors shrink-0"
                        title="แก้ไขข้อมูลสาขา"
                      >
                        <Edit3 className="size-3" />
                        แก้
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
