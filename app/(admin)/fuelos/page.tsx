// FuelOS quarantined (รอบ 46 audit · 2026-05-21)
// Module is on the registry as `coming_soon` but has zero working surfaces.
// Redirect any landing on /fuelos back to /dashboard until rebuild lands.

import { redirect } from "next/navigation";

export default function FuelOsPage() {
  redirect("/dashboard");
}
