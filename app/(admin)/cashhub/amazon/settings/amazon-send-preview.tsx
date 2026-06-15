// พรีวิว "ข้อมูลที่จะส่งเข้ากระทบยอด" — แสดงตัวอย่างจริง 2 วันล่าสุด:
// แต่ละช่องทาง → ยอดขาย → หักค่าธรรมเนียม% → สุทธิที่ส่ง → บัญชีปลายทาง (ธนาคาร ****เลข4ตัว)
// อ่านอย่างเดียว · รันสูตรเดียวกับตัวส่งจริง (computeDaySettlement) → เห็นว่าจะส่งอะไรก่อนกดส่ง

export type SendPreviewRow = {
  label: string; gross: number; feePercent: number; fee: number; net: number;
  account: string; hasAccount: boolean;
};
export type SendPreviewDay = { date: string; rows: SendPreviewRow[]; totalNet: number };

const baht = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function AmazonSendPreview({ days, storeLabel }: { days: SendPreviewDay[]; storeLabel: string }) {
  return (
    <section className="mt-8">
      <h3 className="text-base font-semibold text-zinc-800">ตัวอย่างข้อมูลที่จะส่งเข้ากระทบยอด</h3>
      <p className="mt-0.5 mb-3 text-xs text-zinc-500">
        {storeLabel ? `สาขา ${storeLabel} · ` : ""}2 วันล่าสุด — แต่ละช่องทางส่งยอดเท่าไหร่ หักค่าธรรมเนียมแล้วเหลือเท่าไหร่ เข้าบัญชีไหน
        (ส่งเฉพาะช่องที่ตั้งว่า &ldquo;เงินเข้าธนาคาร&rdquo;)
      </p>
      {days.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-400">
          ยังไม่มีข้อมูลขายให้พรีวิว — นำเข้ายอดขายก่อน
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
                    <th className="p-2.5 text-right">ค่าธรรมเนียม</th>
                    <th className="p-2.5 text-right">สุทธิที่ส่ง</th>
                    <th className="p-2.5">บัญชีปลายทาง</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.length === 0 ? (
                    <tr><td colSpan={5} className="p-4 text-center text-xs text-zinc-400">วันนี้ไม่มีช่องทางที่ตั้งให้เข้าธนาคาร</td></tr>
                  ) : (
                    d.rows.map((r, i) => (
                      <tr key={i} className="border-b border-zinc-50 last:border-0">
                        <td className="p-2.5 font-medium text-zinc-700">{r.label}</td>
                        <td className="p-2.5 text-right tabular-num text-zinc-600">฿{baht(r.gross)}</td>
                        <td className="p-2.5 text-right tabular-num text-rose-500">{r.fee > 0 ? `−฿${baht(r.fee)} (${r.feePercent}%)` : "—"}</td>
                        <td className="p-2.5 text-right font-semibold tabular-num text-emerald-600">฿{baht(r.net)}</td>
                        <td className="p-2.5 text-xs">
                          {r.hasAccount
                            ? <span className="text-zinc-600">{r.account}</span>
                            : <span className="text-amber-600">⚠ ยังไม่เลือกบัญชี</span>}
                        </td>
                      </tr>
                    ))
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
