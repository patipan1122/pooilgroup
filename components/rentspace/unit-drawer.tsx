"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatBaht, periodLabel, BILL_STATUS, UNIT_STATUS } from "@/lib/rentspace/format";
import { actGetUnitDrawer, actCreateBill, actRecordPayment } from "@/app/(admin)/rentspace/_actions";

type Drawer = Awaited<ReturnType<typeof actGetUnitDrawer>>;

export function UnitDrawer({ unitId, onClose }: { unitId: string | null; onClose: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<Drawer | null>(null);
  const [loading, setLoading] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payAmt, setPayAmt] = useState("");
  const [method, setMethod] = useState("transfer");
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!unitId) {
      setData(null);
      return;
    }
    setLoading(true);
    setPayOpen(false);
    actGetUnitDrawer(unitId)
      .then((d) => setData(d))
      .catch((e) => toast.error(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, [unitId]);

  function reload() {
    if (!unitId) return;
    actGetUnitDrawer(unitId).then(setData).catch(() => {});
    router.refresh();
  }

  function createBill() {
    if (!data?.contract) return;
    start(async () => {
      try {
        await actCreateBill(data.contract!.id, data.period);
        toast.success("ออกบิลห้องนี้แล้ว");
        reload();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ออกบิลไม่สำเร็จ");
      }
    });
  }

  function recordPay() {
    if (!data?.currentBill) return;
    const amt = Number(String(payAmt).replace(/[^0-9.]/g, "")) || 0;
    if (amt <= 0) {
      toast.error("กรอกจำนวนเงิน");
      return;
    }
    start(async () => {
      try {
        await actRecordPayment({ billId: data.currentBill!.billId, amountThb: amt, paidOn: new Date().toISOString().slice(0, 10), method: method as "cash" | "transfer" | "qr" | "card" });
        toast.success("บันทึกรับชำระแล้ว");
        setPayOpen(false);
        setPayAmt("");
        reload();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  if (!unitId) return null;
  const us = data ? UNIT_STATUS[data.unit.status] : null;
  const outstanding = data?.currentBill ? data.currentBill.total - data.currentBill.paid : 0;

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(15,23,41,.34)" }} />
      <div
        className="absolute top-0 right-0 h-full bg-white flex flex-col"
        style={{ width: 472, maxWidth: "94vw", boxShadow: "-12px 0 40px rgba(15,23,41,.13)", animation: "rsSlideIn .24s cubic-bezier(.2,.7,.3,1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <style jsx global>{`@keyframes rsSlideIn{from{transform:translateX(30px);opacity:.6}to{transform:translateX(0);opacity:1}}`}</style>

        {loading || !data ? (
          <div className="flex-1 flex items-center justify-center text-sm" style={{ color: "#9098A4" }}>กำลังโหลด…</div>
        ) : (
          <>
            {/* header */}
            <div className="shrink-0 p-5 flex items-start justify-between gap-3" style={{ borderBottom: "1px solid #EEF0F3" }}>
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 mb-1">
                  <span className="text-xl font-bold">{data.unit.code}</span>
                  {us && <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded-md" style={{ background: us.soft, color: us.color }}>{us.label}</span>}
                </div>
                {data.unit.name && <div className="text-sm font-semibold" style={{ color: "#1F2733" }}>{data.unit.name}</div>}
                <div className="text-[13px]" style={{ color: "#7A828F" }}>{data.tenant?.name ?? "— ว่าง —"}</div>
              </div>
              <button type="button" onClick={onClose} aria-label="ปิด" className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ border: "1px solid #E6E8EC" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#525B68" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {/* actions */}
              {data.contract && (
                <div className="flex gap-2.5 mb-4">
                  {!data.currentBill ? (
                    <button type="button" onClick={createBill} disabled={pending} className="flex-1 rounded-[10px] py-2.5 text-[13.5px] font-semibold text-white disabled:opacity-60" style={{ background: "#2563EB" }}>{pending ? "…" : "ออกบิลห้องนี้"}</button>
                  ) : outstanding > 0 ? (
                    <button type="button" onClick={() => setPayOpen((v) => !v)} className="flex-1 rounded-[10px] py-2.5 text-[13.5px] font-semibold" style={{ background: payOpen ? "#2563EB" : "#EAF7EF", color: payOpen ? "#fff" : "#15803D", border: "1.5px solid " + (payOpen ? "#2563EB" : "#C7E9D4") }}>รับชำระ {formatBaht(outstanding)}</button>
                  ) : (
                    <span className="flex-1 text-center rounded-[10px] py-2.5 text-[13.5px] font-semibold" style={{ background: "#EAF7EF", color: "#15803D" }}>✓ ชำระครบงวดนี้</span>
                  )}
                  {data.currentBill && (
                    <Link href={`/rentspace/bills/${data.currentBill.billId}`} className="rounded-[10px] py-2.5 px-4 text-[13.5px] font-semibold text-center" style={{ background: "#fff", border: "1.5px solid #D9DDE3", color: "#525B68" }}>พิมพ์บิล</Link>
                  )}
                </div>
              )}

              {/* pay form */}
              {payOpen && data.currentBill && (
                <div className="mb-4 rounded-xl p-3.5" style={{ border: "1px solid #E1E5EA", background: "#FAFBFC" }}>
                  <div className="flex gap-2 mb-2">
                    <input value={payAmt} onChange={(e) => setPayAmt(e.target.value)} placeholder={String(outstanding)} inputMode="decimal" className="flex-1 rounded-lg px-3 py-2 text-sm tabular-nums" style={{ border: "1.5px solid #E1E5EA", outline: "none" }} />
                    <select value={method} onChange={(e) => setMethod(e.target.value)} className="rounded-lg px-2 py-2 text-sm" style={{ border: "1.5px solid #E1E5EA", outline: "none" }}>
                      <option value="transfer">โอน</option><option value="cash">เงินสด</option><option value="qr">QR</option><option value="card">บัตร</option>
                    </select>
                  </div>
                  <button type="button" onClick={recordPay} disabled={pending} className="w-full rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ background: "#16A34A" }}>{pending ? "…" : "บันทึกรับชำระ"}</button>
                </div>
              )}

              {/* current bill */}
              <Section title={`บิลงวด ${periodLabel(data.period)}`} badge={data.currentBill ? BILL_STATUS[data.currentBill.status] : { label: "ยังไม่ออกบิล", color: "#C0322B", soft: "#FDECEC" }}>
                {data.currentBill ? (
                  <>
                    <Row label="ค่าเช่า" value={formatBaht(data.currentBill.rent)} />
                    <Row label="ค่าไฟ" value={data.meters.electric ? formatBaht(data.currentBill.electric) : "—"} detail={data.meters.electric ? `${data.meters.electric.usage} หน่วย × ฿${data.contract?.electricRate ?? ""}` : "ยังไม่จดมิเตอร์"} />
                    <Row label="ค่าน้ำ" value={data.meters.water ? formatBaht(data.currentBill.water) : "—"} detail={data.meters.water ? `${data.meters.water.usage} หน่วย × ฿${data.contract?.waterRate ?? ""}` : "ยังไม่จดมิเตอร์"} />
                    {data.currentBill.lateFee > 0 && <Row label="ค่าปรับล่าช้า" value={formatBaht(data.currentBill.lateFee)} danger />}
                    {data.currentBill.discount > 0 && <Row label="ส่วนลด" value={`-${formatBaht(data.currentBill.discount)}`} />}
                    {data.currentBill.vat > 0 && <Row label="VAT" value={formatBaht(data.currentBill.vat)} />}
                    <div className="flex items-center justify-between pt-2.5">
                      <span className="text-[13.5px] font-semibold">รวมงวดนี้</span>
                      <span className="text-[17px] font-bold tabular-nums" style={{ color: "#2563EB" }}>{formatBaht(data.currentBill.total)}</span>
                    </div>
                  </>
                ) : (
                  <div className="text-[13px] py-2" style={{ color: "#9098A4" }}>ยังไม่ออกบิลงวดนี้ · ค่าเช่าพื้นฐาน {formatBaht(data.baseRent)}</div>
                )}
              </Section>

              {/* meters */}
              <div className="grid grid-cols-2 gap-2.5 mb-3.5">
                <MeterCard label="มิเตอร์ไฟ" reading={data.meters.electric} />
                <MeterCard label="มิเตอร์น้ำ" reading={data.meters.water} />
              </div>

              {/* contract */}
              {data.contract && (
                <Section title="สัญญาเช่า" right={<Link href={`/rentspace/contracts/${data.contract.id}`} className="text-[11.5px] font-semibold px-2.5 py-1 rounded-lg" style={{ background: "#EEF3FE", color: "#2563EB", border: "1px solid #D6E0FB" }}>ดูฉบับเต็ม / พิมพ์</Link>}>
                  <KV k="เลขที่สัญญา" v={data.contract.contractNo} accent />
                  <KV k="ค่าเช่า/เดือน" v={formatBaht(data.contract.rent)} />
                  <KV k="เงินประกัน" v={formatBaht(data.contract.deposit)} />
                  <KV k="สิ้นสุดสัญญา" v={data.contract.endDate ?? "—"} />
                  <KV k="กำหนดชำระ" v={`ภายในวันที่ ${data.contract.rentDueDay}`} />
                  <KV k="เรตไฟ / น้ำ" v={`฿${data.contract.electricRate} · ฿${data.contract.waterRate} /หน่วย`} />
                  {data.tenant?.phone && <KV k="เบอร์ติดต่อ" v={data.tenant.phone} />}
                </Section>
              )}

              {/* bill history with payment dates */}
              <Section title="ประวัติบิล / การชำระ">
                {data.history.length === 0 ? (
                  <div className="text-[12.5px] py-1.5" style={{ color: "#A7AEB9" }}>ยังไม่มีประวัติบิล</div>
                ) : (
                  data.history.map((h) => {
                    const t = BILL_STATUS[h.status] ?? { label: h.status, color: "#64748b", soft: "#f1f5f9" };
                    return (
                      <Link key={h.billId} href={`/rentspace/bills/${h.billId}`} className="block py-2.5" style={{ borderBottom: "1px solid #F4F5F7" }}>
                        <div className="flex items-center justify-between">
                          <span className="text-[13px] font-semibold">{periodLabel(h.period)}</span>
                          <span className="flex items-center gap-2">
                            <span className="text-[13px] font-semibold tabular-nums">{formatBaht(h.total)}</span>
                            <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded" style={{ background: t.soft, color: t.color }}>{t.label}</span>
                          </span>
                        </div>
                        {h.payments.length > 0 ? (
                          h.payments.map((p, i) => (
                            <div key={i} className="flex items-center gap-2 mt-1 text-[11.5px]" style={{ color: "#15803D" }}>
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#16A34A" }} />
                              <span style={{ color: "#7A828F" }}>{p.paidOn} · {p.method === "cash" ? "เงินสด" : p.method === "qr" ? "QR" : p.method === "card" ? "บัตร" : "โอน"}</span>
                              <span className="ml-auto tabular-nums font-semibold">{formatBaht(p.amount)}</span>
                            </div>
                          ))
                        ) : (
                          <div className="mt-1 text-[11.5px]" style={{ color: h.status === "overdue" ? "#C0322B" : "#A7AEB9" }}>{h.status === "overdue" ? "เกินกำหนด · ยังไม่ชำระ" : "ยังไม่ชำระ"}</div>
                        )}
                      </Link>
                    );
                  })
                )}
              </Section>

              <Link href={`/rentspace/units/${data.unit.id}`} className="block text-center text-[12.5px] font-semibold mt-1" style={{ color: "#2563EB" }}>เปิดหน้าห้องแบบเต็ม →</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, badge, right, children }: { title: string; badge?: { label: string; color: string; soft: string }; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-4 mb-3.5" style={{ border: "1px solid #ECEEF1" }}>
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold text-[13.5px]" style={{ color: "#3A4250" }}>{title}</div>
        {badge && <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded-md" style={{ background: badge.soft, color: badge.color }}>{badge.label}</span>}
        {right}
      </div>
      {children}
    </div>
  );
}
function Row({ label, value, detail, danger }: { label: string; value: string; detail?: string; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5" style={{ borderBottom: "1px solid #F4F5F7" }}>
      <div className="min-w-0"><span className="text-[13px]" style={{ color: "#3A4250" }}>{label}</span>{detail && <span className="text-[11.5px] ml-1.5" style={{ color: "#A7AEB9" }}>{detail}</span>}</div>
      <span className="text-[13px] font-semibold tabular-nums whitespace-nowrap" style={{ color: danger ? "#C0322B" : "#1F2733" }}>{value}</span>
    </div>
  );
}
function KV({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return <div className="flex justify-between py-1"><span className="text-[12.5px]" style={{ color: "#8A929E" }}>{k}</span><span className="text-[12.5px] font-semibold" style={{ color: accent ? "#2563EB" : "#1F2733" }}>{v}</span></div>;
}
function MeterCard({ label, reading }: { label: string; reading: { prev: number; curr: number; usage: number } | null }) {
  return (
    <div className="rounded-xl p-3.5" style={{ border: "1px solid #ECEEF1" }}>
      <div className="text-[11.5px] mb-1.5" style={{ color: "#9098A4" }}>{label}</div>
      <div className="text-sm font-semibold">{reading ? `${reading.usage} หน่วย` : "ยังไม่จด"}</div>
      <div className="text-[11.5px] mt-0.5" style={{ color: "#A7AEB9" }}>{reading ? `เลข ${reading.prev} → ${reading.curr}` : "รอบนี้"}</div>
    </div>
  );
}
