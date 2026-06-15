// พรีวิว "ข้อมูลที่จะส่งเข้ากระทบยอด" (shared ทุกโมดูล CashHub) — read-only
// แสดงตัวอย่างจริง: ช่องทาง → ยอดขาย → หักค่าธรรมเนียม → สุทธิที่ส่ง → บัญชีปลายทาง

export type SendPreviewRow = {
  label: string; gross: number; feePercent: number; fee: number; net: number;
  account: string; hasAccount: boolean;
  willSend?: boolean; // false = ช่องนี้ไม่ส่งเข้ากระทบยอด (ส่วนลด/แต้ม/ต่ำกว่าขั้นต่ำ)
  skipReason?: string; // เหตุผลที่ไม่ส่ง (โชว์แทนบัญชี)
};
export type SendPreviewDay = { date: string; rows: SendPreviewRow[]; totalNet: number };

const baht = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function SendPreview({ days, caption, showFee = true }: { days: SendPreviewDay[]; caption: string; showFee?: boolean }) {
  return (
    <section className="mt-8">
      <h3 className="text-base font-semibold text-zinc-800">ตัวอย่างข้อมูลที่จะส่งเข้ากระทบยอด</h3>
      <p className="mt-0.5 mb-3 text-xs text-zinc-500">
        {caption} — แต่ละช่องทางส่งยอดเท่าไหร่{showFee ? " หักค่าธรรมเนียมแล้วเหลือเท่าไหร่" : ""} เข้าบัญชีไหน
        (ช่องสีจาง = ไม่ส่งเข้ากระทบยอด)
      </p>
      {days.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-400">
          ยังไม่มีข้อมูลขายล่าสุดของสาขานี้ — อัปไฟล์ POS / ดึง IV ก่อน หรือเลือกวันที่ที่มียอดด้านบน
        </p>
      ) : (
        <div className="space-y-4">
          {days.map((d) => (
            <div key={d.date} className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white">
              <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5">
                <span className="text-sm font-semibold text-zinc-700">{d.date}</span>
                <span className="text-xs text-zinc-500">
                  รวมส่งเข้าจริง <b className="tabular-num text-emerald-600">฿{baht(d.totalNet)}</b>
                </span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 bg-zinc-50 text-left text-xs text-zinc-500">
                    <th className="p-2.5">ช่องทาง</th>
                    <th className="p-2.5 text-right">ยอดขาย</th>
                    {showFee && <th className="p-2.5 text-right">ค่าธรรมเนียม</th>}
                    <th className="p-2.5 text-right">สุทธิที่ส่ง</th>
                    <th className="p-2.5">บัญชีปลายทาง</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.length === 0 ? (
                    <tr><td colSpan={showFee ? 5 : 4} className="p-4 text-center text-xs text-zinc-400">วันนี้ไม่มีช่องทางที่ตั้งให้เข้าธนาคาร</td></tr>
                  ) : (
                    d.rows.map((r, i) => {
                      const noSend = r.willSend === false;
                      return (
                      <tr key={i} className={`border-b border-zinc-50 last:border-0 ${noSend ? "opacity-50" : ""}`}>
                        <td className="p-2.5 font-medium text-zinc-700">{r.label}</td>
                        <td className="p-2.5 text-right tabular-num text-zinc-600">฿{baht(r.gross)}</td>
                        {showFee && <td className="p-2.5 text-right tabular-num text-rose-500">{r.fee > 0 ? `−฿${baht(r.fee)} (${r.feePercent}%)` : "—"}</td>}
                        <td className={`p-2.5 text-right font-semibold tabular-num ${noSend ? "text-zinc-400" : "text-emerald-600"}`}>{noSend ? "—" : `฿${baht(r.net)}`}</td>
                        <td className="p-2.5 text-xs">
                          {noSend
                            ? <span className="text-zinc-400">{r.skipReason || "ไม่ส่งเข้ากระทบยอด"}</span>
                            : r.hasAccount
                            ? <span className="text-zinc-600">{r.account}</span>
                            : <span className="text-amber-600">⚠ ยังไม่เลือกบัญชี</span>}
                        </td>
                      </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
