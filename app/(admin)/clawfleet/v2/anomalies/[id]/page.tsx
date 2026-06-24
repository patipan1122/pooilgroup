/**
 * ClawFleet v2 — Anomaly detail page (server · drill-in จาก Anomaly inbox).
 *
 * รับ id (= sessionCode) → โหลด anomaly เดียวจาก real DB → ส่งให้ AnomalyDetailClient
 * (เปิด AnomalyReview overlay). ไม่เจอ → notFound.
 */

import { notFound } from "next/navigation";
import { loadAnomaly } from "@/lib/clawfleet/v2-loaders";
import { AnomalyDetailClient } from "./anomaly-detail-client";

export const dynamic = "force-dynamic";

export default async function AnomalyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const anomaly = await loadAnomaly(decodeURIComponent(id));
  if (!anomaly) notFound();
  return <AnomalyDetailClient anomaly={anomaly} />;
}
