import { ImportClient } from "./import-client";

export const dynamic = "force-dynamic";

export default async function MenuImportPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>;
}) {
  const sp = await searchParams;
  const brand = sp.brand === "punthai" ? "punthai" : "amazon";
  return <ImportClient brand={brand} />;
}
