// Pinpoint — วาดสด "บนหน้าเว็บจริง" (live in-page annotate overlay).
//
// เปิดจาก PinPopover เมื่อผู้ใช้กด "วาด": วางแผ่นใสทับหน้าเว็บจริงตรงนั้นเลย (ไม่ถ่าย
// เป็นรูปนิ่งก่อน) → เห็นเนื้อหาจริงคมชัดข้างล่าง → ขีด/วง/ลูกศร/พิมพ์ทับได้เหมือน
// ขีดบนกระจก. มี 2 โหมดสลับกัน:
//   • วาด    — แผ่นใสดูดการแตะ วาดได้ (ล็อกไม่ให้เลื่อนหน้า กันรอยเพี้ยน)
//   • แตะหน้าเว็บ — แผ่นใสปล่อยคลิกทะลุไปหน้าจริง กดปุ่มในแอปได้ (โชว์ทั้งหมด/ซ่อน ฯลฯ)
// กด "เสร็จ" → ถ่ายภาพหน้าจอจริง ณ ตอนนั้น (chrome ของ pinpoint ถูกซ่อน+ตัดออกแล้ว) →
// อบรอยวาดลงบนภาพจริง (natural size) → คืน webp คม ๆ ให้ผู้เรียกอัปโหลด.
//
// หลักการเดียวกับเดิม: best-effort + ฝั่ง client ล้วน + ไม่ลง dependency ใหม่
// (HTML5 canvas + snapdom ที่มีอยู่). แคปด้วย captureBody() ตัวเดิม → ได้ภาพกรอบจอ.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Pen, ArrowUpRight, Circle, Type, Undo2, Eraser, X, Check, Loader2, Hand } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { captureBody, type ViewportCrop } from "@/lib/pinpoint/capture";

type Tool = "pen" | "arrow" | "circle" | "text";
type Mode = "draw" | "interact";
type Pt = { x: number; y: number };

type Stroke =
  | { tool: "pen"; color: string; width: number; points: Pt[] }
  | { tool: "arrow"; color: string; width: number; from: Pt; to: Pt }
  | { tool: "circle"; color: string; width: number; from: Pt; to: Pt }
  | { tool: "text"; color: string; x: number; y: number; text: string; size: number };

const COLORS = ["#ef4444", "#f59e0b", "#2563eb", "#16a34a"]; // แดง(ค่าเริ่มต้น)/ส้ม/น้ำเงิน/เขียว
const PEN_WIDTH = 4; // display px (export คูณ scale ให้คมตามภาพจริง)
const TEXT_SIZE = 18; // display px · ตัวหนังสือบนภาพ (export คูณ scale ให้คมตามภาพจริง)

/** สี่เหลี่ยมมุมมน — สร้าง path ไว้ให้ fill/stroke ต่อ (ไม่พึ่ง ctx.roundRect เพื่อความเข้ากันได้). */
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/** วาดรอยหนึ่งเส้นลงบน context · k = ตัวคูณพิกัด/ความหนา (display=1, export=natural/CSS). */
function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, k: number) {
  // ── ข้อความ: กล่องพื้นขาว + ขอบสี + ตัวหนังสือสี (อบลงในภาพจริง) ──
  if (s.tool === "text") {
    const fs = Math.max(10, s.size * k);
    ctx.font = `700 ${fs}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Thai", sans-serif`;
    ctx.textBaseline = "top";
    const lines = s.text.split("\n");
    const pad = Math.round(fs * 0.35);
    const lineH = fs * 1.28;
    let maxW = 0;
    for (const ln of lines) maxW = Math.max(maxW, ctx.measureText(ln).width);
    const boxW = maxW + pad * 2;
    const boxH = lineH * lines.length + pad * 2;
    const bx = s.x * k;
    const by = s.y * k;
    roundRectPath(ctx, bx, by, boxW, boxH, Math.max(4, fs * 0.28));
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fill();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = Math.max(1.5, 1.5 * k);
    ctx.stroke();
    ctx.fillStyle = s.color;
    lines.forEach((ln, i) => ctx.fillText(ln, bx + pad, by + pad + i * lineH));
    return;
  }
  ctx.strokeStyle = s.color;
  ctx.lineWidth = Math.max(1, s.width * k);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (s.tool === "pen") {
    if (s.points.length === 0) return;
    ctx.beginPath();
    s.points.forEach((p, i) =>
      i === 0 ? ctx.moveTo(p.x * k, p.y * k) : ctx.lineTo(p.x * k, p.y * k),
    );
    ctx.stroke();
  } else if (s.tool === "arrow") {
    const fx = s.from.x * k, fy = s.from.y * k, tx = s.to.x * k, ty = s.to.y * k;
    const ang = Math.atan2(ty - fy, tx - fx);
    const head = Math.max(12, s.width * k * 3.5);
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(tx, ty);
    ctx.lineTo(tx - head * Math.cos(ang - 0.4), ty - head * Math.sin(ang - 0.4));
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - head * Math.cos(ang + 0.4), ty - head * Math.sin(ang + 0.4));
    ctx.stroke();
  } else {
    const fx = s.from.x * k, fy = s.from.y * k, tx = s.to.x * k, ty = s.to.y * k;
    ctx.beginPath();
    ctx.ellipse(
      (fx + tx) / 2,
      (fy + ty) / 2,
      Math.abs(tx - fx) / 2,
      Math.abs(ty - fy) / 2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });
}

