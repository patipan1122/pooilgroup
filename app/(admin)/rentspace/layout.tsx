import { Suspense } from "react";
import { assertModuleEnabled } from "@/lib/auth/module-access";
import { getSession } from "@/lib/auth/session";
import { DrawerHost } from "@/components/rentspace/drawer-host";
import { RentSpaceBottomNav } from "@/components/rentspace/bottom-nav";
import "@/components/rentspace/tokens.css";

export default async function RentSpaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertModuleEnabled("rentspace");
  // getSession() is React cache()-wrapped → shared with child pages, no extra
  // round-trip. Drives the role-filtered mobile bottom nav.
  const session = await getSession();
  return (
    // pb spacer keeps content clear of the fixed mobile bar; desktop (lg) uses
    // the Pool sidebar so no bottom bar + no spacer.
    <div className="rs-scope pb-[calc(64px+env(safe-area-inset-bottom))] lg:pb-0">
      {/* fix: ตารางลิสต์ที่อยู่ใน overflow-x box ทำให้ sticky thead (top:4rem ใน tokens.css)
          ลอยลงมาทับแถว (units/payments/contracts/deposits/bills) → ปิด sticky เฉพาะตารางในกล่อง overflow-x
          (meter-board ใช้ .rs-meter-scroll freeze-pane ของตัวเอง ไม่มี overflow-x-auto จึงไม่โดน) */}
      <style>{`.rs-scope .overflow-x-auto .rs-table thead th{position:static;top:auto}`}</style>
      {children}
      <Suspense fallback={null}>
        <DrawerHost />
      </Suspense>
      {/* Suspense: RentSpaceBottomNav reads useSearchParams (deep-link friendliness). */}
      {session ? (
        <Suspense fallback={null}>
          <RentSpaceBottomNav role={session.user.role} />
        </Suspense>
      ) : null}
    </div>
  );
}
