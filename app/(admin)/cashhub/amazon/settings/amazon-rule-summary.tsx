// สรุปกฎการส่งยอดเข้ากระทบยอด (อ่านอย่างเดียว) — ให้ super_admin เห็นภาพรวมว่าระบบส่งอะไร เข้าบัญชีไหน
// ดึงจาก SETTLEMENT_GROUPS + config จริง → ตรงกับตัวส่งจริงเสมอ
import type { ChannelConfig } from "@/lib/cashhub/amazon-settlement";
import { SETTLEMENT_GROUPS, CVAR_GROUP } from "@/lib/cashhub/amazon-settlement";

export function AmazonRuleSummary({ configs }: { configs: ChannelConfig[] }) {
  const byCvar = new Map(configs.map((c) => [c.cvar, c]));
  const labelOf = (cv: string) => byCvar.get(cv)?.label ?? cv;

  // 🟢 ช่องที่โอนรวมเข้าบัญชีก้อนเดียว → ส่ง 1 บรรทัด/วัน
  const groups = SETTLEMENT_GROUPS.map((g) => ({
    label: g.label,
    members: g.cvars.filter((cv) => byCvar.has(cv)).map(labelOf),
  }));
  // 🟢 ช่องเดี่ยว (เป็นเงินเข้าธนาคาร · ไม่อยู่ในกลุ่ม) → ส่ง 1 บรรทัด/วัน
  const singles = configs.filter((c) => c.isSettle && !CVAR_GROUP[c.cvar]);
  // ⚪ ไม่ส่ง (ไม่ใช่เงินจริง)
  const notSent = configs.filter((c) => !c.isSettle);

  return (
    <section className="mb-5 rounded-2xl border border-zinc-200 bg-white p-4">
      <h3 className="text-base font-semibold text-zinc-800">
        สรุป: ระบบส่งยอดเข้าหน้ากระทบยอดยังไง
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        ทุกวันที่ยอดบาลานซ์ ระบบแยกเงินเป็นบรรทัด ๆ ส่งเข้าหน้ากระทบยอดธนาคาร —
        <b className="text-zinc-600"> แต่ละบรรทัด = เงินที่เข้าบัญชีจริง 1 ก้อน</b> ไว้จับคู่ statement ธนาคาร 1:1
      </p>

      <div className="mt-3 space-y-2.5 text-sm">
        {/* รวมก้อนเดียว */}
        {groups.map((g) => (
          <div key={g.label} className="rounded-xl bg-emerald-50/60 px-3 py-2">
            <span className="mr-1.5 font-semibold text-emerald-700">🟢 {g.label}</span>
            <span className="text-xs text-emerald-700/80">
              — โอนรวมเข้าบัญชีก้อนเดียว ส่ง <b>1 บรรทัด/วัน</b> ({g.members.join(" + ")})
            </span>
          </div>
        ))}

        {/* ช่องเดี่ยว */}
        <div className="rounded-xl bg-emerald-50/60 px-3 py-2">
          <span className="font-semibold text-emerald-700">🟢 ช่องเดี่ยว</span>
          <span className="text-xs text-emerald-700/80"> — ส่ง 1 บรรทัด/วัน (หักค่าธรรมเนียมก่อน):</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {singles.map((c) => (
              <span
                key={c.cvar}
                className="rounded-lg border border-emerald-200 bg-white px-2 py-0.5 text-xs text-zinc-600"
              >
                {c.label}
                {c.feePercent > 0 && <span className="text-rose-500"> · −{c.feePercent}%</span>}
              </span>
            ))}
          </div>
        </div>

        {/* ไม่ส่ง */}
        {notSent.length > 0 && (
          <div className="rounded-xl bg-zinc-50 px-3 py-2">
            <span className="font-semibold text-zinc-500">⚪ ไม่ส่ง</span>
            <span className="text-xs text-zinc-400"> — ไม่ใช่เงินจริง (แต้ม/ส่วนลด): </span>
            <span className="text-xs text-zinc-500">{notSent.map((c) => c.label).join(" · ")}</span>
          </div>
        )}

        {/* บัญชี */}
        <div className="rounded-xl bg-blue-50/60 px-3 py-2 text-xs text-blue-700/90">
          🏦 <b>บัญชีที่เงินเข้า</b> — ตั้งได้ในตารางด้านล่าง · ทุกช่องเข้าบัญชีเดียวกันได้ (ใช้ปุ่ม
          &ldquo;ตั้งบัญชีทุกช่องพร้อมกัน&rdquo;) แล้วกด <b>บันทึกการตั้งค่า</b>
        </div>
      </div>
    </section>
  );
}
