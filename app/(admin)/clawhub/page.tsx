// ClawHub (JOLLY PLAY) — /clawhub index → redirect to the dashboard.
import { redirect } from "next/navigation";

export default function ClawhubIndexPage() {
  redirect("/clawhub/dashboard");
}
