// Pinpoint — ปากกาวาดภาพบนภาพหน้าจอ (draw-on-screenshot overlay).
//
// เปิดจาก PinPopover เมื่อผู้ใช้กด "วาด": รับ Blob ภาพหน้าจอ (จาก captureBody),
// ให้วาดทับ (ปากกา/ลูกศร/วงกลม + เลือกสี + ย้อน/ล้าง) แล้วรวมรอยวาดลงบนภาพ →
// คืน Blob ใหม่ (webp) ให้ผู้เรียกอัปโหลดเป็น screenshot ของหมุดนั้น.
//
// หลักการเดียวกับ capture.ts: best-effort + ฝั่ง client ล้วน + ไม่ลง dependency ใหม่
// (HTML5 canvas มาตรฐาน). ภาพต้นทางเป็น blob: URL = same-origin → ไม่ taint canvas.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pen, ArrowUpRight, Circle, Type, Undo2, Eraser, X, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type Tool = "pen" | "arrow" | "circle" | "text";
type Pt = { x: number; y: number };

type Stroke =
  | { tool: "pen"; color: string; width: number; points: Pt[] }
  | { tool: "arrow"; color: string; width: number; from: Pt; to: Pt }
  | { tool: "circle"; color: string; width: number; from: Pt; to: Pt }
  | { tool: "text"; color: string; x: number; y: number; text: string; size: number };

const COLORS = ["#ef4444", "#f59e0b", "#2563eb", "#16a34a"]; // แดง(ค่าเริ่มต้น)/ส้ม/น้ำเงิน/เขียว
const PEN_WIDTH = 4; // display px (export จะคูณ scale ให้คมตามภาพจริง)
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

/** วาดรอยหนึ่งเส้นลงบน context · k = ตัวคูณพิกัด/ความหนา (display=1, export=natural/display). */
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

