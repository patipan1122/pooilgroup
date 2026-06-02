/**
 * ClawFleet v2 — staff collection flow (the REAL working tool, mobile-first).
 * GROUP-scoped (anti-fraud core · 2026-05-31): เลือกสาขา → เลือกกลุ่ม →
 * เก็บตู้แลก (ถ้า TOKEN) + ตู้คีบทุกตู้ → ปิดกลุ่ม → ตรวจ 3 ทาง (token/เงิน/ตุ๊กตา).
 * Manual meter entry (no OCR). Token cross-check runs in the Postgres trigger
 * via session.groupId. (The old flat-branch loader was deleted 2026-06-01.)
 */

import { getGroupCollectData } from "@/lib/clawfleet/v2-group-data";
import { CollectGroupClient } from "./collect-group-client";

export const dynamic = "force-dynamic";

export default async function CollectPage() {
  const data = await getGroupCollectData();
  return <CollectGroupClient orgId={data.orgId} branches={data.branches} skus={data.skus} />;
}
