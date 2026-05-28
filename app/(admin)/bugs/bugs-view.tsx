"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Bug, Filter, ExternalLink, ImageIcon, Loader2 } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";

type BugStatus = "new" | "acked" | "fixed" | "closed";

export interface BugRow {
  id: string;
  url: string;
  description: string;
  screenshot_key: string | null;
  screenshotUrl: string | null;
  status: BugStatus;
  admin_note: string | null;
  acknowledged_at: string | null;
  fixed_at: string | null;
  created_at: string;
  updated_at: string;
  reporter: { id: string; name: string; email: string } | null;
  acknowledged_by: { id: string; name: string } | null;
}

const STATUS_LABELS: Record<BugStatus, string> = {
  new: "ใหม่",
  acked: "รับเรื่อง",
  fixed: "แก้แล้ว",
  closed: "ปิด",
};

const STATUS_CLASSES: Record<BugStatus, string> = {
  new: "bg-red-100 text-red-700 border-red-200",
  acked: "bg-amber-100 text-amber-700 border-amber-200",
  fixed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  closed: "bg-zinc-100 text-zinc-600 border-zinc-200",
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function BugsView({ initialBugs }: { initialBugs: BugRow[] }) {
  const [bugs, setBugs] = useState(initialBugs);
  const [filter, setFilter] = useState<BugStatus | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(
    () => (filter === "all" ? bugs : bugs.filter((b) => b.status === filter)),
    [bugs, filter],
  );

  const counts = useMemo(() => {
    const c: Record<BugStatus, number> = { new: 0, acked: 0, fixed: 0, closed: 0 };
    for (const b of bugs) c[b.status] += 1;
    return c;
  }, [bugs]);

  async function updateBug(
    id: string,
    updates: { status?: BugStatus; adminNote?: string },
  ) {
    // Optimistic update
    setBugs((prev) =>
      prev.map((b) =>
        b.id === id
          ? {
              ...b,
              ...(updates.status ? { status: updates.status } : {}),
              ...(updates.adminNote !== undefined
                ? { admin_note: updates.adminNote }
                : {}),
            }
          : b,
      ),
    );
    try {
      const res = await fetch(`/api/bugs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "อัปเดตไม่สำเร็จ");
      }
      toast.success("อัปเดตแล้ว");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "เกิดข้อผิดพลาด";
      toast.error(msg);
      // Rollback by refetching
      try {
        const r = await fetch("/api/bugs");
        if (r.ok) {
          const j = (await r.json()) as { bugs: BugRow[] };
          setBugs(j.bugs);
        }
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <div className="space-y-4 px-4 py-6 sm:px-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-soft">
            <Bug className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold font-display tracking-tight">
              รายการบัค
            </h1>
            <p className="text-sm text-zinc-500">
              พนักงานแจ้งมา · จัดการสถานะ + แก้ทีเดียว
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <Filter className="size-4 text-zinc-400" />
          {(["all", "new", "acked", "fixed", "closed"] as const).map((s) => {
            const label =
              s === "all" ? `ทั้งหมด (${bugs.length})` : `${STATUS_LABELS[s]} (${counts[s]})`;
            return (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={cn(
                  "px-3 py-1.5 rounded-lg font-medium border transition-colors",
                  filter === s
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "bg-white text-zinc-700 border-zinc-200 hover:border-zinc-400",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardBody className="text-center py-16">
            <Bug className="size-12 mx-auto text-zinc-300 mb-3" />
            <p className="text-zinc-500">
              {filter === "all"
                ? "ยังไม่มีบัครายงานเข้ามา 🎉"
                : `ไม่มีบัค status "${STATUS_LABELS[filter as BugStatus]}"`}
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((bug) => {
            const isOpen = expanded === bug.id;
            return (
              <Card key={bug.id}>
                <CardHeader className="cursor-pointer" onClick={() => setExpanded(isOpen ? null : bug.id)}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <Badge className={cn("border", STATUS_CLASSES[bug.status])}>
                          {STATUS_LABELS[bug.status]}
                        </Badge>
                        {bug.screenshot_key && (
                          <Badge className="bg-blue-100 text-blue-700 border-blue-200 border">
                            <ImageIcon className="size-3 mr-1 inline" />
                            มี screenshot
                          </Badge>
                        )}
                        <span className="text-xs text-zinc-400">
                          {formatDateTime(bug.created_at)}
                        </span>
                      </div>
                      <CardTitle className="text-base font-bold line-clamp-2">
                        {bug.description.slice(0, 120)}
                        {bug.description.length > 120 && "..."}
                      </CardTitle>
                      <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500 flex-wrap">
                        <span className="font-medium text-zinc-700">
                          {bug.reporter?.name ?? "(ผู้ใช้ถูกลบ)"}
                        </span>
                        <span>·</span>
                        <code className="text-zinc-500 break-all">{bug.url}</code>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                {isOpen && (
                  <CardBody className="border-t border-zinc-100 space-y-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">
                        รายละเอียด
                      </p>
                      <p className="text-sm text-zinc-700 whitespace-pre-wrap leading-relaxed">
                        {bug.description}
                      </p>
                    </div>

                    {bug.screenshotUrl && (
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">
                          Screenshot
                        </p>
                        <a
                          href={bug.screenshotUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block rounded-xl border-2 border-zinc-200 overflow-hidden bg-zinc-50 hover:border-amber-400 transition-colors"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={bug.screenshotUrl}
                            alt="bug screenshot"
                            className="w-full max-h-96 object-contain"
                          />
                        </a>
                        <a
                          href={bug.screenshotUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-amber-600 hover:underline mt-1 inline-flex items-center gap-1"
                        >
                          เปิดเต็มขนาด <ExternalLink className="size-3" />
                        </a>
                      </div>
                    )}

                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">
                        Admin note
                      </p>
                      <textarea
                        defaultValue={bug.admin_note ?? ""}
                        onBlur={(e) => {
                          const newVal = e.target.value;
                          if (newVal !== (bug.admin_note ?? "")) {
                            void updateBug(bug.id, { adminNote: newVal });
                          }
                        }}
                        placeholder="โน้ตจาก admin · diagnose · plan · commit sha · ฯลฯ"
                        rows={2}
                        maxLength={2000}
                        className="w-full px-3 py-2 rounded-xl border-2 border-zinc-200 focus:border-amber-500 focus:outline-none text-sm resize-none"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                        เปลี่ยนสถานะ:
                      </span>
                      {(["new", "acked", "fixed", "closed"] as const).map((s) => (
                        <Button
                          key={s}
                          size="sm"
                          variant={bug.status === s ? "primary" : "outline"}
                          onClick={() => void updateBug(bug.id, { status: s })}
                          disabled={bug.status === s}
                        >
                          {STATUS_LABELS[s]}
                        </Button>
                      ))}
                    </div>

                    {bug.acknowledged_at && (
                      <p className="text-xs text-zinc-500">
                        รับเรื่องโดย {bug.acknowledged_by?.name ?? "—"} ·{" "}
                        {formatDateTime(bug.acknowledged_at)}
                      </p>
                    )}
                    {bug.fixed_at && (
                      <p className="text-xs text-emerald-600">
                        ✅ แก้แล้วเมื่อ {formatDateTime(bug.fixed_at)}
                      </p>
                    )}
                  </CardBody>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
