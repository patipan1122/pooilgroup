"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  ZoomIn,
  Video,
  X,
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
  const [zoomPin, setZoomPin] = useState<PinpointPin | null>(null);

  // ปิดภาพขยายด้วยปุ่ม Esc
  useEffect(() => {
    if (!zoomPin) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomPin(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomPin]);

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

      {/* Per-session screen recording (โหมดติชม: อัดวิดีโอ) — served straight
          from the public R2 URL, same as screenshots. */}
      {session.recording_key && r2PublicUrl && (
        <div className="mb-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-zinc-500">
            <Video className="size-3.5" /> วิดีโออัดหน้าจอ
          </div>
          <video
            src={`${r2PublicUrl}/${session.recording_key}`}
            controls
            playsInline
            className="max-h-[70vh] w-full rounded-2xl border-2 border-zinc-100 bg-black"
          />
        </div>
      )}

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
                  <div className="p-3">
                    {/* หัว: ลำดับ + ป้าย + คอมเมนต์ (อ่านก่อน) */}
                    <div className="mb-1.5 flex items-center gap-2">
                      <span
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-white",
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
                      <p className="mt-1 break-words text-xs text-zinc-400">
                        ที่: “{pin.element_text}”
                      </p>
                    )}

                    {/* ภาพหน้าจอ — ใหญ่เต็มการ์ด อ่านง่าย · กดเพื่อดูเต็ม + จุดที่ติชม */}
                    {pin.screenshot_key && r2PublicUrl ? (
                      <button
                        type="button"
                        onClick={() => setZoomPin(pin)}
                        title="กดเพื่อดูภาพเต็ม + จุดที่ติชม"
                        className="group relative mt-3 block w-full cursor-zoom-in overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`${r2PublicUrl}/${pin.screenshot_key}`}
                          alt={`ภาพหน้าจอ จุดที่ ${pin.seq}`}
                          className="max-h-[460px] w-full object-cover object-top"
                          loading="lazy"
                        />
                        <span className="absolute right-2 top-2 flex items-center gap-1 rounded-lg bg-black/55 px-2 py-1 text-[11px] font-medium text-white opacity-90 transition group-hover:bg-black/70">
                          <ZoomIn className="size-3.5" /> กดดูเต็ม + จุดที่ติชม
                        </span>
                      </button>
                    ) : (
                      <div className="mt-3 flex h-28 w-full items-center justify-center rounded-xl border border-dashed border-zinc-200 text-xs text-zinc-400">
                        ไม่มีภาพหน้าจอ
                      </div>
                    )}
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

      {/* ภาพขยาย — กล่องลอย ลากย้าย/ปรับขนาดได้ + จุดมาร์คตำแหน่งที่กด */}
      {zoomPin && (
        <ZoomPanel
          pin={zoomPin}
          r2PublicUrl={r2PublicUrl}
          onClose={() => setZoomPin(null)}
        />
      )}
    </div>
  );
}

/** กล่องดูภาพหน้าจอแบบลอย — เล็ก ลากย้ายได้ ปรับขนาดได้ (ไม่บังทั้งจอ)
 *  + วาดจุดหมายเลขทับตรงตำแหน่งที่ผู้ใช้กดจริง (จากพิกัด docX/docY ที่เก็บไว้). */
