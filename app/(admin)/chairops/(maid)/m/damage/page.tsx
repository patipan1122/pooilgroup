// Maid damage report · Wave 2 page. Forwards to existing /chairops/damage/new
// which already handles the MAID path (see damage/layout.tsx).
// TODO[claude-design]: replace with mobile-first damage form (W8).
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function MaidDamageRedirect(): never {
  redirect("/chairops/damage/new");
}
