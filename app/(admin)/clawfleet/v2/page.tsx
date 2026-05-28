import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function ClawfleetV2Index() {
  redirect("/clawfleet/v2/hub");
}
