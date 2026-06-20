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
      {/* fix: ตารางลิสต์ที่อยู่ใน overflow-x box ทำให้ sticky thead (top:4rem ใน tokens.css)
          ลอยลงมาทับแถว (units/payments/contracts/deposits/bills) → ปิด sticky เฉพาะตารางในกล่อง overflow-x
          (meter-board ใช้ .rs-meter-scroll freeze-pane ของตัวเอง ไม่มี overflow-x-auto จึงไม่โดน) */}
      <style>{`.rs-scope .overflow-x-auto .rs-table thead th{position:static;top:auto}`}</style>
      {children}
      <Suspense fallback={null}>
        <DrawerHost />
      </Suspense>
    </div>
  );
}
