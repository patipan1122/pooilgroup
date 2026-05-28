// W3 (claude-design) · Legacy preview path → redirect to new shell.
// Old URL: /chairops/pos-ingest/[id]/preview
// New URL: /chairops/pos-ingest/i/[id]
import { redirect } from "next/navigation";

export default async function LegacyPreviewRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/chairops/pos-ingest/i/${id}`);
}
