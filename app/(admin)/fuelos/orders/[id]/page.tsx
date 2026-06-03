import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, atLeast } from "@/lib/fuelos/auth";
import { getOrder, ORDER_STATUS_META } from "@/lib/fuelos/orders-data";
import { formatBaht, formatNumber, bkkDate } from "@/lib/fuelos/utils/format";
import { PRODUCT_LABELS } from "@/lib/fuelos/pricing";
import { cn } from "@/lib/fuelos/utils/cn";
import { OrderControls } from "./order-controls";
import { ArrowLeft, User, MapPin, Truck as TruckIcon, FileText } from "lucide-react";

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const data = await getOrder(user.orgId, id);
  if (!data) notFound();

  const { order, trucks, credit } = data;
  const meta = ORDER_STATUS_META[order.status];

  const totalLiters = order.items.reduce((s, it) => s + Number(it.qtyLiters), 0);
  const subtotal = Number(order.subtotal);
  const totalCost = Number(order.totalCost);
  const totalProfit = Number(order.totalProfit);

  // yyyy-MM-dd สำหรับ input[type=date] (scheduledDate เก็บเป็น @db.Date)
  const scheduledStr = order.scheduledDate
    ? new Date(order.scheduledDate).toISOString().slice(0, 10)
    : null;

  const approval = order.approval
    ? {
        status: order.approval.status,
        amountOver: Number(order.approval.amountOver),
        note: order.approval.note,
        requestedBy: order.approval.requestedBy?.name ?? null,
        approvedBy: order.approval.approvedBy?.name ?? null,
      }
    : null;

  return (
    <div>
      <Link href="/fuelos/orders" className="inline-flex items-center gap-1 text-sm text-zinc-500 mb-3">
        <ArrowLeft className="size-4" /> บอร์ดออเดอร์
      </Link>

      {/* header */}
      <div className="rounded-2xl border border-border bg-surface p-5 mb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold font-[family-name:var(--font-plex-mono)]">{order.orderNo}</h1>
              <span className={cn("text-[11px] px-2 py-0.5 rounded-full font-medium", meta.tone)}>{meta.label}</span>
            </div>
            <Link
              href={`/fuelos/customers/${order.customer.id}`}
              className="text-sm text-zinc-600 hover:text-brand-700 inline-flex items-center gap-1 mt-1.5"
            >
              <User className="size-3.5" /> {order.customer.name}
            </Link>
            {order.customer.legalName && (
              <div className="text-xs text-zinc-400 mt-0.5">{order.customer.legalName}</div>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs text-zinc-400">ยอดขาย</div>
            <div className="text-2xl font-bold tabular-nums">{formatBaht(subtotal)}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-sm">
          <Meta icon={TruckIcon} label="ปริมาณรวม" value={`${formatNumber(totalLiters)} ล.`} />
          <Meta icon={User} label="เซลล์" value={order.sales.name} />
          <Meta
            icon={MapPin}
            label="จุดส่ง"
            value={order.location?.name ?? (order.customer.zone ? `โซน ${order.customer.zone}` : "—")}
          />
          <Meta
            icon={TruckIcon}
            label="รถ / นัดส่ง"
            value={`${order.truck?.plate ?? "ยังไม่จัด"}${order.scheduledDate ? ` · ${bkkDate(order.scheduledDate)}` : ""}`}
          />
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-3">
        {/* left: items + totals */}
        <div className="space-y-3">
          <div className="rounded-2xl border border-border bg-surface overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b border-border">
              <FileText className="size-4 text-zinc-400" /> รายการสินค้า
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="text-[11px] text-zinc-400 text-right">
                    <th className="text-left font-medium px-4 py-2">สินค้า</th>
                    <th className="font-medium px-2 py-2">ลิตร</th>
                    <th className="font-medium px-2 py-2">฿/ลิตร</th>
                    <th className="font-medium px-2 py-2">กำไร/ลิตร</th>
                    <th className="font-medium px-2 py-2">ยอดรวม</th>
                    <th className="font-medium px-4 py-2">กำไร</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((it) => (
                    <tr key={it.id} className="border-t border-border text-right tabular-nums">
                      <td className="text-left px-4 py-2.5 font-medium">
                        {PRODUCT_LABELS[it.productType] ?? it.productType}
                      </td>
                      <td className="px-2 py-2.5">{formatNumber(Number(it.qtyLiters))}</td>
                      <td className="px-2 py-2.5">{formatNumber(Number(it.pricePerLiter))}</td>
                      <td className="px-2 py-2.5 text-zinc-500">{formatNumber(Number(it.marginPerLiter))}</td>
                      <td className="px-2 py-2.5 font-medium">{formatBaht(Number(it.lineTotal))}</td>
                      <td className="px-4 py-2.5 text-leaf-700">{formatBaht(Number(it.lineProfit))}</td>
                    </tr>
                  ))}
                  {order.items.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-xs text-zinc-400">
                        ไม่มีรายการสินค้า
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* totals */}
            <div className="border-t border-border px-4 py-3 space-y-1.5 text-sm">
              <Total label="ยอดขายรวม" value={formatBaht(subtotal)} />
              <Total label="ต้นทุน + ขนส่ง" value={formatBaht(totalCost)} muted />
              <div className="h-px bg-border my-1" />
              <Total label="กำไรสุทธิ" value={formatBaht(totalProfit)} strong tone="leaf" />
            </div>
          </div>

          {order.notes && (
            <div className="rounded-2xl border border-border bg-surface p-4 text-sm">
              <div className="text-xs text-zinc-400 mb-1">หมายเหตุ</div>
              {order.notes}
            </div>
          )}
        </div>

        {/* right: controls */}
        <OrderControls
          orderId={order.id}
          status={order.status}
          trucks={trucks.map((t) => ({
            id: t.id,
            plate: t.plate,
            status: t.status,
            capacityLiters: t.capacityLiters,
          }))}
          currentTruckId={order.truckId}
          scheduledDate={scheduledStr}
          credit={credit}
          approval={approval}
          canApprove={atLeast(user.role, "OWNER")}
        />
      </div>
    </div>
  );
}

function Meta({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[11px] text-zinc-400">
        <Icon className="size-3" /> {label}
      </div>
      <div className="font-medium truncate mt-0.5">{value}</div>
    </div>
  );
}

function Total({
  label,
  value,
  muted,
  strong,
  tone,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
  tone?: "leaf";
}) {
  return (
    <div className="flex justify-between">
      <span className={cn(muted ? "text-zinc-400" : "text-zinc-500", strong && "font-semibold text-zinc-700")}>
        {label}
      </span>
      <span
        className={cn(
          "tabular-nums",
          muted && "text-zinc-400",
          strong && "font-bold",
          tone === "leaf" && "text-leaf-700",
        )}
      >
        {value}
      </span>
    </div>
  );
}
