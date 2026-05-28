// DocuFlow — wizard route (DEPRECATED)
// ────────────────────────────────────────────────────────────────────
// Phase 4 strip 2026-05-12: 3-step wizard ลบทิ้ง — user feedback "ยากเกิน"
// route ยังอยู่เพื่อ back-compat กับลิงก์เก่า แต่ redirect ไป /upload ตรงๆ
// ────────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";

export default function DeprecatedWizardPage() {
  redirect("/docuflow/documents/upload");
}
