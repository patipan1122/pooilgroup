// Maid cleanliness · the mobile-first form already lives at
// /chairops/m/cleanliness/new (MaidCleanlinessForm). Bare /chairops/m/cleanliness
// (e.g. an old deep link) now lands there instead of the legacy desktop form —
// keeps everything inside the maid LIFF shell on mobile.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function MaidCleanlinessRedirect(): never {
  redirect("/chairops/m/cleanliness/new");
}
