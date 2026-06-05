// F4: Maid self-onboarding — shown once after accepting invite.
// Lives outside the (maid) layout group so the gate in layout.tsx doesn't loop.
// If maid already onboarded → redirect to /chairops/m.

import { redirect } from "next/navigation";
import { getMaidUserRaw } from "@/lib/chairops/auth/session";
import { requireSession as poolRequireSession } from "@/lib/auth/session";
import { OnboardingForm } from "./onboarding-form";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  await poolRequireSession();
  const user = await getMaidUserRaw();

  if (!user || !user.isActive) redirect("/chairops/m/deactivated");
  if (user.role !== "MAID") redirect("/chairops/branch-collect");
  if (user.onboardingComplete) redirect("/chairops/m");

  return (
    <div className="chairops-scope min-h-screen bg-[var(--co-bg)] px-5 py-10">
      <header className="mb-8 text-center">
        <div className="text-5xl mb-4" aria-hidden>
          👋
        </div>
        <h1 className="text-2xl font-bold text-[var(--co-text)]">ยินดีต้อนรับ!</h1>
        <p className="mt-2 text-sm text-[var(--co-text-muted)]">
          กรอกข้อมูลสั้นๆ ก่อนเริ่มใช้งาน
        </p>
      </header>

      <OnboardingForm defaultName={user.displayName} />
    </div>
  );
}
