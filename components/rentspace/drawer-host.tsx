"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { UnitDrawer } from "@/components/rentspace/unit-drawer";

/** Global drawer: any link with `?unit=<id>` opens the rich unit drawer. */
export function DrawerHost() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const unitId = sp.get("unit");

  function close() {
    const p = new URLSearchParams(sp.toString());
    p.delete("unit");
    const q = p.toString();
    router.push(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }

  return <UnitDrawer unitId={unitId} onClose={close} />;
}