/** วาดสดบนหน้าเว็บจริง แล้วแคปเป็นภาพตอนกด "เสร็จ".
 *  `crop` = กรอบจอ ณ จุดที่ปักหมุด (เลื่อนหน้าถูกล็อกไว้ตรงนี้ตลอด กันรอยเพี้ยน). */
export function PinpointLiveAnnotate({
  crop,
  onCancel,
  onDone,
  freeform = false,
}: {
  /** กรอบจอ ณ จุดปักหมุด — ต้องมีในโหมดปกติ (แคปภาพ). โหมด freeform (อัดวิดีโอ) ไม่ต้องมี. */
  crop?: ViewportCrop;
  onCancel: () => void;
  onDone: (annotated: Blob) => void;
  /** โหมดวาดสดระหว่างอัดวิดีโอ — เลื่อนหน้าได้อิสระ (ไม่ล็อก scroll) + ไม่แคปภาพตอนปิด
   *  (วิดีโอเก็บรอยวาดให้เองจาก getDisplayMedia). ปุ่มหลักกลายเป็น "ปิด". */
  freeform?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const curRef = useRef<Stroke | null>(null);
  const drawingRef = useRef(false);

  // ขนาดจอ (CSS) + ความละเอียดจริง (DPR) — canvas ทำ backing store คูณ DPR ให้รอยคมบน Retina
  const [view, setView] = useState<{ vw: number; vh: number; dpr: number } | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [tool, setTool] = useState<Tool>("pen");
  const [mode, setMode] = useState<Mode>("draw");
  const [color, setColor] = useState<string>(COLORS[0]);
  const [capturing, setCapturing] = useState(false); // กำลังแคปหน้าจอตอนกดเสร็จ
  // ── กล่องพิมพ์ข้อความที่กำลังแก้ (HTML overlay ทับ · วางเสร็จค่อยอบลงภาพ) ──
  const [editing, setEditing] = useState<Pt | null>(null);
  const [editValue, setEditValue] = useState("");

  // ขนาดจอ + DPR (อัปเดตตอน resize เผื่อหมุนจอ/ย่อหน้าต่าง)
  useEffect(() => {
    const measure = () =>
      setView({
        vw: window.innerWidth,
        vh: window.innerHeight,
        dpr: Math.min(Math.max(window.devicePixelRatio || 1, 1), 3),
      });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // ล็อกเลื่อนหน้าไว้ที่กรอบจอตอนปักหมุด — กันรอยวาดเพี้ยนจากของที่ชี้ (โหมดแตะก็ล็อก
  // เพราะปุ่มโชว์/ซ่อนไม่ต้องเลื่อน). snap กลับทุกครั้งที่มีอะไรพยายามเลื่อน.
  useEffect(() => {
    if (freeform || !crop) return; // โหมดอัดวิดีโอ = เลื่อนหน้าได้อิสระ (ไม่ snap กลับ)
    window.scrollTo(crop.scrollX, crop.scrollY);
    const onScroll = () => {
      if (window.scrollX !== crop.scrollX || window.scrollY !== crop.scrollY) {
        window.scrollTo(crop.scrollX, crop.scrollY);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [crop, freeform]);

  // ซ่อน chrome ของ pinpoint (หมุด/กล่อง/แถบล่าง) ระหว่างวาดสด — ให้เห็นหน้าเว็บสะอาด
  // และกันคลิกโดนของพวกนี้ตอนโหมดแตะ. แผ่นวาดของเราติด data-pinpoint-annotate จึงไม่โดนซ่อน.
  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-pinpoint-annotate-style", "");
    style.textContent =
      "[data-pinpoint-ui]:not([data-pinpoint-annotate]){visibility:hidden !important;}";
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, []);

  // วาดรอยทั้งหมดลงบนแผ่นใส (โปร่งใส — เห็นหน้าเว็บจริงข้างล่าง). คูณ DPR ให้รอยคม.
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.vw, view.vh);
    for (const s of strokes) drawStroke(ctx, s, 1);
    if (curRef.current) drawStroke(ctx, curRef.current, 1);
  }, [view, strokes]);

  useEffect(() => {
    paint();
  }, [paint]);

  const relPoint = (e: React.PointerEvent): Pt => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (capturing || mode !== "draw") return;
    // เครื่องมือข้อความ: แตะ = วางกล่องพิมพ์ตรงจุดนั้น (ไม่ใช่ลากวาด).
    if (tool === "text") {
      if (editing) return; // มีกล่องเปิดอยู่ → แตะที่อื่นจะ blur/วางให้ก่อน
      e.preventDefault();
      const p = relPoint(e);
      setEditing(p);
      setEditValue("");
      return;
    }
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drawingRef.current = true;
    const p = relPoint(e);
    curRef.current =
      tool === "pen"
        ? { tool: "pen", color, width: PEN_WIDTH, points: [p] }
        : { tool, color, width: PEN_WIDTH, from: p, to: p };
    paint();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current || !curRef.current) return;
    e.preventDefault();
    const p = relPoint(e);
    const cur = curRef.current;
    if (cur.tool === "pen") cur.points.push(p);
    else if (cur.tool === "arrow" || cur.tool === "circle") cur.to = p;
    paint();
  };

  const commit = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const cur = curRef.current;
    curRef.current = null;
    if (!cur) return;
    // ทิ้งรอยจิ๋ว (แตะค้างไม่ลาก) ของ arrow/circle
    if (cur.tool === "arrow" || cur.tool === "circle") {
      const dx = cur.to.x - cur.from.x;
      const dy = cur.to.y - cur.from.y;
      if (Math.hypot(dx, dy) < 6) {
        paint();
        return;
      }
    }
    setStrokes((prev) => [...prev, cur]);
  };

  const undo = () => setStrokes((prev) => prev.slice(0, -1));
  const clearAll = () => {
    setStrokes([]);
    setEditing(null);
    setEditValue("");
  };

  // วางกล่องข้อความที่พิมพ์ลงเป็นรอยถาวร (ว่าง = ทิ้ง).
  const commitText = () => {
    const pos = editing;
    const val = editValue.trim();
    setEditing(null);
    setEditValue("");
    if (!pos || !val) return;
    setStrokes((prev) => [
      ...prev,
      { tool: "text", color, x: pos.x, y: pos.y, text: val, size: TEXT_SIZE },
    ]);
  };

  // เลือกเครื่องมือ/สี = ตั้งใจจะวาด → สลับกลับโหมดวาดอัตโนมัติ
  const pickTool = (t: Tool) => {
    setTool(t);
    setMode("draw");
  };
  const pickColor = (c: string) => {
    setColor(c);
    setMode("draw");
  };

  // กด "เสร็จ" → แคปหน้าเว็บจริง ณ กรอบจอที่ปัก + อบรอยวาดลงบนภาพจริง (natural size) → webp.
  const handleDone = async () => {
    if (capturing || !view) return;
    if (freeform || !crop) { onCancel(); return; } // โหมดอัด = ไม่แคปภาพ แค่ปิดแผ่นวาด
    // เผื่อยังพิมพ์ข้อความค้าง (ยังไม่ Enter) → รวมลงภาพด้วย ไม่ให้ตกหล่น.
    const pending: Stroke | null =
      editing && editValue.trim()
        ? { tool: "text", color, x: editing.x, y: editing.y, text: editValue.trim(), size: TEXT_SIZE }
        : null;
    const allStrokes = pending ? [...strokes, pending] : strokes;
    setEditing(null);
    setEditValue("");
    setCapturing(true);
    try {
      const base = await captureBody({
        scrollX: crop.scrollX,
        scrollY: crop.scrollY,
        width: window.innerWidth,
        height: window.innerHeight,
      });
      if (!base) {
        toast.error("บันทึกภาพหน้าจอไม่สำเร็จ ลองใหม่อีกครั้ง");
        onCancel();
        return;
      }
      const url = URL.createObjectURL(base);
      try {
        const img = await loadImage(url);
        const natW = img.naturalWidth || img.width;
        const natH = img.naturalHeight || img.height;
        const off = document.createElement("canvas");
        off.width = natW;
        off.height = natH;
        const ctx = off.getContext("2d");
        if (!ctx) {
          onCancel();
          return;
        }
        ctx.drawImage(img, 0, 0, natW, natH);
        // รอยวาดเก็บเป็นพิกัด CSS ของกรอบจอ → คูณให้เท่าความละเอียดภาพจริง
        const k = natW / window.innerWidth;
        for (const s of allStrokes) drawStroke(ctx, s, k);
        const blob = await new Promise<Blob | null>((res) =>
          off.toBlob((b) => res(b), "image/webp", 0.92),
        );
        if (blob) onDone(blob);
        else onCancel();
      } finally {
        URL.revokeObjectURL(url);
      }
    } finally {
      setCapturing(false);
    }
  };

  const tools: { id: Tool; icon: typeof Pen; label: string }[] = [
    { id: "pen", icon: Pen, label: "ปากกา" },
    { id: "arrow", icon: ArrowUpRight, label: "ลูกศร" },
    { id: "circle", icon: Circle, label: "วงกลม" },
    { id: "text", icon: Type, label: "ข้อความ" },
  ];

  const overlay = (
    <div
      data-pinpoint-ui
      data-pinpoint-annotate
      className="fixed inset-0 z-[9996]"
      style={{ pointerEvents: "none" }}
    >
      {/* แผ่นใสวาด — โปร่งใส เห็นหน้าเว็บจริงข้างล่าง. โหมดแตะ = ปล่อยคลิกทะลุไปหน้าจริง */}
      {view && (
        <canvas
          ref={canvasRef}
          width={Math.round(view.vw * view.dpr)}
          height={Math.round(view.vh * view.dpr)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={commit}
          onPointerLeave={commit}
          onPointerCancel={commit}
          className="absolute inset-0"
          style={{
            width: view.vw,
            height: view.vh,
            pointerEvents: mode === "draw" && !capturing ? "auto" : "none",
            touchAction: mode === "draw" ? "none" : "auto",
            cursor: tool === "text" ? "text" : "crosshair",
          }}
        />
      )}

      {/* กล่องพิมพ์ข้อความ — โผล่ตรงจุดที่แตะ (พิกัดกรอบจอ) */}
      {editing && view && (
        <textarea
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commitText();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(null);
              setEditValue("");
            }
          }}
          placeholder="พิมพ์… Enter=วาง"
          rows={1}
          className="absolute z-10 resize-none rounded-md border-2 bg-white/95 px-1.5 py-0.5 font-bold shadow-lg outline-none"
          style={{
            left: editing.x,
            top: editing.y,
            color,
            borderColor: color,
            fontSize: TEXT_SIZE,
            lineHeight: 1.28,
            minWidth: 90,
            maxWidth: Math.max(120, view.vw - editing.x - 6),
            pointerEvents: "auto",
          }}
        />
      )}

      {/* แถบเครื่องมือบน — คลิกได้เสมอ */}
      <div
        className="absolute inset-x-0 top-0 flex flex-wrap items-center gap-2 border-b border-white/10 bg-zinc-900/95 px-3 py-2 text-white shadow-lg"
        style={{ pointerEvents: "auto" }}
      >
        {/* สลับโหมด วาด ⇄ แตะหน้าเว็บ */}
        <div className="flex items-center rounded-lg bg-white/10 p-0.5">
          <button
            type="button"
            onClick={() => setMode("draw")}
            aria-pressed={mode === "draw"}
            className={cn(
              "flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-bold transition-colors",
              mode === "draw" ? "bg-white text-zinc-900" : "text-white/80 hover:bg-white/10",
            )}
          >
            <Pen className="size-3.5" /> วาด
          </button>
          <button
            type="button"
            onClick={() => setMode("interact")}
            aria-pressed={mode === "interact"}
            className={cn(
              "flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-bold transition-colors",
              mode === "interact" ? "bg-white text-zinc-900" : "text-white/80 hover:bg-white/10",
            )}
          >
            <Hand className="size-3.5" /> แตะหน้าเว็บ
          </button>
        </div>

        {/* เครื่องมือวาด — จางลงตอนโหมดแตะ */}
        <div className={cn("flex items-center rounded-lg bg-white/10 p-0.5 transition-opacity", mode === "interact" && "opacity-50")}>
          {tools.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => pickTool(t.id)}
              aria-pressed={tool === t.id && mode === "draw"}
              aria-label={t.label}
              title={t.label}
              className={cn(
                "flex size-9 items-center justify-center rounded-md transition-colors",
                tool === t.id && mode === "draw" ? "bg-white text-zinc-900" : "text-white/80 hover:bg-white/10",
              )}
            >
              <t.icon className="size-4" />
            </button>
          ))}
        </div>

        <div className={cn("flex items-center gap-1.5 transition-opacity", mode === "interact" && "opacity-50")}>
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => pickColor(c)}
              aria-label={`สี ${c}`}
              className={cn(
                "size-7 rounded-full border-2 transition-transform",
                color === c ? "scale-110 border-white" : "border-white/30",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={undo}
            disabled={strokes.length === 0}
            aria-label="ย้อนกลับ"
            title="ย้อนกลับ"
            className="flex size-9 items-center justify-center rounded-md bg-white/10 text-white/90 hover:bg-white/20 disabled:opacity-40"
          >
            <Undo2 className="size-4" />
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={strokes.length === 0}
            aria-label="ล้างทั้งหมด"
            title="ล้างทั้งหมด"
            className="flex size-9 items-center justify-center rounded-md bg-white/10 text-white/90 hover:bg-white/20 disabled:opacity-40"
          >
            <Eraser className="size-4" />
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={capturing}
            className={cn(
              "flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50",
              freeform
                ? "bg-emerald-500 font-bold hover:bg-emerald-600"
                : "bg-white/10 hover:bg-white/20",
            )}
          >
            {freeform ? <Check className="size-4" /> : <X className="size-4" />}
            {freeform ? "ปิด" : "ยกเลิก"}
          </button>
          {!freeform && (
            <button
              type="button"
              onClick={handleDone}
              disabled={capturing}
              className="flex items-center gap-1 rounded-lg bg-emerald-500 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              {capturing ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              เสร็จ
            </button>
          )}
        </div>
      </div>

      {/* คำใบ้ล่าง — เปลี่ยนตามโหมด */}
      <p
        className="absolute inset-x-0 bottom-0 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 text-center text-xs font-medium text-white"
        style={{ pointerEvents: "none", textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}
      >
        {capturing
          ? "กำลังบันทึกภาพหน้าจอ…"
          : freeform
            ? mode === "draw"
              ? "🔴 กำลังอัดวิดีโอ — ลากเพื่อวง/ชี้ · เลือก “ข้อความ” แล้วแตะเพื่อพิมพ์ · “ล้าง” เพื่อลบรอย · “ปิด” เพื่อเลิกวาด"
              : "🔴 กำลังอัดวิดีโอ — โหมดแตะ: เลื่อน/กดปุ่มในเว็บได้ · กด “วาด” เพื่อกลับมาวาด"
            : mode === "draw"
              ? "ลากเพื่อวง/ชี้ · เลือก “ข้อความ” แล้วแตะเพื่อพิมพ์ · กด “เสร็จ” เพื่อแคปหน้าจอ"
              : "โหมดแตะ: กดปุ่มในเว็บได้เลย (โชว์/ซ่อน ฯลฯ) · กด “วาด” เพื่อกลับมาวาด"}
      </p>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(overlay, document.body);
}
