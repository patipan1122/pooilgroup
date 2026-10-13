"use client";

// PrintButton — plain `window.print()` trigger (CEO Pinpoint #14, 2026-10-13).
// ────────────────────────────────────────────────────────────────────
// Document detail page had zero print functionality anywhere in DocuFlow
// (`grep -rn "window.print"` → no hits before this). A server component
// can't carry an onClick, so this is the one tiny client wrapper around
// it. Printing is scoped to just the document preview via `.df-print-area`
// (docuflow.css's `@media print` rule, applied to ViewerTabs' Preview tab
// panel) — the surrounding page chrome (this button included) never
// shows up in the printout.
// ────────────────────────────────────────────────────────────────────

import { Printer } from "lucide-react";
import { DfButton } from "./df-ui";

export function PrintButton({
  label = "พิมพ์",
  style,
}: {
  label?: string;
  style?: React.CSSProperties;
}) {
  return (
    <DfButton
      variant="ghost"
      onClick={() => window.print()}
      title="พิมพ์เอกสารนี้"
      style={style}
    >
      <Printer size={14} />
      {label}
    </DfButton>
  );
}
