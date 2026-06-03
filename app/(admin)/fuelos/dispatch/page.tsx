import { redirect } from "next/navigation";
import { requireUser, atLeast } from "@/lib/fuelos/auth";
import { PageHeader } from "@/components/fuelos/ui/page-header";
import {
  listUnassignedOrders,
  listInTransitOrders,
  listAssignableTrucks,
  listTrucksGps,
} from "@/lib/fuelos/dispatch-data";
import { AssignBoard } from "./assign-board";
import { InTransitList } from "./in-transit-list";
import { GpsPanel } from "./gps-panel";
import { Truck as TruckIcon, PackageCheck, MapPin } from "lucide-react";

export default async function DispatchPage() {
  const user = await requireUser();
  // เฉพาะฝ่ายจัดส่งขึ้นไป (DISPATCH > SALES > DRIVER จะถูกกัน)
  if (!atLeast(user.role, "DISPATCH")) redirect("/fuelos/dashboard");

  const [unassigned, inTransit, trucks, gps] = await Promise.all([
    listUnassignedOrders(user.orgId),
    listInTransitOrders(user.orgId),
    listAssignableTrucks(user.orgId),
    listTrucksGps(user.orgId),
  ]);

  return (
    <div>
      <PageHeader
        title="จัดส่ง + GPS"
        subtitle={`รอจัดรถ ${unassigned.length} · กำลังส่ง ${inTransit.length} · รถ ${gps.length} คัน`}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* (A) จัดรถ */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <TruckIcon className="size-4 text-brand-600" />
            <h2 className="font-bold">จัดรถ</h2>
            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-brand-600/10 text-brand-700 tabular-nums">
              {unassigned.length}
            </span>
          </div>
          <AssignBoard orders={unassigned} trucks={trucks} />
        </section>

        {/* (B) ตำแหน่งรถ (GPS) */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <MapPin className="size-4 text-brand-600" />
            <h2 className="font-bold">ตำแหน่งรถ (GPS)</h2>
            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-brand-600/10 text-brand-700 tabular-nums">
              {gps.length}
            </span>
          </div>
          <GpsPanel trucks={gps} />
        </section>
      </div>

      {/* กำลังส่ง — ยืนยันส่งถึง */}
      <section className="mt-6">
        <div className="flex items-center gap-2 mb-3">
          <PackageCheck className="size-4 text-leaf-600" />
          <h2 className="font-bold">กำลังจัดส่ง — ยืนยันส่งถึง</h2>
          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-leaf-500/15 text-leaf-700 tabular-nums">
            {inTransit.length}
          </span>
        </div>
        <InTransitList orders={inTransit} />
      </section>
    </div>
  );
}
