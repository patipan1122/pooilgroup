// HotelBook admin layout · admin tier + module-enabled gate.
import { assertModuleEnabled } from "@/lib/auth/module-access";

export default async function HotelBookLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertModuleEnabled("hotelbook");
  return <div className="hb-scope">{children}</div>;
}
