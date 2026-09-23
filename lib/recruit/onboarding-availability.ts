// Recruit Onboarding · emergency off-switch for the PUBLIC onboarding link.
//
// WHY: /onboard is a permanent, unauthenticated, internet-facing URL that
// collects national-ID photos, bank details and legally binding signatures.
// Unlike every other feature in this app (which sits behind login, so a bad
// deploy only affects staff), a problem here is exposed to anyone with the
// link the moment it ships. Without a switch, turning it off would require a
// full redeploy — minutes to tens of minutes during which real PII keeps
// arriving.
//
// DEFAULT IS ON. Setting the env var to "0" (or "off"/"false") closes the
// public flow within one Vercel env change + redeploy of the env, without
// touching code or reverting the feature:
//
//     RECRUIT_ONBOARD_PUBLIC_ENABLED=0
//
// When closed: /onboard, /onboard/sign and all three public API routes return
// a polite Thai "temporarily closed, please contact HR" response instead of
// 404 — the link will already be circulating in LINE messages by then, so a
// dead 404 would read as "the company's system is broken" to a new hire.
//
// Env var is namespaced per RULE J (<PROGRAM>_<PURPOSE>) so no other module
// can be affected by changing it.

export function isOnboardingPublicFlowEnabled(): boolean {
  const raw = (process.env.RECRUIT_ONBOARD_PUBLIC_ENABLED ?? "").trim().toLowerCase();
  if (raw === "0" || raw === "off" || raw === "false" || raw === "no") return false;
  return true; // default ON — absence of the var must never silently close the flow
}

/** Thai message shown/returned when the flow is switched off. */
export const ONBOARDING_CLOSED_MESSAGE =
  "ขณะนี้ระบบรับพนักงานใหม่ออนไลน์ปิดปรับปรุงชั่วคราว กรุณาติดต่อฝ่ายบุคคลของบริษัทโดยตรง";
