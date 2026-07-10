// InstallmentStatusBadge — ป้ายสถานะงวดงาน (F3) บน kit <Badge tone> (สำนวนเดียวกับ StatusBadge).
// tone ตาม tokens.md: planned=neutral(gray) · paid_pending_slip=warning(amber) · paid=success(green) ·
// broken=danger(red) · void=neutral. pure presentational → ใช้ได้ทั้ง server + client.
import { Clock, Check, CircleAlert, Circle, Ban } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { InstallmentDisplayStatus } from "@/lib/ledger/installments";

const META: Record<
  InstallmentDisplayStatus,
  { label: string; tone: "neutral" | "warning" | "success" | "danger"; Icon: typeof Clock }
> = {
  planned: { label: "ยังไม่จ่าย", tone: "neutral", Icon: Circle },
  paid_pending_slip: { label: "รอโอน/รอสลิป", tone: "warning", Icon: Clock },
  paid: { label: "จ่ายแล้ว", tone: "success", Icon: Check },
  broken: { label: "สลิปหลุด/ตรวจสอบ", tone: "danger", Icon: CircleAlert },
  void: { label: "ยกเลิก", tone: "neutral", Icon: Ban },
};

export function InstallmentStatusBadge({
  status,
  className,
}: {
  status: InstallmentDisplayStatus;
  className?: string;
}) {
  const meta = META[status] ?? META.planned;
  const { Icon } = meta;
  return (
    <Badge tone={meta.tone} className={className}>
      <Icon className="size-3 shrink-0" aria-hidden />
      {meta.label}
    </Badge>
  );
}