export function PinpointDrawCanvas({
  imageBlob,
  onCancel,
  onDone,
}: {
  imageBlob: Blob;
  onCancel: () => void;
  onDone: (annotated: Blob) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const curRef = useRef<Stroke | null>(null);
  const drawingRef = useRef(false);

  const [dims, setDims] = useState<{
    dispW: number;
    dispH: number;
    natW: number;
    natH: number;
  } | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<string>(COLORS[0]);
  const [exporting, setExporting] = useState(false);
  // ── กล่องพิมพ์ข้อความที่กำลังแก้ (HTML overlay ทับ canvas · วางเสร็จค่อยอบลงภาพ) ──
  const [editing, setEditing] = useState<Pt | null>(null);
  const [editValue, setEditValue] = useState("");

  // โหลดภาพ + คำนวณขนาดที่จะแสดง (fit ในจอ เหลือที่ให้แถบเครื่องมือ).
  useEffect(() => {
    const url = URL.createObjectURL(imageBlob);
    const image = new Image();
    image.onload = () => {
      imgRef.current = image;
      const natW = image.naturalWidth || image.width;
      const natH = image.naturalHeight || image.height;
      const availW = Math.max(240, window.innerWidth - 24);
      const availH = Math.max(240, window.innerHeight - 132);
      const k = Math.min(availW / natW, availH / natH, 1);
      setDims({
        dispW: Math.round(natW * k),
        dispH: Math.round(natH * k),
        natW,
        natH,
      });
    };
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [imageBlob]);

  // วาดภาพพื้น + รอยทั้งหมด + รอยที่กำลังวาด ลงบน display canvas.
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !dims) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, dims.dispW, dims.dispH);
    ctx.drawImage(img, 0, 0, dims.dispW, dims.dispH);
    for (const s of strokes) drawStroke(ctx, s, 1);
    if (curRef.current) drawStroke(ctx, curRef.current, 1);
  }, [dims, strokes]);

  useEffect(() => {
    paint();
  }, [paint]);

  const relPoint = (e: React.PointerEvent): Pt => {
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (exporting) return;
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
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
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

  // รวมรอยวาดลงบนภาพจริง (natural size) → webp blob.
  const handleDone = async () => {
    const img = imgRef.current;
    if (!img || !dims || exporting) return;
    // เผื่อยังพิมพ์ข้อความค้างอยู่ (ยังไม่กด Enter) → รวมลงภาพด้วย ไม่ให้ตกหล่น.
    const pending: Stroke | null =
      editing && editValue.trim()
        ? { tool: "text", color, x: editing.x, y: editing.y, text: editValue.trim(), size: TEXT_SIZE }
        : null;
    const allStrokes = pending ? [...strokes, pending] : strokes;
    setEditing(null);
    setEditValue("");
    setExporting(true);
    try {
      const off = document.createElement("canvas");
      off.width = dims.natW;
      off.height = dims.natH;
      const ctx = off.getContext("2d");
      if (!ctx) {
        onCancel();
        return;
      }
      ctx.drawImage(img, 0, 0, dims.natW, dims.natH);
      const k = dims.natW / dims.dispW;
      for (const s of allStrokes) drawStroke(ctx, s, k);
      const blob = await new Promise<Blob | null>((res) =>
        off.toBlob((b) => res(b), "image/webp", 0.85),
      );
      if (blob) onDone(blob);
      else onCancel();
    } finally {
      setExporting(false);
    }
  };

  const tools: { id: Tool; icon: typeof Pen; label: string }[] = [
    { id: "pen", icon: Pen, label: "ปากกา" },
    { id: "arrow", icon: ArrowUpRight, label: "ลูกศร" },
    { id: "circle", icon: Circle, label: "วงกลม" },
    { id: "text", icon: Type, label: "ข้อความ" },
  ];

  return (
    <div
      data-pinpoint-ui
      className="fixed inset-0 z-[9996] flex flex-col bg-black/80 backdrop-blur-sm"
    >
      {/* แถบเครื่องมือบน */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-zinc-900/95 px-3 py-2 text-white">
        <div className="flex items-center rounded-lg bg-white/10 p-0.5">
          {tools.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTool(t.id)}
              aria-pressed={tool === t.id}
              aria-label={t.label}
              title={t.label}
              className={cn(
                "flex size-9 items-center justify-center rounded-md transition-colors",
                tool === t.id ? "bg-white text-zinc-900" : "text-white/80 hover:bg-white/10",
              )}
            >
              <t.icon className="size-4" />
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
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
            className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/20"
          >
            <X className="size-4" /> ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleDone}
            disabled={exporting}
            className="flex items-center gap-1 rounded-lg bg-emerald-500 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {exporting ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            เสร็จ
          </button>
        </div>
      </div>

      {/* พื้นที่วาด */}
      <div className="flex flex-1 items-center justify-center overflow-auto p-3">
        {dims ? (
          <div className="relative" style={{ width: dims.dispW, height: dims.dispH }}>
            <canvas
              ref={canvasRef}
              width={dims.dispW}
              height={dims.dispH}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={commit}
              onPointerLeave={commit}
              onPointerCancel={commit}
              className="block touch-none rounded-md shadow-2xl ring-1 ring-white/20"
              style={{
                width: dims.dispW,
                height: dims.dispH,
                cursor: tool === "text" ? "text" : "crosshair",
              }}
            />
            {/* กล่องพิมพ์ข้อความ — โผล่ตรงจุดที่แตะ (เห็นกล่องจริง ๆ ก่อนวางลงภาพ) */}
            {editing && (
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
                  maxWidth: Math.max(120, dims.dispW - editing.x - 6),
                }}
              />
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-white/80">
            <Loader2 className="size-5 animate-spin" /> กำลังเตรียมภาพ…
          </div>
        )}
      </div>

      <p className="pointer-events-none pb-[max(0.5rem,env(safe-area-inset-bottom))] text-center text-xs text-white/60">
        ลากเพื่อวง/ชี้จุด · เลือก “ข้อความ” แล้วแตะบนภาพเพื่อพิมพ์ · กด “เสร็จ” เพื่อแนบ
      </p>
    </div>
  );
}
