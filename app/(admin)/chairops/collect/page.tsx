// Backward-compat redirect · old `/chairops/collect` → new `/chairops/m`.
// W6 cutover · slated for delete +1 week per IA plan.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function DeprecatedCollectHomeRedirect(): never {
  redirect("/chairops/m");
}
