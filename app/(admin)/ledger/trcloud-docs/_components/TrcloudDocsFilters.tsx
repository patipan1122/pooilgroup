"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import type { TrcloudDocKind } from "@/lib/ledger/trcloud-docs-data";

type Props = {
  kind: TrcloudDocKind;
  counts: { po: number; ap: number };
  facets: { companyFormat: string[]; department: string[]; project: string[]; status: string[] };
  current: {
    companyFormat?: string;
    department?: string;
    project?: string;
    status?: string;
    from?: string;
    to?: string;
    q?: string;
  };
};

const FACET_KEYS = ["companyFormat", "department", "project", "status", "from", "to", "q"] as const;

export function TrcloudDocsFilters({ kind, counts, facets, current }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function push(params: URLSearchParams) {
    const s = params.toString();
    router.push(s ? `${pathname}?${s}` : pathname);
  }

  function setParam(key: string, value: string | undefined) {
    const p = new URLSearchParams(sp.toString());
    if (value && value.length) p.set(key, value);
    else p.delete(key);
    push(p);
  }

  function switchKind(next: TrcloudDocKind) {
    // ชุดเลข/นิติบุคคล/สาขา/สถานะ เป็นค่าเฉพาะแต่ละชนิด → เคลียร์ตอนสลับ (คง q + วันที่)
    const p = new URLSearchParams(sp.toString());
    p.set("kind", next);
    for (const k of ["companyFormat", "department", "project", "status"]) p.delete(k);
    push(p);
  }

  const hasAnyFilter = FACET_KEYS.some((k) => current[k as keyof typeof current]);

  function clearAll() {
    const p = new URLSearchParams();
    p.set("kind", kind);
    push(p);
  }

  const selectCls =
    "h-9 rounded-lg border border-zinc-200 bg-white px-2.5 text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-600)]/30";

  return (
    <div className="space-y-2.5">
      {/* Tabs: ชนิดใบ */}
      <div className="-mx-1 flex gap-1 overflow-x-auto">
        {(["AP", "PO"] as TrcloudDocKind[]).map((k) => {
          const active = kind === k;
          const count = k === "AP" ? counts.ap : counts.po;
          const label = k === "AP" ? "AP · เอกสารซื้อ/ค่าใช้จ่าย" : "PO · ใบสั่งซื้อ";
          return (
            <button
              key={k}
              type="button"
              onClick={() => switchKind(k)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-[var(--color-brand-600)] text-white"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              }`}
            >
              {label}
              <span
                className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs ${
                  active ? "bg-white/20" : "bg-zinc-200 text-zinc-600"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="ชุดเลขที่เอกสาร"
          className={selectCls}
          value={current.companyFormat ?? ""}
          onChange={(e) => setParam("companyFormat", e.target.value)}
        >
          <option value="">ชุดเลขทั้งหมด</option>
          {facets.companyFormat.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>

        <select
          aria-label="นิติบุคคล"
          className={selectCls}
          value={current.department ?? ""}
          onChange={(e) => setParam("department", e.target.value)}
        >
          <option value="">นิติบุคคลทั้งหมด</option>
          {facets.department.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>

        <select
          aria-label="สาขา"
          className={selectCls}
          value={current.project ?? ""}
          onChange={(e) => setParam("project", e.target.value)}
        >
          <option value="">สาขาทั้งหมด</option>
          {facets.project.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>

        <select
          aria-label="สถานะ"
          className={selectCls}
          value={current.status ?? ""}
          onChange={(e) => setParam("status", e.target.value)}
        >
          <option value="">สถานะทั้งหมด</option>
          {facets.status.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>

        <div className="flex items-center gap-1 text-sm text-zinc-500">
          <input
            type="date"
            aria-label="ตั้งแต่วันที่"
            className={selectCls}
            value={current.from ?? ""}
            onChange={(e) => setParam("from", e.target.value)}
          />
          <span>—</span>
          <input
            type="date"
            aria-label="ถึงวันที่"
            className={selectCls}
            value={current.to ?? ""}
            onChange={(e) => setParam("to", e.target.value)}
          />
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            defaultValue={current.q ?? ""}
            placeholder="ค้นผู้ขาย / เลขที่ / เลขภาษี"
            onKeyDown={(e) => {
              if (e.key === "Enter") setParam("q", (e.target as HTMLInputElement).value.trim());
            }}
            className="h-9 w-56 rounded-lg border border-zinc-200 bg-white pl-8 pr-2.5 text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-600)]/30"
          />
        </div>

        {hasAnyFilter && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 h-9 px-2.5 rounded-lg text-sm text-zinc-500 hover:bg-zinc-100"
          >
            <X className="h-4 w-4" /> ล้างตัวกรอง
          </button>
        )}
      </div>
    </div>
  );
}
