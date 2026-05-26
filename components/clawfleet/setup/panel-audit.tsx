"use client";

// PanelAudit — compact view of recent ClawFleet-scoped audit entries.
// Reads from shared AuditLog (resourceType starts with cf_ · action with CF_).
// Full filter/export lives at /clawfleet/reports?tab=audit (link out).

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  History,
  ExternalLink,
  Search,
  Inbox,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface AuditEntry {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  createdAt: string;
  actor: { id: string; name: string; email: string | null } | null;
}

export interface PanelAuditProps {
  entries: AuditEntry[];
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const time = d.toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (sameDay) return `วันนี้ ${time}`;
  return d.toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ACTION_TONE: Record<
  string,
  "success" | "warning" | "danger" | "info" | "neutral"
> = {
  CREATE: "success",
  UPDATE: "info",
  DELETE: "danger",
  APPROVE: "success",
  REJECT: "warning",
  LOGIN: "neutral",
};

function actionTone(action: string) {
  for (const key of Object.keys(ACTION_TONE)) {
    if (action.includes(key)) return ACTION_TONE[key];
  }
  return "neutral";
}

export function PanelAudit({ entries }: PanelAuditProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.action.toLowerCase().includes(q) ||
        e.resourceType.toLowerCase().includes(q) ||
        (e.actor?.name ?? "").toLowerCase().includes(q) ||
        (e.actor?.email ?? "").toLowerCase().includes(q),
    );
  }, [entries, search]);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700">
            <History className="size-5" />
          </span>
          <div>
            <h2 className="text-xl font-semibold text-zinc-900">Audit log</h2>
            <p className="text-sm text-zinc-500">
              ใครทำอะไรล่าสุด · เก็บ 50 รายการ
            </p>
          </div>
        </div>
        <Link
          href="/clawfleet/reports?tab=audit"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
        >
          ดูเต็ม · Reports
          <ExternalLink className="size-3.5" />
        </Link>
      </header>

      {/* Search filter */}
      <div className="border-b border-zinc-100 px-6 py-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหา action / ผู้ใช้ / resource…"
            className="h-9 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 text-sm outline-none placeholder:text-zinc-400 focus:border-indigo-500"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <Inbox className="mx-auto size-8 text-zinc-300" />
          <h3 className="mt-3 text-base font-semibold text-zinc-900">
            ยังไม่มีรายการ audit
          </h3>
          <p className="mt-1 text-sm text-zinc-500">
            {entries.length === 0
              ? "ตาราง cf_audit_log จะถูกเติมอัตโนมัติเมื่อมีการแก้ไขข้อมูล ClawFleet · ระบบยังเป็น Phase 1 (TODO ทีม dev)"
              : "ไม่พบรายการที่ตรงกับคำค้น"}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {filtered.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center gap-3 px-6 py-3 hover:bg-zinc-50"
            >
              <Badge tone={actionTone(entry.action)}>{entry.action}</Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-900">
                  {entry.actor?.name ?? "ระบบ"}
                  <span className="ml-1 font-normal text-zinc-500">
                    · {entry.resourceType}
                    {entry.resourceId && (
                      <span className="ml-1 font-mono text-xs text-zinc-400">
                        {entry.resourceId.slice(0, 8)}…
                      </span>
                    )}
                  </span>
                </p>
                <p className="text-xs text-zinc-500">
                  {entry.actor?.email ?? "—"} · {formatWhen(entry.createdAt)}
                </p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-zinc-300" />
            </li>
          ))}
        </ul>
      )}

      <footer className="border-t border-zinc-100 bg-zinc-50 px-6 py-3 text-center text-xs text-zinc-500">
        แสดง {filtered.length} จาก {entries.length} ·{" "}
        <Link
          href="/clawfleet/reports?tab=audit"
          className="font-semibold text-blue-600 hover:underline"
        >
          ดูเต็มในหน้า Insights → Audit log
        </Link>
      </footer>
    </section>
  );
}
