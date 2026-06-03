import type { QuoteStatus } from "@/lib/generated/prisma/enums";

// ป้ายสถานะใบเสนอราคา — ภาษาไทย + โทนสี (ใช้ร่วมกันทั้ง list + detail)
export const QUOTE_STATUS: Record<QuoteStatus, { label: string; tone: string }> = {
  PENDING: { label: "รอผล", tone: "bg-warning/15 text-warning" },
  WON: { label: "ชนะ", tone: "bg-leaf-100 text-leaf-700" },
  LOST: { label: "แพ้", tone: "bg-danger/10 text-danger" },
  DECLINED: { label: "ลูกค้าปฏิเสธ", tone: "bg-surface-2 text-zinc-600" },
  NO_RESPONSE: { label: "ไม่ตอบ", tone: "bg-surface-2 text-zinc-500" },
};
