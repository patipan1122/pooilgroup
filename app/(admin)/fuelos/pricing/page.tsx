import Link from "next/link";
import { requireUser, atLeast } from "@/lib/fuelos/auth";
import { getPricingContext, listDepots } from "@/lib/fuelos/pricing-data";
import { PageHeader } from "@/components/fuelos/ui/page-header";
import { PriceEditor } from "./price-editor";
import { thaiDateLong } from "@/lib/fuelos/utils/format";
import { History } from "lucide-react";

export default async function PricingPage() {
  const user = await requireUser();
  const canEdit = atLeast(user.role, "SALES_HEAD");
  const [ctx, allDepots] = await Promise.all([
    getPricingContext(user.orgId),
    canEdit ? listDepots(user.orgId) : Promise.resolve([]),
  ]);

  return (
    <div>
      <PageHeader
        title="ราคาน้ำมัน"
        subtitle={`ราคาประจำวันที่ ${thaiDateLong(ctx.date)} · ${ctx.depots.length} คลัง · ${ctx.zones.length} โซน`}
        actions={
          <Link
            href="/fuelos/pricing/history"
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl border border-border bg-surface text-sm font-medium text-zinc-700 hover:bg-surface-2 transition-colors"
          >
            <History className="size-4" /> ต้นทุนย้อนหลัง
          </Link>
        }
      />
      <PriceEditor
        canEdit={canEdit}
        depots={ctx.depots}
        allDepots={allDepots}
        initialCostsByDepot={ctx.costsByDepot}
        zones={ctx.zones}
        initialMargins={ctx.margins}
      />
    </div>
  );
}
