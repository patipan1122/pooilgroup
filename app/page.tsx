import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (session.user.role === "staff" || session.user.role === "driver") {
    redirect("/liff/status");
  }
  redirect("/dashboard");
}
