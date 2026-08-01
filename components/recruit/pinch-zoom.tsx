"use client";

// ซูมตารางด้วยการถ่างนิ้ว (มือถือ) — เหมือนซูมสเปรดชีต/Excel บนมือถือ
// • สองนิ้วถ่างออก = ขยายทั้งตาราง · หุบเข้า = ย่อ
// • หนึ่งนิ้วปัด = เลื่อนดูส่วนอื่น (native scroll)
// • จอคอม/เมาส์ทำงานปกติ (ไม่มี gesture · ซูมคงที่ตาม prop)
// ใช้ CSS `zoom` เพราะเบราว์เซอร์ reflow ให้เอง → พื้นที่เลื่อน (scroll) ถูกต้อง
// โดยไม่ต้องคำนวณขนาดเองแบบ transform:scale (Ladder: ใช้ของที่มีในตัวเบราว์เซอร์)

import { useEffect, useRef } from "react";

export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 0.2;

export const clampZoom = (v: number) =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(v * 100) / 100));

export function PinchZoom({
  zoom,
  onZoomChange,
  children,
  className = "",
}: {
  zoom: number;
  onZoomChange: (z: number) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // อ่านค่า zoom ล่าสุดใน handler โดยไม่ต้อง rebind listener ทุกครั้ง
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let startDist = 0;
    let startZoom = 1;
    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        startDist = dist(e.touches);
        startZoom = zoomRef.current;
      }
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && startDist > 0) {
        // กันเบราว์เซอร์ซูมทั้งหน้า + กันเลื่อนมั่วระหว่างบีบนิ้ว
        e.preventDefault();
        onZoomChange(clampZoom((startZoom * dist(e.touches)) / startDist));
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) startDist = 0;
    };

    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [onZoomChange]);

  return (
    <div
      ref={scrollRef}
      className={`overflow-x-auto overscroll-x-contain ${className}`}
      // pan-x pan-y = ปล่อยให้เลื่อนนิ้วเดียวได้ · แต่ปิด pinch-zoom ของเบราว์เซอร์
      // (เราจัดการ pinch เองด้วย handler ด้านบน → ซูมเฉพาะตาราง ไม่ใช่ทั้งหน้า)
      style={{ touchAction: "pan-x pan-y" }}
    >
      <div style={{ zoom } as React.CSSProperties}>{children}</div>
    </div>
  );
}
