// Maid cleanliness · Wave 2 page. Until the new mobile UI ships, redirect
// to the existing /chairops/cleanliness/new flow (which still works under
// its own MaidShell layout).
// TODO[claude-design]: replace with mobile-first cleanliness form (W9).
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function MaidCleanlinessRedirect(): never {
  redirect("/chairops/cleanliness/new");
}
