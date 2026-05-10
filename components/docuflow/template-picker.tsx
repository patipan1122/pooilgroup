"use client";

// TemplatePicker — Smart Upload Step 1
// ────────────────────────────────────────────────────────────────────
// Searchable list of canonical doc templates grouped by business type.
// Click → /docuflow/documents/upload?template=BIZTYPE:NAME
// ────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, ArrowRight, Clock, Shield } from "lucide-react";
import { Input } from "@/components/ui/input";
import type {
  CanonicalDocSpec,
  DocDangerLevel,
} from "@/lib/docuflow/canonical-docs";

interface TypeGroup {
  bizType: string;
  emoji: string;
  label: string;
  docs: CanonicalDocSpec[];
}

interface Props {
  groups: TypeGroup[];
  personnelDocs: Array<{ bizType: string; spec: CanonicalDocSpec }>;
  dangerLabel: Record<DocDangerLevel, string>;
  dangerTone: Record<
    DocDangerLevel,
    "danger" | "warning" | "neutral" | "success"
  >;
}

export function TemplatePicker({
  groups,
  personnelDocs,
  dangerLabel,
  dangerTone,
}: Props) {
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return { groups, personnel: personnelDocs };
    const matchesQuery = (s: CanonicalDocSpec) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      (s.regulator?.toLowerCase().includes(q) ?? false);
    return {
      groups: groups
        .map((g) => ({ ...g, docs: g.docs.filter(matchesQuery) }))
        .filter((g) => g.docs.length > 0),
      personnel: personnelDocs.filter(({ spec }) => matchesQuery(spec)),
    };
  }, [q, groups, personnelDocs]);

  const total =
    filtered.groups.reduce((sum, g) => sum + g.docs.length, 0) +
    filtered.personnel.length;

  return (
    <div className="space-y-5">
      <div className="relative">
        <Search className="size-4 text-zinc-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหา เช่น ใบอนุญาต / ถังน้ำมัน / สัญญา"
          className="pl-10"
        />
      </div>

      {q && (
        <p className="text-xs text-zinc-500">
          พบ {total} template{total === 0 ? " — ลองคำอื่น หรือกรอกข้อมูลเอง" : ""}
        </p>
      )}

      {filtered.groups.map((g) => (
        <section key={g.bizType}>
          <h2 className="text-sm font-bold text-zinc-700 mb-2 sticky top-0 bg-white py-1">
            <span className="text-base mr-1.5">{g.emoji}</span>
            {g.label}
            <span className="text-zinc-400 font-medium ml-2">
              · {g.docs.length} ฉบับ
            </span>
          </h2>
          <div className="space-y-1.5">
            {g.docs.map((spec) => (
              <TemplateRow
                key={`${g.bizType}-${spec.name}`}
                bizType={g.bizType}
                spec={spec}
                dangerLabel={dangerLabel}
                dangerTone={dangerTone}
              />
            ))}
          </div>
        </section>
      ))}

      {filtered.personnel.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-zinc-700 mb-2 sticky top-0 bg-white py-1">
            <span className="text-base mr-1.5">🧑‍💼</span>
            เอกสารบุคลากร
            <span className="text-zinc-400 font-medium ml-2">
              · {filtered.personnel.length} ฉบับ
            </span>
          </h2>
          <div className="space-y-1.5">
            {filtered.personnel.map(({ bizType, spec }) => (
              <TemplateRow
                key={`personnel-${spec.name}`}
                bizType={bizType}
                spec={spec}
                dangerLabel={dangerLabel}
                dangerTone={dangerTone}
              />
            ))}
          </div>
        </section>
      )}

      {q && total === 0 && (
        <div className="rounded-xl border-2 border-dashed border-zinc-200 p-8 text-center">
          <p className="text-zinc-600 font-medium">ไม่เจอ template ที่ค้นหา</p>
          <p className="text-sm text-zinc-500 mt-1">
            ลองคำอื่น หรือกดปุ่ม "กรอกข้อมูลเอง" ด้านล่าง
          </p>
        </div>
      )}
    </div>
  );
}

function TemplateRow({
  bizType,
  spec,
  dangerLabel,
  dangerTone,
}: {
  bizType: string;
  spec: CanonicalDocSpec;
  dangerLabel: Record<DocDangerLevel, string>;
  dangerTone: Record<
    DocDangerLevel,
    "danger" | "warning" | "neutral" | "success"
  >;
}) {
  const tone = dangerTone[spec.dangerLevel];
  const tonePalette = {
    danger: "bg-rose-50 border-rose-200 text-rose-700",
    warning: "bg-amber-50 border-amber-200 text-amber-800",
    neutral: "bg-zinc-50 border-zinc-200 text-zinc-700",
    success: "bg-emerald-50 border-emerald-200 text-emerald-700",
  }[tone];

  // Encode "biztype:name" — name may contain spaces/Thai → use encodeURIComponent
  const href = `/docuflow/documents/upload?template=${encodeURIComponent(`${bizType}:${spec.name}`)}`;

  return (
    <Link
      href={href}
      className="flex items-center gap-3 p-3 rounded-xl border-2 border-zinc-100 hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]/40 transition-colors group"
    >
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-zinc-900 truncate">{spec.name}</p>
        <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500 flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" />
            {spec.frequency}
          </span>
          {spec.regulator && (
            <>
              <span>·</span>
              <span className="truncate">{spec.regulator}</span>
            </>
          )}
        </div>
      </div>
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-bold shrink-0 ${tonePalette}`}
      >
        <Shield className="size-3" />
        {dangerLabel[spec.dangerLevel]}
      </span>
      <ArrowRight className="size-4 text-zinc-400 group-hover:text-[var(--color-brand-600)] group-hover:translate-x-0.5 transition-all shrink-0" />
    </Link>
  );
}
