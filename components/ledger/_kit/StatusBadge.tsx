// StatusBadge — ป้ายสถานะใบเสร็จ (draft|confirmed|locked|void) สำหรับ Ledger.
// Reuses the Pool <Badge> primitive (tone palette) so colors stay consistent
// across modules. Pure presentational · safe in Server Components.
import { Badge } from "@/components/ui/badge";

export type LedgerStatus = "draft" | "confirmed" | "locked" | "void";

const META: Record<
  LedgerStatus,
  { label: string; tone: "warning" | "success" | "info" | "neutral" }
> = {
  draft: { label: "ร่าง · รอยืนยัน", tone: "warning" },
  confirmed: { label: "ยืนยันแล้ว", tone: "success" },
  locked: { label: "ล็อก", tone: "info" },
  void: { label: "ยกเลิก", tone: "neutral" },
};

export function StatusBadge({
  status,
  className,
}: {
  status: LedgerStatus | string;
  className?: string;
}) {
  const meta = META[(status as LedgerStatus)] ?? META.draft;
  return (
    <Badge tone={meta.tone} className={className}>
      {meta.label}
    </Badge>
  );
}
