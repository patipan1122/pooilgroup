import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function ClawfleetIndexPage() {
  const session = await requireSession();
  // v2 redesign is now the production experience.
  // Staff (filler) → หน้าเก็บเงิน · ผู้บริหาร/หัวหน้า → hub
  // (v1 routes /clawfleet/dashboard, /sessions, /machines ฯลฯ ยังเข้าผ่าน URL ตรงได้)
  if (session.user.role === "staff") {
    redirect("/clawfleet/v2/collect");
  }
  redirect("/clawfleet/v2/hub");
}
