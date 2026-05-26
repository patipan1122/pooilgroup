"use client";

// Floating button (mobile only · hidden ≥600px) that toggles `.pl-rail-open`
// on the parent `.pl-two-pane` to slide the left rail in/out.
//
// Use case: Members detail page on mobile (rail = member list · main = detail)
//           Settings sub-pages (rail = settings tabs · main = form)
//
// Place the button anywhere inside the .pl-two-pane container.

import { useEffect, useState } from "react";
import { PanelLeft, X } from "lucide-react";

export function MobileRailToggle({ label = "เมนู" }: { label?: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Find the closest .pl-two-pane ancestor and toggle .pl-rail-open
    const btn = document.querySelector<HTMLButtonElement>("[data-mrt-anchor]");
    if (!btn) return;
    const parent = btn.closest(".pl-two-pane");
    if (!parent) return;
    if (open) parent.classList.add("pl-rail-open");
    else parent.classList.remove("pl-rail-open");
  }, [open]);

  // Close when navigating
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("a")) setOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return (
    <>
      <button
        data-mrt-anchor
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="pl-mobile-rail-toggle pl-btn"
        aria-expanded={open}
        aria-label={open ? "ปิดเมนู" : "เปิดเมนู"}
        style={{
          position: "fixed",
          left: 12, bottom: 78,
          zIndex: 55,
          width: 48, height: 48,
          padding: 0, justifyContent: "center",
          borderRadius: 999,
          boxShadow: "var(--pl-shadow-3)",
          background: "var(--pl-paper)",
        }}
      >
        {open ? <X size={18} /> : <PanelLeft size={18} />}
        <span style={{ position: "absolute", left: 56, top: 14, fontSize: 12, fontWeight: 600, color: "var(--pl-text-muted)", whiteSpace: "nowrap", display: open ? "none" : "block" }}>{label}</span>
      </button>
      {open && (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: "64px 0 68px 0",
            background: "rgba(28, 25, 23, 0.4)",
            zIndex: 49,
            backdropFilter: "blur(2px)",
          }}
        />
      )}
    </>
  );
}
