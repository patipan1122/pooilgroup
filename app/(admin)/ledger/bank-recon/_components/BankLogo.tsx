// BankLogo (bank-recon) — เดิมเป็น badge สีแบรนด์ (ตัวอักษรบนสี่เหลี่ยมสี).
// อัปเกรดเป็น "โลโก้ธนาคารจริง" (CEO 2026-06-12 เลือกโลโก้จริง) โดย delegate ไป
// คอมโพเนนต์กลาง components/ledger/BankLogo (โหลด SVG จริงจาก public/logos/banks/
// · fallback เป็น badge สีแบรนด์เมื่อไม่มีไฟล์ เช่น TrueMoney/อื่น ๆ).
// คง API { bankCode, size } เดิม → 3 หน้า bank-recon (hub/overview/reconcile) ไม่ต้องแก้.
import { BankLogo as SharedBankLogo } from "@/components/ledger/BankLogo";

export function BankLogo({ bankCode, size = 36 }: { bankCode: string; size?: number }) {
  return <SharedBankLogo code={bankCode} size={size} />;
}
