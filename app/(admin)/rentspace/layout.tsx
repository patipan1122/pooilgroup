import { Suspense } from "react";
import { assertModuleEnabled } from "@/lib/auth/module-access";
import { DrawerHost } from "@/components/rentspace/drawer-host";
import "@/components/rentspace/tokens.css";

export default async function RentSpaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertModuleEnabled("rentspace");
  return (
    <div className="rs-scope">
      {children}
      <Suspense fallback={null}>
        <DrawerHost />
      </Suspense>
    </div>
  );
}
