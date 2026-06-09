// "⋯ เครื่องมือ" overflow for the รายจ่าย header (desktop only).
//
// LeanUX wave B2 (①#1): the desktop header crammed 5 controls (search · สลิปรอจับคู่
// · ส่งออก CSV · ไม่มีใบเสร็จ · อัปโหลด). The two primaries (ค้นหา + อัปโหลด) stay
// visible; the secondary tools fold into this dropdown so the header is a thin band.
// Mobile already hides these into the ตัวกรอง sheet (hidden lg:* upstream), so this
// menu is lg-only and never doubles up.
"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";

export function HeaderToolsMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative hidden lg:inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
      >
        <MoreHorizontal className="size-4" aria-hidden />
        เครื่องมือ
      </button>

      {open && (
        <>
          {/* click-away */}
          <button
            type="button"
            aria-label="ปิดเมนูเครื่องมือ"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default"
          />
          {/* tapping any tool closes the menu (its own dialog/route takes over) */}
          <div
            role="menu"
            onClick={() => setOpen(false)}
            className="absolute right-0 top-full z-40 mt-1 flex w-52 flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg [&_a]:w-full [&_button]:w-full [&_a]:justify-start [&_button]:justify-start"
          >
            {children}
          </div>
        </>
      )}
    </span>
  );
}
