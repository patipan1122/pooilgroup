/**
 * ClawFleet v2 — staff collection flow (the REAL working tool, mobile-first).
 * 5-step branch design: เลือกสาขา → นับตุ๊กตา → มิเตอร์+เงิน → เติม → ปิดรอบ.
 * Manual meter entry (no OCR). 5 photos/machine. 2-way cross-check at close.
 */

import { getCollectData } from "@/lib/clawfleet/v2-collect-data";
import { CollectClient } from "./collect-client";

export const dynamic = "force-dynamic";

export default async function CollectPage() {
  const data = await getCollectData();
  return (
    <CollectClient
      orgId={data.orgId}
      branches={data.branches}
      skus={data.skus}
    />
  );
}
