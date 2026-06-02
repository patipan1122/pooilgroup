"use client";

// Reconcile v2 · custom date-range inputs (client island).
// Submitting via a regular form would round-trip; this one updates the URL
// in-place when both dates are valid, so the server re-renders with the
// new ?from/?to. Two-input combo so CEO can type 2026-04-01 / 2026-04-15
// without leaving the page.

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LedgerDateFilterCustom({
  baseHref,
  from,
  to,
  max,
}: {
  baseHref: string;
  from: string | null;
  to: string | null;
  /** Latest POS-complete day · used as the max for both inputs. */
  max: string | null;
}) {
  const router = useRouter();
  const [a, setA] = useState(from ?? "");
  const [b, setB] = useState(to ?? "");

  const apply = (nextFrom: string, nextTo: string) => {
    const usp = new URLSearchParams();
    usp.set("view", "ledger");
    if (nextFrom) usp.set("from", nextFrom);
    if (nextTo) usp.set("to", nextTo);
    router.push(`${baseHref}?${usp.toString()}`);
  };

  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
      className="text-3"
    >
      <input
        type="date"
        value={a}
        max={max ?? undefined}
        onChange={(e) => {
          const v = e.target.value;
          setA(v);
          if (v && (b || !b)) apply(v, b);
        }}
        aria-label="วันที่เริ่ม"
        className="input"
        style={{ padding: "3px 6px", fontSize: 12 }}
      />
      <span style={{ fontSize: 11 }}>→</span>
      <input
        type="date"
        value={b}
        min={a || undefined}
        max={max ?? undefined}
        onChange={(e) => {
          const v = e.target.value;
          setB(v);
          if (v && a) apply(a, v);
        }}
        aria-label="วันที่สิ้นสุด"
        className="input"
        style={{ padding: "3px 6px", fontSize: 12 }}
      />
    </span>
  );
}
