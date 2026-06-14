"use client";

import { useState } from "react";
import { SiteMap3D } from "@/components/rentspace/site-map-3d";
import { UnitDrawer } from "@/components/rentspace/unit-drawer";
import type { SlotUnit } from "@/lib/rentspace/site-layout";

export function PlanWithDrawer({ units, view3dEnabled }: { units: SlotUnit[]; view3dEnabled: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <>
      <SiteMap3D units={units} view3dEnabled={view3dEnabled} onSelect={setSelected} />
      <UnitDrawer unitId={selected} onClose={() => setSelected(null)} />
    </>
  );
}
