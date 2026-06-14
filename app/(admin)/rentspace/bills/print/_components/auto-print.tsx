"use client";

import { useEffect, useRef } from "react";

/** Auto-opens the browser print dialog once the batch page has mounted. */
export function AutoPrint({ count }: { count: number }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current || count === 0) return;
    fired.current = true;
    // small delay so fonts/layout settle before the print snapshot
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [count]);
  return null;
}
