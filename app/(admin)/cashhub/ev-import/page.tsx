import { permanentRedirect } from "next/navigation";

// Permanent redirect — page moved to import hub structure 2026-05-20.
// Keep this stub so any stale bookmarks / cached sidebar items still work.
export default function LegacyEvImportRedirect() {
  permanentRedirect("/cashhub/import/ev-connext");
}
