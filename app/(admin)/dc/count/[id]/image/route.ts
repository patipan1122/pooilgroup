// DC · ใบนับสต๊อกเป็น "รูป PNG" (ส่งลงไลน์) — GET → attachment PNG.
import { notFound } from "next/navigation";
import { buildCountDocImage } from "@/lib/dc/doc-data";
import { renderDocImage } from "@/lib/dc/doc-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await buildCountDocImage(id);
  if (!doc) notFound();
  return renderDocImage(doc);
}
