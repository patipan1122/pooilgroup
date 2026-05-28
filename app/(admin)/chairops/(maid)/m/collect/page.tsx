// `/chairops/m/collect` has no list view — the maid home already shows the
// last 5 collections. Redirect to home so old bookmarks don't 404.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function MaidCollectIndexRedirect(): never {
  redirect("/chairops/m");
}
