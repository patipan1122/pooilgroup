// Wave-2 (CEO 2026-06-01) · this legacy entry redirected to the unified
// multi-file uploader at /chairops/pos-ingest. Kept as a redirect so old
// bookmarks / browser history don't 404.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function LegacyPosIngestNewRedirect(): never {
  redirect("/chairops/pos-ingest");
}
