// Wave-2 (CEO 2026-06-01) · cash+coin upload merged into the unified
// multi-file uploader at /chairops/pos-ingest. This route stays as a redirect
// so bookmarks / Rich Menu links don't break.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function LegacyPosIngestUploadRedirect(): never {
  redirect("/chairops/pos-ingest");
}
