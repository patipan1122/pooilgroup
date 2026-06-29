// CEO 2026-06-29 · "จัดการตู้เสีย" was merged into ของเสีย as the "ตู้ต้องเช็ก"
// tab. This route is kept only so old bookmarks + existing alert links keep
// working — it redirects to the new home.
import { redirect } from "next/navigation";

export default function BrokenChairsRedirect() {
  redirect("/chairops/damage?tab=suspects");
}
