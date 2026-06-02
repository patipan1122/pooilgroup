// ClawFleet — LINE Mini App (LIFF) staff entry · /liff/clawfleet
//
// Replaces Excel for field staff: opens inside LINE, LiffBootstrap (app/liff/layout)
// handles LINE auth → session, then renders the SAME group collection flow as the
// web /clawfleet/v2/collect (getGroupCollectData → CollectGroupClient): pick branch
// → pick group → (exchanger step if TOKEN) → claws one by one → close → 3-way
// cross-check. Mobile-first (Tailwind, no cf-scope dependency).
//
// Go-live: set NEXT_PUBLIC_LIFF_ID (LINE channel) for in-LINE auto-login; the route
// already works for any authenticated session (LINE in-app browser or web fallback).

import { getGroupCollectData } from "@/lib/clawfleet/v2-group-data";
import { CollectGroupClient } from "@/app/(admin)/clawfleet/v2/collect/collect-group-client";

export const dynamic = "force-dynamic";

export default async function ClawfleetLiffPage() {
  const data = await getGroupCollectData();
  return (
    <div className="mx-auto w-full max-w-md px-1 py-2">
      <CollectGroupClient orgId={data.orgId} branches={data.branches} skus={data.skus} />
    </div>
  );
}
