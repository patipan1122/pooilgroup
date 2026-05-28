// Backward-compat redirect · old `/chairops/collect/new` → `/chairops/m/collect/new`.
// W6 cutover · slated for delete +1 week per IA plan.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function DeprecatedCollectNewRedirect(): never {
  redirect("/chairops/m/collect/new");
}
