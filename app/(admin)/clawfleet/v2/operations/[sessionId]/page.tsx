/**
 * ClawFleet v2 — Session detail page (server component · drill-in จาก Operations).
 *
 * รับ sessionId (= sessionCode) จาก URL → โหลดไส้ในรอบจาก real DB → ส่งให้
 * SessionDetailClient render. ถ้าไม่เจอ (code ผิด / นอก scope สาขา) → notFound.
 */

import { notFound } from "next/navigation";
import { loadSessionDetail } from "@/lib/clawfleet/v2-loaders";
import { SessionDetailClient } from "./session-client";

export const dynamic = "force-dynamic";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const detail = await loadSessionDetail(decodeURIComponent(sessionId));
  if (!detail) notFound();
  return <SessionDetailClient s={detail} />;
}
