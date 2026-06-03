import { requireUser, atLeast } from "@/lib/fuelos/auth";
import { getPricingContext } from "@/lib/fuelos/pricing-data";
import { PageHeader } from "@/components/fuelos/ui/page-header";
import { PriceEditor } from "./price-editor";
import { thaiDateLong } from "@/lib/fuelos/utils/format";

export default async function PricingPage() {
  const user = await requireUser();
  const ctx = await getPricingContext(user.orgId);
  const canEdit = atLeast(user.role, "SALES_HEAD");

  return (
    <div>
      <PageHeader
        title="ราคาน้ำมัน"
        subtitle={`ราคาประจำวันที่ ${thaiDateLong(ctx.date)} · คลัง ${ctx.depotName}`}
      />
      <PriceEditor
        canEdit={canEdit}
        depotName={ctx.depotName}
        initialCosts={ctx.costs}
        zones={ctx.zones}
        initialMargins={ctx.margins}
      />
    </div>
  );
}
