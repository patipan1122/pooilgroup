import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function ClawfleetIndexPage() {
  const session = await requireSession();
  // Staff (filler) → ไปหน้ารอบเก็บ · ผู้บริหาร/หัวหน้า → dashboard
  if (session.user.role === "staff") {
    redirect("/clawfleet/sessions");
  }
  redirect("/clawfleet/dashboard");
}
