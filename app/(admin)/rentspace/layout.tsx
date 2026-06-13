import { assertModuleEnabled } from "@/lib/auth/module-access";
import "@/components/rentspace/tokens.css";

export default async function RentSpaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertModuleEnabled("rentspace");
  return <div className="rs-scope">{children}</div>;
}
