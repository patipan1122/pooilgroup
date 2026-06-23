import { requireUser } from "@/lib/fuelos/auth";
import { getFleetSnapshot } from "@/lib/fuelos/gps/fleet-data";
import { PageHeader } from "@/components/fuelos/ui/page-header";
import { BackButton } from "@/components/fuelos/ui/back-button";
import { FleetView } from "./fleet-view";

export const dynamic = "force-dynamic";

export default async function FleetMapPage() {
  await requireUser();
  const initial = await getFleetSnapshot();

  return (
    <div>
      <BackButton fallbackHref="/fuelos/dispatch" className="mb-3" />
      <PageHeader
        title="ติดตามรถ (แผนที่)"
        subtitle="ตำแหน่งรถทั้งกองแบบสด · แตะแผนที่ตรงจุดส่งเพื่อหารถที่ใกล้ที่สุด"
      />
      <FleetView initial={initial} />
    </div>
  );
}
