"use client";

import { useRef, useState, useTransition, useEffect } from "react";
import { toast } from "sonner";
import { PenLine, X } from "lucide-react";
import { actSignContract } from "../_sign-action";

export function SignPad({ token, defaultName }: { token: string; defaultName?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const [name, setName] = useState(defaultName ?? "");
  const [pending, start] = useTransition();

  // size the canvas to its container (handles retina)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(ratio, ratio);
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#0f172a";
      }
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    hasInk.current = true;
  }
  function up() {
    drawing.current = false;
  }
  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasInk.current = false;
  }

  function submit() {
    if (!name.trim()) return toast.error("กรุณากรอกชื่อผู้เซ็น");
    if (!hasInk.current) return toast.error("กรุณาเซ็นลายเซ็นในกรอบ");
    const dataUrl = canvasRef.current?.toDataURL("image/png");
    if (!dataUrl) return toast.error("ไม่สามารถบันทึกลายเซ็นได้");
    start(async () => {
      try {
        await actSignContract({ token, signerName: name.trim(), signatureDataUrl: dataUrl });
        toast.success("เซ็นสัญญาเรียบร้อย ขอบคุณครับ");
        setTimeout(() => window.location.reload(), 600);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "เซ็นไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
          ชื่อ-นามสกุล ผู้เซ็น
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="กรอกชื่อ-นามสกุลของท่าน"
          className="w-full h-12 px-3 rounded-xl text-[15px]"
          style={{ border: "1px solid var(--rs-border)", background: "var(--rs-bg-2)", color: "var(--rs-text)" }}
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[13px] font-semibold" style={{ color: "var(--rs-text)" }}>
            ลายเซ็น
          </label>
          <button onClick={clear} className="inline-flex items-center gap-1 text-[12.5px] font-medium" style={{ color: "var(--rs-text-2)" }}>
            <X className="h-3.5 w-3.5" /> ล้าง
          </button>
        </div>
        <canvas
          ref={canvasRef}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={up}
          className="w-full rounded-xl touch-none"
          style={{ height: 200, border: "1.5px dashed var(--rs-border)", background: "#fff" }}
        />
        <p className="text-[12px] mt-1 text-center" style={{ color: "var(--rs-text-3)" }}>
          เซ็นด้วยนิ้วหรือปากกาในกรอบด้านบน
        </p>
      </div>

      <button
        onClick={submit}
        disabled={pending}
        className="rs-btn w-full h-13"
        style={{ height: 52, fontSize: 16 }}
      >
        <PenLine className="h-5 w-5" /> {pending ? "กำลังบันทึก…" : "ยอมรับและเซ็นสัญญา"}
      </button>
      <p className="text-[11.5px] text-center" style={{ color: "var(--rs-text-3)" }}>
        การกดยอมรับถือว่าท่านได้อ่านและตกลงตามเงื่อนไขสัญญาข้างต้นทุกประการ
      </p>
    </div>
  );
}