function ZoomPanel({
  pin,
  r2PublicUrl,
  onClose,
}: {
  pin: PinpointPin;
  r2PublicUrl: string;
  onClose: () => void;
}) {
  const src = `${r2PublicUrl}/${pin.screenshot_key}`;
  const [pos, setPos] = useState(() => ({
    x: Math.max(
      16,
      (typeof window !== "undefined" ? window.innerWidth : 1200) - 560 - 24,
    ),
    y: 88,
  }));
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ลากย้ายกล่องด้วยแถบหัว
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      setPos({
        x: Math.min(
          Math.max(0, e.clientX - dragRef.current.dx),
          window.innerWidth - 120,
        ),
        y: Math.min(
          Math.max(0, e.clientY - dragRef.current.dy),
          window.innerHeight - 48,
        ),
      });
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  // ตำแหน่งจุดที่กด (เป็น % ของภาพ).
  const meta = pin.element_meta as
    | { docX?: number; docY?: number; capture?: string }
    | null;
  const vw = pin.viewport_w;

  let markerLeft: number | null = null;
  let markerTop: number | null = null;

  if (meta?.capture === "viewport") {
    // หมุดใหม่: ภาพคือ "กรอบจอที่เห็น" → จุดที่กด = coordXPct/YPct ตรง ๆ (เทียบจอ = เทียบภาพ).
    if (pin.coord_x_pct != null && pin.coord_y_pct != null) {
      markerLeft = Math.min(100, Math.max(0, pin.coord_x_pct));
      markerTop = Math.min(100, Math.max(0, pin.coord_y_pct));
    }
  } else {
    // หมุดเก่า: ภาพคือ "ทั้งหน้าเอกสาร" → ใช้ docX/docY เทียบความสูงเอกสารเหมือนเดิม.
    // markerLeft% = docX / กว้างจอ · markerTop% = docY × (กว้างภาพจริง / สูงภาพจริง) / กว้างจอ
    // (scale ของ snapdom หักล้างกันเองผ่านอัตราส่วนภาพจริง → ไม่ต้องรู้ scale)
    const docX =
      meta?.docX ??
      (pin.coord_x_pct != null && vw != null
        ? (pin.coord_x_pct / 100) * vw
        : null);
    const docY =
      meta?.docY ??
      (pin.coord_y_pct != null && pin.viewport_h != null
        ? (pin.coord_y_pct / 100) * pin.viewport_h
        : null);
    if (docX != null && docY != null && vw && nat && nat.w > 0 && nat.h > 0) {
      markerLeft = Math.min(100, Math.max(0, (docX / vw) * 100));
      markerTop = Math.min(
        100,
        Math.max(0, ((docY * nat.w) / (vw * nat.h)) * 100),
      );
    }
  }

  // เลื่อนให้เห็นจุดที่กดเมื่อโหลดภาพเสร็จ
  useEffect(() => {
    if (markerTop == null || !scrollRef.current) return;
    const el = scrollRef.current;
    el.scrollTop = Math.max(
      0,
      (markerTop / 100) * el.scrollHeight - el.clientHeight / 2,
    );
  }, [markerTop, nat]);

  return (
    <div
      role="dialog"
      aria-label={`ภาพหน้าจอ จุดที่ ${pin.seq}`}
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-[100] flex h-[70vh] max-h-[90vh] min-h-[240px] w-[min(560px,95vw)] min-w-[300px] max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-2xl"
    >
      {/* แถบหัว — ลากเพื่อย้าย */}
      <div
        onPointerDown={(e) => {
          dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
        }}
        className="flex shrink-0 cursor-move select-none items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-2"
      >
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-white",
            pin.priority === "urgent"
              ? "bg-red-600"
              : "bg-[var(--color-brand-600)]",
          )}
        >
          {pin.seq}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-600">
          {pin.comment || "ภาพหน้าจอ"}
        </span>
        <span className="hidden shrink-0 text-[10px] text-zinc-400 lg:inline">
          ลากย้าย · ลากมุมล่างขวาเพื่อย่อ/ขยาย
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="ปิด"
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-200"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* พื้นที่ภาพ */}
      <div ref={scrollRef} className="relative flex-1 overflow-auto bg-zinc-100">
        <div className="relative w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={`ภาพหน้าจอ จุดที่ ${pin.seq}`}
            draggable={false}
            onLoad={(e) =>
              setNat({
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight,
              })
            }
            className="block w-full select-none"
          />
          {markerLeft != null && markerTop != null && (
            <span
              style={{ left: `${markerLeft}%`, top: `${markerTop}%` }}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
            >
              <span className="relative flex size-7 items-center justify-center">
                <span className="absolute inline-flex size-7 animate-ping rounded-full bg-red-500/60" />
                <span
                  className={cn(
                    "relative flex size-7 items-center justify-center rounded-full border-2 border-white text-[11px] font-extrabold text-white shadow-lg",
                    pin.priority === "urgent"
                      ? "bg-red-600"
                      : "bg-[var(--color-brand-600)]",
                  )}
                >
                  {pin.seq}
                </span>
              </span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
