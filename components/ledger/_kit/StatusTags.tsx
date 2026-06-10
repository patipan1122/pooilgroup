// LedgerLine D3 — text-tag pills (แทนจุดสี) สำหรับ 2 มิติ:
//   • DocTag      — สถานะเอกสาร/ภาษีซื้อ: ไม่มี VAT · รอใบกำกับ · ใบกำกับครบ · ขอคืนไม่ได้
//   • PaymentTag  — สถานะจ่ายเงิน:        จ่ายแล้ว · ยังไม่จ่าย · จ่ายบางส่วน · ⚠ จ่ายซ้ำ?
//
// CEO D3: ใช้ "ป้ายข้อความ" (rounded rect + คำไทยสั้น + สี) ไม่ใช่จุดสีเปล่า — กัน
// สีชนกัน + ไม่มี emoji. สร้างบน <Badge tone> (kit idiom เดียวกับ StatusBadge).
// pure presentational — ใช้ได้ทั้ง server + client component.
import { Badge } from "@/components/ui/badge";
import type {
  CompletenessStatus,
  ExpenseDocType,
  PaymentStatus,
} from "@/lib/ledger/types";
import { missingLabel } from "./CompletenessDot";

type Tone = "success" | "warning" | "danger" | "neutral";

/** Derive the document/VAT tag from the deterministic grade + docType + VAT. */
export function docTagOf(p: {
  docType?: ExpenseDocType | string | null;
  vat?: number | null;
  completenessStatus?: CompletenessStatus | string | null;
}): { label: string; tone: Tone } | null {
  const vat = p.vat ?? 0;
  // ใบเสนอราคา/บิลไม่มีใบกำกับ (D1): ถ้าไม่มี VAT = ยอดสุดท้าย "ไม่มี VAT" (เขียว);
  // ถ้ามี VAT = ต้องตามใบกำกับจริง "รอใบกำกับ" (เหลือง) จน supersede.
  if (p.docType === "quotation") {
    return vat > 0
      ? { label: "รอใบกำกับ", tone: "warning" }
      : { label: "ไม่มี VAT", tone: "success" };
  }
  switch (p.completenessStatus) {
    case "green_full":
      return { label: "ใบกำกับครบ", tone: "success" };
    case "yellow_partial":
      return { label: "รอใบกำกับ", tone: "warning" };
    case "red_invalid":
      // CEO 2026-06-10: "ขอคืนไม่ได้" ไม่ใช่ error (เป็นสถานะปกติของบิลที่ใบไม่สมบูรณ์) —
      // เดิมแดง (danger) โผล่เกือบทุกใบ → ดูเหมือนพังทั้งลิสต์. เปลี่ยนเป็นเหลือง (warning);
      // สงวนแดงไว้ให้ error จริง (จ่ายซ้ำ/ส่ง TRCloud พลาด/ขอโอนไม่ได้).
      return { label: "ขอคืนไม่ได้", tone: "warning" };
    default:
      return null; // undecided / ใบเก่าก่อนฟีเจอร์ → ไม่ใส่ป้าย
  }
}

export function DocTag({
  docType,
  vat,
  completenessStatus,
  missing,
  className,
}: {
  docType?: ExpenseDocType | string | null;
  vat?: number | null;
  completenessStatus?: CompletenessStatus | string | null;
  missing?: string[] | null;
  className?: string;
}) {
  const tag = docTagOf({ docType, vat, completenessStatus });
  if (!tag) return null;
  const miss = (missing ?? []).map(missingLabel);
  const title = miss.length > 0 ? `${tag.label} · ขาด: ${miss.join(", ")}` : tag.label;
  return (
    <Badge tone={tag.tone} className={className} title={title}>
      {tag.label}
    </Badge>
  );
}

const PAYMENT_META: Record<PaymentStatus, { label: string; tone: Tone }> = {
  paid: { label: "จ่ายแล้ว", tone: "success" },
  unpaid: { label: "ยังไม่จ่าย", tone: "neutral" },
  partial: { label: "จ่ายบางส่วน", tone: "warning" },
};

export function PaymentTag({
  status,
  dupWarning = false,
  className,
}: {
  status?: PaymentStatus | string | null;
  /** ⚠ จ่ายซ้ำ? — โชว์ตอนระบบจับ slip ซ้ำ (เด่นกว่า status). */
  dupWarning?: boolean;
  className?: string;
}) {
  if (dupWarning) {
    return (
      <Badge tone="danger" className={className} title="ตรวจพบสลิป/การจ่ายที่อาจซ้ำ">
        ⚠ จ่ายซ้ำ?
      </Badge>
    );
  }
  const meta = PAYMENT_META[(status as PaymentStatus)] ?? PAYMENT_META.unpaid;
  return (
    <Badge tone={meta.tone} className={className} title={meta.label}>
      {meta.label}
    </Badge>
  );
}
