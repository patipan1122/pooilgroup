"use client";

import { useEffect, useState } from "react";

// Appears after the user scrolls past the hero. Floats top, full-width on
// mobile + centered max-width on desktop. CTA scrolls back to #rooms which
// triggers the booking flow.
export function StickyBookBar({
  hotelName,
  minPrice,
  brand,
  brandDeep,
}: {
  hotelName: string;
  minPrice: number;
  brand: string;
  brandDeep: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > 380);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      aria-hidden={!visible}
      className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 ${
        visible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0 pointer-events-none"
      }`}
    >
      <div className="bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-5 sm:px-10 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-slate-500 font-medium truncate">{hotelName}</div>
            <div className="text-sm font-semibold text-slate-900 truncate">เริ่ม ฿{minPrice.toLocaleString()}/คืน</div>
          </div>
          <a
            href="#rooms"
            className="inline-flex items-center justify-center h-10 px-5 rounded-xl font-semibold text-white text-sm shadow-md active:scale-95 transition shrink-0"
            style={{ background: `linear-gradient(135deg, ${brand} 0%, ${brandDeep} 100%)` }}
          >
            จองเลย →
          </a>
        </div>
      </div>
    </div>
  );
}
