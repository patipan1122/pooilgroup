// LIFF endpoint root (/liff). The LIFF Endpoint URL is set to .../liff, and
// LINE opens deep-links by loading the endpoint with ?liff.state=<sub-path>
// (e.g. ?liff.state=/chairops?next=/chairops/m/damage). Without this page,
// /liff is a 404 and the whole LIFF init breaks. We restore the intended
// sub-path here, defaulting to the ChairOps maid entry.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LiffRootPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = sp["liff.state"];
  const state = Array.isArray(raw) ? raw[0] : raw;
  // Restore the sub-path LIFF stashed (must be a same-origin relative path).
  if (state && state.startsWith("/") && !state.startsWith("//")) {
    redirect(`/liff${state}`);
  }
  // No state → default to the ChairOps maid entry.
  redirect("/liff/chairops?next=/chairops/m");
}
