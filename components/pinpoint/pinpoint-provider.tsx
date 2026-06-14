// Pinpoint / โหมดติชม — global comment-mode overlay.
//
// Mounted once in the admin shell (admin-tier only). Renders NOTHING until the
// user starts a session from the AI button (window 'pinpoint:start' event), so
// it costs ~0 until used. snapdom is lazy-imported only on first capture.
//
// Sub-modes while active:
//   • placing ON  → clicks on the page drop a pin (crosshair + viewport ring).
//   • placing OFF → page is fully usable; the user can navigate to other pages
//     while the session keeps collecting pins (the session bar follows along).
// This split resolves "click = pin" vs "I need to navigate" cleanly.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Crosshair,
  Hand,
  Check,
  X,
  Trash2,
  Loader2,
  ListChecks,
  Pause,
  Play,
  Mic,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { buildSelector, buildElementMeta, elementText } from "@/lib/pinpoint/selector";
import { captureBody, uploadCapture, isLikelyMobile } from "@/lib/pinpoint/capture";
import type { ElementMeta, PinpointPriority } from "@/lib/pinpoint/types";

const LS_KEY = "pinpoint:v1";

interface LocalPin {
  id: string;
  seq: number;
  url: string;
  comment: string;
  priority: PinpointPriority;
  coordXPct: number;
  coordYPct: number;
  /** Document-space px (audit B1) — markers anchor here so they don't drift on
   *  scroll. Falls back from coordXPct for legacy pins lacking doc coords. */
  docX: number;
  docY: number;
  screenshotKey: string | null;
}

interface DraftPin {
  xPct: number;
  yPct: number;
  clientX: number;
  clientY: number;
  docX: number;
  docY: number;
  selector: string;
  text: string;
  meta: ElementMeta;
}

interface Persisted {
  sessionId: string;
  paused?: boolean;
}

