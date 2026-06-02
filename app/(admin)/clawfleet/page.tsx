import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function ClawfleetIndexPage() {
  const session = await requireSession();
  // v2 is the only production experience (all v1 routes deleted 2026-06-02).
  // Staff (collector) → หน้าเก็บเงิน · ผู้บริหาร/หัวหน้า → hub
  if (session.user.role === "staff") {
    redirect("/clawfleet/v2/collect");
  }
  redirect("/clawfleet/v2/hub");
}
