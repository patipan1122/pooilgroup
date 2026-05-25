"use client";

// Auto-refreshes monitor every 5 seconds + ticks countdowns every 1 sec client-side
// so numbers feel "alive" between server refreshes.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function MonitorTickClient() {
  const router = useRouter();
  useEffect(() => {
    // Server refresh every 5s (re-fetch all data)
    const refresh = setInterval(() => router.refresh(), 5_000);

    // Tick countdown text every 1s for elements with data-expires-at
    const tick = setInterval(() => {
      const els = document.querySelectorAll<HTMLElement>("[data-expires-at]");
      const now = Date.now();
      els.forEach((el) => {
        const iso = el.getAttribute("data-expires-at");
        if (!iso) return;
        const ms = new Date(iso).getTime() - now;
        if (ms <= 0) {
          el.textContent = "หมด";
          el.classList.add("is-danger");
        } else {
          const totalSec = Math.floor(ms / 1000);
          const h = Math.floor(totalSec / 3600);
          const m = Math.floor((totalSec % 3600) / 60);
          const s = totalSec % 60;
          el.textContent = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
          if (totalSec < 600) el.classList.add("is-warn");
          else el.classList.remove("is-warn");
        }
      });
    }, 1_000);
    return () => {
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [router]);
  return null;
}
