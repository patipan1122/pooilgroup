// F9: Graceful deactivated screen for maids whose isActive = false.
// Intentionally outside the (maid) layout group — no requireExactRole / no
// onboarding gate — so a deactivated maid always lands here, not /403.

import { PhoneCall } from "lucide-react";

export const dynamic = "force-static";

export default function MaidDeactivatedPage() {
  return (
    <div className="chairops-scope min-h-screen bg-[var(--co-bg)] flex flex-col items-center justify-center px-6 py-12 text-center">
      {/* Seal icon (brand mascot placeholder) */}
      <div className="text-7xl mb-6" aria-hidden>
        🦭
      </div>

      <h1 className="text-2xl font-bold text-[var(--co-text)] mb-3">
        ขอบคุณที่ร่วมงานกับเรา
      </h1>
      <p className="text-[var(--co-text-muted)] text-base leading-relaxed max-w-xs mb-8">
        บัญชีของคุณถูกปิดการใช้งานแล้ว
        <br />
        หากมีข้อสงสัยกรุณาติดต่อสำนักงาน
      </p>

      {/* Office contact */}
      <a
        href="tel:+66020000000"
        className="inline-flex items-center gap-2 rounded-xl bg-[var(--co-primary)] text-white px-6 py-3 text-base font-semibold active:opacity-80"
      >
        <PhoneCall className="h-5 w-5" aria-hidden />
        โทรสำนักงาน
      </a>

      <p className="mt-10 text-xs text-[var(--co-text-muted)]">
        ChairOps · JP Sync Group
      </p>
    </div>
  );
}
