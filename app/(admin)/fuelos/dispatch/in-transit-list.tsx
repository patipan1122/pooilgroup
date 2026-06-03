"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/fuelos/ui/button";
import { formatBaht, formatNumber, bkkDate } from "@/lib/fuelos/utils/format";
import { markDelivered } from "./actions";
import type { DispatchOrder } from "@/lib/fuelos/dispatch-data";
import { PackageCheck, MapPin, Truck as TruckIcon, LocateFixed } from "lucide-react";

function DeliverRow({ order }: { order: DispatchOrder }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);

  function grabLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("อุปกรณ์นี้ไม่รองรับ GPS");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
        toast.success("บันทึกพิกัดปัจจุบันแล้ว");
      },
      () => {
        setLocating(false);
        toast.error("ดึงพิกัดไม่สำเร็จ");
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  function confirm() {
    start(async () => {
      try {
        await markDelivered(order.id, coords?.lat, coords?.lng);
        toast.success(`ยืนยันส่งถึง ${order.orderNo} แล้ว`);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ยืนยันไม่สำเร็จ");
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
            {order.locationName ? ` · ${order.locationName}` : ""}
            {order.scheduledDate ? ` · ส่ง ${bkkDate(order.scheduledDate)}` : ""}
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500">
            {order.truckPlate && (
              <span className="inline-flex items-center gap-1">
                <TruckIcon className="size-3.5" /> {order.truckPlate}
              </span>
            )}
            <span className="tabular-nums">{formatNumber(order.totalLiters)} ล.</span>
            <span className="tabular-nums">{formatBaht(order.subtotal)}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <Button
          size="sm"
          variant="outline"
          onClick={grabLocation}
          loading={locating}
          title="แนบพิกัดจุดส่ง (ไม่บังคับ)"
        >
          <LocateFixed className="size-4" />
          {coords ? "พิกัดพร้อม" : "แนบพิกัด"}
        </Button>
        {coords && (
          <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500 tabular-nums">
            <MapPin className="size-3.5" />
            {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
          </span>
        )}
        <Button size="sm" onClick={confirm} loading={pending} className="ml-auto">
          <PackageCheck className="size-4" /> ยืนยันส่งถึง
        </Button>
      </div>
    </div>
  );
}

export function InTransitList({ orders }: { orders: DispatchOrder[] }) {
  if (orders.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-zinc-500">
        ไม่มีออเดอร์ที่กำลังจัดส่ง
      </div>
    );
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {orders.map((o) => (
        <DeliverRow key={o.id} order={o} />
      ))}
    </div>
  );
}
