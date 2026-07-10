// DC · ใบสั่งซื้อเป็น "รูป PNG" (ส่งลงไลน์) — GET → attachment PNG.
// gate สิทธิ์ + scope orgId ทำใน buildPoDocImage (mirror หน้า /print) → ไม่พบ/ไม่มีสิทธิ์ = 404.
import { notFound } from "next/navigation";
import { buildPoDocImage } from "@/lib/dc/doc-data";
import { renderDocImage } from "@/lib/dc/doc-image";

export const runtime = "nodejs"; // ต้องใช้ fs (โลโก้) + Buffer + font fetch
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await buildPoDocImage(id);
  if (!doc) notFound();
  return renderDocImage(doc);
}
