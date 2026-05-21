import { assertCfAdmin } from "@/lib/clawfleet/role-guard";

export const dynamic = "force-dynamic";

export default async function ClawfleetSettingsPage() {
  await assertCfAdmin();
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-zinc-900">ตั้งค่า ClawFleet</h1>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="mb-2 font-semibold text-zinc-900">Default thresholds</h2>
        <ul className="space-y-1 text-sm text-zinc-700">
          <li>• Cash variance ยอมรับได้: ฿20</li>
          <li>• Cash variance WARN: ฿20-฿100</li>
          <li>• Cash variance FLAG: &gt;฿100 หรือ &gt;5%</li>
          <li>• Doll variance ยอมรับได้: ≤2 ตัว</li>
          <li>• Doll variance FLAG: &gt;2 ตัว หรือ &gt;10%</li>
          <li>• Promo discount FLAG: &gt;30% ของยอด</li>
          <li>• Anomaly baseline: รายได้นอกช่วง 30%-300% ของ median 30 วัน</li>
          <li>• Photo retention: 30 วัน (Vercel cron 02:00 ICT)</li>
          <li>• Session auto-close: 24 ชม. (Vercel cron 06:00 ICT)</li>
        </ul>
        <p className="mt-3 text-xs text-zinc-500">
          แก้ค่าใน <code>lib/clawfleet/types.ts:DEFAULTS</code> · ปรับ tolerance per-group ในหน้ากลุ่ม
        </p>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="mb-2 font-semibold text-zinc-900">Kill switch</h2>
        <p className="text-sm text-zinc-700">
          ถ้าต้องการปิด ClawFleet ฉุกเฉิน → ตั้ง env{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">
            MODULES_DISABLED=clawfleet
          </code>{" "}
          แล้ว redeploy
        </p>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="mb-2 font-semibold text-zinc-900">Cron endpoints</h2>
        <ul className="space-y-1 text-xs text-zinc-600">
          <li>
            <code>POST /api/cron/clawfleet-photo-retention</code> — ลบรูปเก่า &gt;30 วัน
          </li>
          <li>
            <code>POST /api/cron/clawfleet-session-autoclose</code> — ปิด session ค้าง &gt;24 ชม.
          </li>
        </ul>
        <p className="mt-3 text-xs text-zinc-500">
          เพิ่มใน <code>vercel.json</code> เพื่อ schedule
        </p>
      </section>
    </div>
  );
}
