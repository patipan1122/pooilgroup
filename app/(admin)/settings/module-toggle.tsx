"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MODULE_LIST } from "@/lib/modules";
import { cn } from "@/lib/utils/cn";

interface Props {
  status: Record<string, boolean>;
}

export function ModuleToggleList({ status: initial }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  function toggle(moduleName: string, next: boolean) {
    setUpdatingId(moduleName);
    setStatus((s) => ({ ...s, [moduleName]: next }));
    startTransition(async () => {
      const res = await fetch("/api/admin/settings/modules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleName, isActive: next }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error || "เปลี่ยนไม่สำเร็จ");
        // Revert
        setStatus((s) => ({ ...s, [moduleName]: !next }));
      } else {
        toast.success(
          next ? "เปิดโปรแกรมแล้ว" : "ปิดโปรแกรมแล้ว · ผู้ใช้จะไม่เห็นในเมนู",
        );
        router.refresh();
      }
      setUpdatingId(null);
    });
  }

  return (
    <Card className="animate-fade-up delay-150">
      <CardHeader>
        <CardTitle>โปรแกรมที่เปิดใช้</CardTitle>
        <Badge tone="brand">
          {Object.values(status).filter(Boolean).length} / {MODULE_LIST.length}
        </Badge>
      </CardHeader>
      <CardBody className="space-y-2.5">
        <p className="text-xs text-zinc-500">
          ปิดโปรแกรมที่ยังไม่ใช้ — เมนูจะหายจาก sidebar ทุกคน
        </p>
        {MODULE_LIST.map((m) => {
          const isActive = status[m.slug] ?? true;
          const isComingSoon = m.status === "coming_soon";
          const updating = updatingId === m.slug && pending;
          return (
            <div
              key={m.slug}
              className={cn(
                "flex items-center justify-between gap-3 rounded-xl border-2 p-3 transition-colors",
                isActive
                  ? "border-[var(--color-brand-200)] bg-[var(--color-brand-50)]/40"
                  : "border-zinc-200 bg-zinc-50",
              )}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-2xl">{m.emoji}</span>
                <div className="min-w-0">
                  <div className="font-semibold text-sm flex items-center gap-2">
                    {m.name}
                    {isComingSoon && (
                      <Badge tone="neutral">เร็ว ๆ นี้</Badge>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500 truncate">
                    {m.tagline}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => toggle(m.slug, !isActive)}
                disabled={updating}
                className={cn(
                  "relative inline-flex shrink-0 h-9 w-16 rounded-full transition-colors",
                  isActive
                    ? "bg-[var(--color-brand-600)]"
                    : "bg-zinc-300",
                  updating && "opacity-50 cursor-wait",
                )}
                aria-label={`Toggle ${m.name}`}
              >
                <span
                  className={cn(
                    "inline-block size-7 rounded-full bg-white shadow transition-transform absolute top-1",
                    isActive ? "translate-x-8" : "translate-x-1",
                  )}
                />
              </button>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}