function readLS(): Persisted | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}
function writeLS(v: Persisted | null) {
  try {
    if (v) localStorage.setItem(LS_KEY, JSON.stringify(v));
    else localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

function currentUrl(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname + window.location.search;
}

export function PinpointProvider() {
  const pathname = usePathname();
  const router = useRouter();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [pins, setPins] = useState<LocalPin[]>([]);
  const [draft, setDraft] = useState<DraftPin | null>(null);
  const [busy, setBusy] = useState(false);

  // screenshot key cache per page-url + in-flight guard
  const shotCache = useRef<Map<string, string>>(new Map());
  const shotInFlight = useRef<Set<string>>(new Set());
  const trapRef = useRef<HTMLDivElement | null>(null);

  // ── start / resume / pause ──────────────────────────────────────────────
  const loadPins = useCallback(async (sid: string) => {
    try {
      const res = await fetch(`/api/pinpoint/sessions/${sid}`);
      if (!res.ok) return;
      const json = (await res.json()) as {
        pins: Array<{
          id: string;
          seq: number;
          url: string;
          comment: string | null;
          priority: PinpointPriority;
          coord_x_pct: number | null;
          coord_y_pct: number | null;
          element_meta: { docX?: number; docY?: number } | null;
          screenshot_key: string | null;
        }>;
      };
      const vw = typeof window !== "undefined" ? window.innerWidth : 1000;
      const vh = typeof window !== "undefined" ? window.innerHeight : 800;
      setPins(
        json.pins.map((p) => {
          const xPct = p.coord_x_pct ?? 50;
          const yPct = p.coord_y_pct ?? 50;
          return {
            id: p.id,
            seq: p.seq,
            url: p.url,
            comment: p.comment ?? "",
            priority: p.priority,
            coordXPct: xPct,
            coordYPct: yPct,
            // Prefer stored doc coords; legacy pins fall back to viewport-%.
            docX: p.element_meta?.docX ?? (xPct / 100) * vw,
            docY: p.element_meta?.docY ?? (yPct / 100) * vh,
            screenshotKey: p.screenshot_key,
          };
        }),
      );
    } catch {
      /* ignore */
    }
  }, []);

  const startSession = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/pinpoint/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "เริ่มไม่สำเร็จ");
      }
      const { id } = (await res.json()) as { id: string };
      setSessionId(id);
      setPins([]);
      setActive(true);
      setPaused(false);
      setPlacing(true);
      writeLS({ sessionId: id });
      toast.success("เข้าโหมดติชมแล้ว — แตะจุดไหนก็ได้เพื่อปักหมุด", {
        description: "ภาพหน้าจอนี้อาจมีข้อมูลลูกค้า/เลขบัญชี",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เริ่มไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }, [busy]);

  // Restore on mount + listen for the AI-button trigger.
  useEffect(() => {
    const saved = readLS();
    if (saved?.sessionId) {
      setSessionId(saved.sessionId);
      setPaused(Boolean(saved.paused));
      setActive(!saved.paused);
      setPlacing(false);
      void loadPins(saved.sessionId);
    }
    function onStart() {
      const cur = readLS();
      if (cur?.sessionId && cur.paused) {
        // resume an existing paused session instead of opening a new one
        setSessionId(cur.sessionId);
        setActive(true);
        setPaused(false);
        setPlacing(true);
        writeLS({ sessionId: cur.sessionId });
        void loadPins(cur.sessionId);
        return;
      }
      void startSession();
    }
    window.addEventListener("pinpoint:start", onStart);
    return () => window.removeEventListener("pinpoint:start", onStart);
  }, [loadPins, startSession]);

  // ── per-page best-effort capture (desktop only) ──────────────────────────
  const ensureCapture = useCallback(
    async (url: string) => {
      if (isLikelyMobile()) return; // mobile = structured target only
      if (shotCache.current.has(url) || shotInFlight.current.has(url)) return;
      shotInFlight.current.add(url);
      try {
        const blob = await captureBody();
        if (!blob) return;
        const key = await uploadCapture(blob);
        if (!key) return;
        shotCache.current.set(url, key);
        // Backfill any already-saved pins on this page that lack a screenshot.
        setPins((prev) => {
          const targets = prev.filter(
            (p) => p.url === url && !p.screenshotKey,
          );
          for (const t of targets) {
            void fetch(`/api/pinpoint/pins/${t.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ screenshotKey: key }),
            });
          }
          return prev.map((p) =>
            p.url === url && !p.screenshotKey ? { ...p, screenshotKey: key } : p,
          );
        });
      } finally {
        shotInFlight.current.delete(url);
      }
    },
    [],
  );

  // Capture when entering a page in active+placing mode (one shot per url).
  useEffect(() => {
    if (active && !paused) void ensureCapture(currentUrl());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, paused, pathname]);

  // ── place a pin ───────────────────────────────────────────────────────────
  const onTrapPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const x = e.clientX;
      const y = e.clientY;
      // Find the real element under the click by briefly disabling the trap.
      const trap = trapRef.current;
      let target: Element | null = null;
      if (trap) {
        const prev = trap.style.pointerEvents;
        trap.style.pointerEvents = "none";
        target = document.elementFromPoint(x, y);
        trap.style.pointerEvents = prev || "auto";
      }
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      const el = target ?? document.body;
      setDraft({
        xPct: (x / vw) * 100,
        yPct: (y / vh) * 100,
        clientX: x,
        clientY: y,
        // Document-space px so the marker anchors to content, not the viewport.
        docX: x + window.scrollX,
        docY: y + window.scrollY,
        selector: buildSelector(el),
        text: elementText(el),
        meta: buildElementMeta(el),
      });
    },
    [],
  );

  const savePin = useCallback(
    async (comment: string, priority: PinpointPriority) => {
      if (!sessionId || !draft || busy) return;
      setBusy(true);
      const url = currentUrl();
      void ensureCapture(url);
      try {
        const res = await fetch(`/api/pinpoint/sessions/${sessionId}/pins`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
            comment,
            priority,
            elementSelector: draft.selector,
            elementText: draft.text,
            elementMeta: { ...draft.meta, docX: draft.docX, docY: draft.docY },
            coordXPct: draft.xPct,
            coordYPct: draft.yPct,
            viewportW: window.innerWidth,
            viewportH: window.innerHeight,
            screenshotKey: shotCache.current.get(url) ?? null,
          }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || "บันทึกไม่สำเร็จ");
        }
        const { id, seq } = (await res.json()) as { id: string; seq: number };
        setPins((prev) => [
          ...prev,
          {
            id,
            seq,
            url,
            comment,
            priority,
            coordXPct: draft.xPct,
            coordYPct: draft.yPct,
            docX: draft.docX,
            docY: draft.docY,
            screenshotKey: shotCache.current.get(url) ?? null,
          },
        ]);
        setDraft(null);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      } finally {
        setBusy(false);
      }
    },
    [sessionId, draft, busy, ensureCapture],
  );

  const deletePin = useCallback(
    async (id: string) => {
      setPins((prev) => prev.filter((p) => p.id !== id));
      try {
        await fetch(`/api/pinpoint/pins/${id}`, { method: "DELETE" });
      } catch {
        /* ignore */
      }
    },
    [],
  );

  // ── finish / pause ────────────────────────────────────────────────────────
  const finish = useCallback(async () => {
    if (!sessionId || busy) return;
    if (pins.length === 0) {
      toast.error("ยังไม่มีจุดติชม");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/pinpoint/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "finish" }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "ส่งไม่สำเร็จ");
      }
      const sid = sessionId;
      writeLS(null);
      setActive(false);
      setPlacing(false);
      setSessionId(null);
      setPins([]);
      router.push(`/pinpoint/${sid}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ส่งไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }, [sessionId, busy, pins.length, router]);

  const pause = useCallback(() => {
    if (!sessionId) return;
    writeLS({ sessionId, paused: true });
    setActive(false);
    setPlacing(false);
    setPaused(true);
  }, [sessionId]);

  const resume = useCallback(() => {
    if (!sessionId) return;
    writeLS({ sessionId });
    setPaused(false);
    setActive(true);
    setPlacing(true);
  }, [sessionId]);

  // ── render ──────────────────────────────────────────────────────────────
  if (!sessionId) return null;

  // Paused → small resume chip only.
  if (!active && paused) {
    return (
      <div data-pinpoint-ui>
        <button
          type="button"
          onClick={resume}
          className="fixed bottom-36 right-4 z-[9995] flex items-center gap-1.5 rounded-full bg-[var(--color-brand-600)] px-3.5 py-2 text-xs font-bold text-white shadow-lg"
        >
          <Play className="size-3.5" /> ทำต่อ ติชม ({pins.length})
        </button>
      </div>
    );
  }

  if (!active) return null;

  const pinsHere = pins.filter((p) => p.url === currentUrl());

  return (
    <div data-pinpoint-ui>
      {/* viewport ring — unmistakable "you are in comment mode" */}
      {placing && (
        <div className="pointer-events-none fixed inset-0 z-[9988] ring-[3px] ring-inset ring-[var(--color-brand-600)]" />
      )}

      {/* click trap — only while placing and no draft popover open */}
      {placing && !draft && (
        <div
          ref={trapRef}
          onPointerDown={onTrapPointerDown}
          className="fixed inset-0 z-[9989] cursor-crosshair"
          style={{ touchAction: "none" }}
        />
      )}

      {/* existing pins on this page — portaled to <body> and positioned in
          document space so they scroll WITH the content instead of sticking to
          the viewport (audit B1). Above the trap so they stay clickable. */}
      {typeof document !== "undefined" &&
        createPortal(
          <div
            data-pinpoint-ui
            className="pointer-events-none absolute left-0 top-0 z-[9991]"
          >
            {pinsHere.map((p) => (
              <PinMarker key={p.id} pin={p} onDelete={() => deletePin(p.id)} />
            ))}
          </div>,
          document.body,
        )}

      {/* draft popover */}
      {draft && (
        <PinPopover
          draft={draft}
          seq={pins.length + 1}
          busy={busy}
          onCancel={() => setDraft(null)}
          onSave={savePin}
        />
      )}

      {/* session bar */}
      <SessionBar
        count={pins.length}
        placing={placing}
        busy={busy}
        onTogglePlacing={() => setPlacing((v) => !v)}
        onViewAll={() => router.push(`/pinpoint/${sessionId}`)}
        onFinish={finish}
        onPause={pause}
      />
    </div>
  );
}

// ── pin marker ──────────────────────────────────────────────────────────────
function PinMarker({
  pin,
  onDelete,
}: {
  pin: LocalPin;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="pointer-events-auto absolute z-[9991]"
      style={{
        left: `${pin.docX}px`,
        top: `${pin.docY}px`,
        transform: "translate(-50%, -50%)",
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn(
          "flex size-7 items-center justify-center rounded-full text-[11px] font-extrabold text-white shadow-md ring-2 ring-white",
          pin.priority === "urgent"
            ? "bg-red-600"
            : "bg-[var(--color-brand-600)]",
        )}
        title={pin.comment || `จุดที่ ${pin.seq}`}
      >
        {pin.seq}
      </button>
      {open && (
        <div className="absolute left-1/2 top-8 z-[9992] w-52 -translate-x-1/2 rounded-xl border-2 border-zinc-200 bg-white p-3 text-xs shadow-pop">
          <p className="mb-2 whitespace-pre-wrap break-words text-zinc-700">
            {pin.comment || "(ไม่มีคอมเมนต์)"}
          </p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="flex items-center gap-1 text-red-600 hover:underline"
          >
            <Trash2 className="size-3.5" /> ลบจุดนี้
          </button>
        </div>
      )}
    </div>
  );
}

// ── Web Speech API (พูดแทนพิมพ์) — minimal typed wrapper, no `any` ──────────────
interface SpeechResultLike {
  0: { transcript: string };
}
interface SpeechEventLike {
  results: ArrayLike<SpeechResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ── draft popover ─────────────────────────────────────────────────────────────
function PinPopover({
  draft,
  seq,
  busy,
  onCancel,
  onSave,
}: {
  draft: DraftPin;
  seq: number;
  busy: boolean;
  onCancel: () => void;
  onSave: (comment: string, priority: PinpointPriority) => void;
}) {
  const [comment, setComment] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [listening, setListening] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  // พูดแทนพิมพ์ — Web Speech API (ฟรี, ในเบราว์เซอร์). ซ่อนปุ่มถ้าไม่รองรับ.
  const speechSupported = getSpeechRecognitionCtor() != null;
  function toggleMic() {
    if (listening) {
      recogRef.current?.stop();
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "th-TH";
    r.interimResults = false;
    r.continuous = false;
    r.onresult = (e) => {
      const t = e.results?.[0]?.[0]?.transcript ?? "";
      if (t) setComment((c) => (c.trim() ? c.trim() + " " : "") + t);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recogRef.current = r;
    // start() can throw synchronously (InvalidStateError on rapid re-tap, or when
    // mic permission is hard-blocked). Flip `listening` only on success so the
    // button never gets stuck in the red "หยุดพูด" state with no way to recover.
    try {
      r.start();
      setListening(true);
    } catch {
      recogRef.current = null;
      setListening(false);
    }
  }
  useEffect(() => () => recogRef.current?.stop(), []);

  // Keep the popover on-screen: clamp near the click point.
  const left = Math.min(Math.max(draft.clientX, 130), (typeof window !== "undefined" ? window.innerWidth : 360) - 130);
  const top = Math.min(draft.clientY + 14, (typeof window !== "undefined" ? window.innerHeight : 640) - 200);

  return (
    <div
      className="fixed z-[9994] w-64 -translate-x-1/2 rounded-2xl border-2 border-zinc-200 bg-white p-3 shadow-pop"
      style={{ left, top }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="flex size-6 items-center justify-center rounded-full bg-[var(--color-brand-600)] text-[11px] font-extrabold text-white">
          {seq}
        </span>
        <button
          type="button"
          onClick={onCancel}
          aria-label="ปิด"
          title="ปิด"
          className="text-zinc-400 hover:text-zinc-700"
        >
          <X className="size-4" />
        </button>
      </div>
      <textarea
        ref={ref}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSave(comment.trim(), urgent ? "urgent" : "normal");
        }}
        placeholder="พิมพ์ หรือกดไมค์เพื่อพูด… (เว้นว่างก็ได้)"
        rows={3}
        className="w-full resize-none rounded-lg border border-zinc-300 px-2.5 py-2 text-sm outline-none focus:border-[var(--color-brand-600)]"
      />
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {speechSupported && (
            <button
              type="button"
              onClick={toggleMic}
              aria-label={listening ? "หยุดพูด" : "พูดแทนพิมพ์"}
              title={listening ? "หยุดพูด" : "พูดแทนพิมพ์"}
              className={cn(
                "flex size-7 items-center justify-center rounded-full transition-colors",
                listening
                  ? "animate-pulse bg-red-600 text-white"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200",
              )}
            >
              <Mic className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setUrgent((v) => !v)}
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors",
              urgent ? "bg-red-600 text-white" : "bg-zinc-100 text-zinc-600",
            )}
          >
            🔴 ด่วน
          </button>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => onSave(comment.trim(), urgent ? "urgent" : "normal")}
          className="flex items-center gap-1 rounded-lg bg-[var(--color-brand-600)] px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          บันทึก
        </button>
      </div>
    </div>
  );
}

// ── session bar ───────────────────────────────────────────────────────────────
function SessionBar({
  count,
  placing,
  busy,
  onTogglePlacing,
  onViewAll,
  onFinish,
  onPause,
}: {
  count: number;
  placing: boolean;
  busy: boolean;
  onTogglePlacing: () => void;
  onViewAll: () => void;
  onFinish: () => void;
  onPause: () => void;
}) {
  return (
    <div
      className="fixed bottom-4 left-3 right-16 z-[9993] mx-auto flex max-w-[560px] items-center gap-1.5 rounded-2xl border-2 border-[var(--color-brand-600)] bg-white/95 px-2.5 py-2 shadow-pop backdrop-blur md:right-3"
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    >
      <span className="flex shrink-0 items-center gap-1 px-1 text-xs font-extrabold text-[var(--color-brand-700)]">
        📌
        <span className="rounded-full bg-[var(--color-brand-600)] px-1.5 text-white">{count}</span>
      </span>

      {/* Segmented mode control — both modes shown, the active one highlighted,
          so the user always knows whether a tap drops a pin or navigates (audit C4). */}
      <div className="flex shrink-0 items-center rounded-lg bg-zinc-100 p-0.5 text-xs font-bold">
        <button
          type="button"
          onClick={() => {
            if (!placing) onTogglePlacing();
          }}
          aria-pressed={placing}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 transition-colors",
            placing
              ? "bg-[var(--color-brand-600)] text-white shadow-sm"
              : "text-zinc-500",
          )}
        >
          <Crosshair className="size-3.5" /> ปักหมุด
        </button>
        <button
          type="button"
          onClick={() => {
            if (placing) onTogglePlacing();
          }}
          aria-pressed={!placing}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 transition-colors",
            !placing ? "bg-zinc-700 text-white shadow-sm" : "text-zinc-500",
          )}
        >
          <Hand className="size-3.5" /> เลื่อนดู
        </button>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onViewAll}
          className="flex items-center gap-1 rounded-lg bg-zinc-100 px-2 py-1.5 text-xs font-semibold text-zinc-700"
        >
          <ListChecks className="size-3.5" /> ทั้งหมด
        </button>
        <button
          type="button"
          onClick={onPause}
          className="flex items-center gap-1 rounded-lg bg-zinc-100 px-2 py-1.5 text-xs font-semibold text-zinc-700"
        >
          <Pause className="size-3.5" /> พัก
        </button>
        <button
          type="button"
          disabled={busy || count === 0}
          onClick={onFinish}
          className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          เสร็จ
        </button>
      </div>
    </div>
  );
}
