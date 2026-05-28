import { V2Placeholder } from "@/components/clawfleet/v2/placeholder";

export const dynamic = "force-dynamic";

export default function V2AuditPage() {
  return (
    <V2Placeholder
      eyebrow="Audit log"
      title="หน้านี้ยังไม่ทำ"
      sub="Audit log ต้องมีตาราง cf_audit_log ก่อน (migration M1 จาก audit doc) — เป็นเฟสถัดไป"
    />
  );
}
