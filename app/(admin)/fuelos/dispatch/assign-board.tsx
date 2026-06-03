"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/fuelos/ui/button";
import { formatBaht, formatNumber } from "@/lib/fuelos/utils/format";
import { PRODUCT_LABELS } from "@/lib/fuelos/pricing";
import { assignTruck } from "./actions";
import type { DispatchOrder, TruckOption } from "@/lib/fuelos/dispatch-data";
import { Truck as TruckIcon, Check } from "lucide-react";

function todayStr(): string {
  const d = new Date();
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
}

function OrderCard({ order, trucks }: { order: DispatchOrder; trucks: TruckOption[] }) {
  const router = useRouter();
  const [truckId, setTruckId] = useState("");
  const [date, setDate] = useState(
    order.scheduledDate ? new Date(order.scheduledDate).toISOString().slice(0, 10) : todayStr(),
  );
  const [pending, start] = useTransition();

  function submit() {
    if (!truckId) {
      toast.error("เลือกรถก่อน");
      return;
    }
    start(async () => {
      try {
        await assignTruck(order.id, truckId, date);
        toast.success(`จัดรถให้ ${order.orderNo} แล้ว`);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "จัดรถไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold truncate">{order.customerName}</div>
          <div className="text-xs text-zinc-500 mt-0.5 truncate">
            <span className="font-[family-name:var(--font-plex-mono)]">{order.orderNo}</span>
            {order.zone ? ` · โซน ${order.zone}` : ""}
            {order.locationName ? ` · ${order.locationName}` : ""}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-bold tabular-nums">{formatBaht(order.subtotal)}</div>
          <div className="text-[11px] text-zinc-400 tabular-nums">{formatNumber(order.totalLiters)} ล.</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 mt-2">
        {order.products.map((p, i) => (
          <span key={`${p}-${i}`} className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-600/10 text-brand-700">
            {PRODUCT_LABELS[p] ?? p}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <select
          value={truckId}
          onChange={(e) => setTruckId(e.target.value)}
          className="h-9 flex-1 min-w-32 rounded-lg border border-border bg-surface px-2 text-sm"
        >
          <option value="">— เลือกรถ —</option>
          {trucks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.plate} ({formatNumber(t.capacityLiters)} ล.)
            </option>
          ))}
        </select>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-9 rounded-lg border border-border bg-surface px-2 text-sm"
        />
        <Button size="sm" onClick={submit} loading={pending}>
          <TruckIcon className="size-4" /> จัดรถ
        </Button>
      </div>
    </div>
  );
}

export function AssignBoard({ orders, trucks }: { orders: DispatchOrder[]; trucks: TruckOption[] }) {
  if (trucks.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-zinc-500">
        ยังไม่มีรถในระบบ — เพิ่มรถที่หน้าตั้งค่าก่อนจัดส่ง
      </div>
    );
  }
  if (orders.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-center">
        <Check className="size-6 text-leaf-500 mx-auto mb-1" />
        <div className="text-sm text-zinc-500">ไม่มีออเดอร์รอจัดรถ</div>
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      {orders.map((o) => (
        <OrderCard key={o.id} order={o} trucks={trucks} />
      ))}
    </div>
  );
}
