"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Copy,
  Check,
  Trash2,
  CircleDot,
  CheckCircle2,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { PinpointPin } from "@/lib/pinpoint/types";
import type { SessionListRow } from "@/lib/pinpoint/data";

export function SessionReview({
  session,
  pins: initialPins,
  canReview,
  r2PublicUrl,
}: {
  session: SessionListRow;
  pins: PinpointPin[];
  canReview: boolean;
  r2PublicUrl: string;
}) {
  const router = useRouter();
  const [pins, setPins] = useState<PinpointPin[]>(initialPins);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);

  const byUrl = useMemo(() => {
    const m = new Map<string, PinpointPin[]>();
    for (const p of pins) {
      const arr = m.get(p.url) ?? [];
      arr.push(p);
      m.set(p.url, arr);
    }
    return Array.from(m.entries());
  }, [pins]);

  async function copyForClaude() {
    setCopying(true);
    try {
      const res = await fetch(`/api/pinpoint/sessions/${session.id}/export`);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "ดึงรายงานไม่สำเร็จ");
      }
      const { markdown } = (await res.json()) as { markdown: string };
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      toast.success("คัดลอกแล้ว — เอาไปวางให้พิมได้เลย");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ผิดพลาด");
    } finally {
      setCopying(false);
    }
  }

  async function markReviewed() {
    try {
      const res = await fetch(`/api/pinpoint/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "review" }),
      });
      if (!res.ok) throw new Error();
      toast.success("ทำเครื่องหมายรีวิวแล้ว");
      router.refresh();
    } catch {
      toast.error("ผิดพลาด");
    }
  }

  async function setPinStatus(pin: PinpointPin, status: "open" | "fixed") {
    setPins((prev) =>
      prev.map((p) => (p.id === pin.id ? { ...p, status } : p)),
    );
    try {
      await fetch(`/api/pinpoint/pins/${pin.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    } catch {
      /* optimistic */
    }
  }

  async function deletePin(pin: PinpointPin) {
    setPins((prev) => prev.filter((p) => p.id !== pin.id));
    try {
      await fetch(`/api/pinpoint/pins/${pin.id}`, { method: "DELETE" });
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <button
        type="button"
        onClick={() => router.push("/pinpoint")}
        className="mb-3 flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
      >
        <ArrowLeft className="size-4" /> รอบติชมทั้งหมด
      </button>

      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold font-display">
            {session.title?.trim() || `รอบติชม ${session.id.slice(0, 8)}`}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {pins.length} จุด · {session.author?.name ?? "—"}
          </p>
        </div>
        {canReview && (
          <button
            type="button"
            onClick={copyForClaude}
            disabled={copying || pins.length === 0}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-[var(--color-brand-600)] px-3.5 py-2 text-sm font-bold text-white shadow-blue disabled:opacity-50"
          >
            {copying ? (
              <Loader2 className="size-4 animate-spin" />
            ) : copied ? (
              <Check className="size-4" />
            ) : (
              <Copy className="size-4" />
            )}
            {copied ? "คัดลอกแล้ว" : "คัดลอกให้พิม"}
          </button>
        )}
      </header>

      {canReview && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ⚠️ ภาพหน้าจออาจมีข้อมูลลูกค้า/เลขบัญชี — ตรวจก่อนส่งออก · ภาพลบอัตโนมัติใน 30 วัน
        </div>
      )}

      <div className="space-y-5">
        {byUrl.map(([url, group]) => (
          <section key={url}>
            <div className="mb-2 flex items-center gap-1.5">
              <code className="truncate rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">
                {url}
              </code>
              <ExternalLink className="size-3 shrink-0 text-zinc-300" />
            </div>
            <ul className="space-y-3">
              {group.map((pin) => (
                <li
                  key={pin.id}
                  className="overflow-hidden rounded-2xl border-2 border-zinc-100 bg-white"
                >
                  <div className="flex gap-3 p-3">
                    {pin.screenshot_key && r2PublicUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`${r2PublicUrl}/${pin.screenshot_key}`}
                        alt={`จุดที่ ${pin.seq}`}
                        className="h-20 w-28 shrink-0 rounded-lg border border-zinc-200 object-cover object-top"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-20 w-28 shrink-0 items-center justify-center rounded-lg border border-dashed border-zinc-200 text-[10px] text-zinc-400">
                        ไม่มีภาพ
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span
                          className={cn(
                            "flex size-5 items-center justify-center rounded-full text-[10px] font-extrabold text-white",
                            pin.priority === "urgent"
                              ? "bg-red-600"
                              : "bg-[var(--color-brand-600)]",
                          )}
                        >
                          {pin.seq}
                        </span>
                        {pin.priority === "urgent" && (
                          <span className="rounded-full bg-red-100 px-1.5 text-[10px] font-bold text-red-700">
                            ด่วน
                          </span>
                        )}
                        {pin.status === "fixed" && (
                          <span className="rounded-full bg-emerald-100 px-1.5 text-[10px] font-bold text-emerald-700">
                            แก้แล้ว
                          </span>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap break-words text-sm text-zinc-800">
                        {pin.comment || (
                          <span className="text-zinc-400">(ไม่มีคอมเมนต์)</span>
                        )}
                      </p>
                      {pin.element_text && (
                        <p className="mt-1 truncate text-xs text-zinc-400">
                          ที่: “{pin.element_text}”
                        </p>
                      )}
                    </div>
                  </div>
                  {canReview && (
                    <div className="flex items-center gap-2 border-t border-zinc-100 px-3 py-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setPinStatus(
                            pin,
                            pin.status === "fixed" ? "open" : "fixed",
                          )
                        }
                        className="flex items-center gap-1 text-xs font-semibold text-emerald-700"
                      >
                        {pin.status === "fixed" ? (
                          <CheckCircle2 className="size-3.5" />
                        ) : (
                          <CircleDot className="size-3.5" />
                        )}
                        {pin.status === "fixed" ? "แก้แล้ว" : "ทำเครื่องหมายแก้แล้ว"}
                      </button>
                      <button
                        type="button"
                        onClick={() => deletePin(pin)}
                        className="ml-auto flex items-center gap-1 text-xs text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="size-3.5" /> ลบ
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {canReview && session.status !== "reviewed" && session.status !== "closed" && (
        <div className="mt-6">
          <button
            type="button"
            onClick={markReviewed}
            className="w-full rounded-xl border-2 border-zinc-200 py-2.5 text-sm font-bold text-zinc-700 hover:border-[var(--color-brand-600)]"
          >
            ทำเครื่องหมายว่ารีวิวแล้ว
          </button>
        </div>
      )}
    </div>
  );
}
