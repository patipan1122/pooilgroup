"use client";

// DC · #13 — รางสไลด์ "รวมจ่ายหลายใบ" จากขวา (เหนือลิสต์จัดซื้อ)
// CEO: "ของถึงแล้วต้องจ่ายค่าขนส่ง ระบบบอกค่าขนส่งเท่าไหร่ + รวบรวมออเดอร์ กดจ่ายทีเดียว"
//
// โหลด 2 กลุ่มที่ยังค้างจ่าย:
//   • ค่าของ (GOODS)        ← getPayableOutstanding("GOODS")        · ใบที่ "ถึงไทยแล้ว" (ด่านปลดล็อกถึงโกดัง)
//   • ค่าขนส่ง (THAI_FREIGHT) ← getPayableOutstanding("THAI_FREIGHT") · ใบที่ "ถึงโกดัง/รับบางส่วน" (ด่านปลดล็อกรับเข้า)
// แต่ละแถว: ติ๊กเลือก + ยอดที่ระบบแนะนำ (÷100 = บาท · แก้ได้) · โชว์ยอดรวมที่ติ๊กแบบสด.
// "จ่ายทั้งหมด" → ยืนยันก่อน → recordBulkPayment({ kind, items }) แยกตามกลุ่ม (atomic ต่อกลุ่ม).
//
// 💰 เงิน: ยอดแก้ได้ · โชว์ชัด · ยืนยันก่อนส่ง (ไม่จ่ายพลาด).

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { X, Loader2, PackageCheck, Truck, CheckCircle2, AlertCircle } from "lucide-react";
import {
  getPayableOutstanding,
  recordBulkPayment,
  type PayableRow,
  type PoPaymentKindInput,
} from "@/lib/dc/po-actions";

type Kind = PoPaymentKindInput; // "GOODS" | "THAI_FREIGHT"

// แถวที่แก้ได้ในตาราง: เก็บ ticked + ยอด (บาท เป็น string ให้พิมพ์ได้)
type EditableRow = PayableRow & { ticked: boolean; baht: string };

function satangToBaht(satang: number): string {
  return (satang / 100).toFixed(2);
}
function bahtToSatang(baht: string): number {
  const n = Number(baht);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}
function fmtBaht(satang: number): string {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(satang / 100);
}

export function BulkPayDrawer({
  open,
  onClose,
  onPaid,
}: {
  open: boolean;
  onClose: () => void;
  /** จ่ายสำเร็จ (อย่างน้อย 1 กลุ่ม) → refresh list (parent) */
  onPaid: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [goods, setGoods] = useState<EditableRow[]>([]);
  const [freight, setFreight] = useState<EditableRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false); // โชว์ขั้นยืนยันก่อนจ่ายจริง
  const [done, setDone] = useState<{ count: number } | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDone(null);
    setConfirm(false);
    try {
      const [g, f] = await Promise.all([
        getPayableOutstanding("GOODS"),
        getPayableOutstanding("THAI_FREIGHT"),
      ]);
      const toEditable = (rows: PayableRow[]): EditableRow[] =>
        rows.map((r) => ({ ...r, ticked: r.suggestedSatang > 0, baht: satangToBaht(r.suggestedSatang) }));
      setGoods(toEditable(g));
      setFreight(toEditable(f));
    } catch {
      setError("โหลดรายการที่ค้างจ่ายไม่สำเร็จ ลองอีกครั้ง");
    } finally {
      setLoading(false);
    }
  }, []);

  // เปิดราง → โหลดสด · ปิด → ล็อก scroll คืน
  useEffect(() => {
    if (!open) return;
    load();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, load, onClose]);

  function patchRow(kind: Kind, poId: string, patch: Partial<EditableRow>) {
    const setter = kind === "GOODS" ? setGoods : setFreight;
    setter((prev) => prev.map((r) => (r.poId === poId ? { ...r, ...patch } : r)));
  }

  // ใบที่ติ๊ก + ยอด>0 (พร้อมจ่าย) ต่อกลุ่ม
  const goodsPicked = useMemo(() => goods.filter((r) => r.ticked && bahtToSatang(r.baht) > 0), [goods]);
  const freightPicked = useMemo(() => freight.filter((r) => r.ticked && bahtToSatang(r.baht) > 0), [freight]);

  const goodsTotal = useMemo(() => goodsPicked.reduce((s, r) => s + bahtToSatang(r.baht), 0), [goodsPicked]);
  const freightTotal = useMemo(() => freightPicked.reduce((s, r) => s + bahtToSatang(r.baht), 0), [freightPicked]);
  const grandTotal = goodsTotal + freightTotal;
  const pickedCount = goodsPicked.length + freightPicked.length;

  function submit() {
    setError(null);
    startTransition(async () => {
      const calls: Promise<{ ok: true; count: number; batchId: string } | { ok: false; error: string }>[] = [];
      if (goodsPicked.length > 0) {
        calls.push(
          recordBulkPayment({
            kind: "GOODS",
            items: goodsPicked.map((r) => ({ poId: r.poId, amountSatang: bahtToSatang(r.baht) })),
          }),
        );
      }
      if (freightPicked.length > 0) {
        calls.push(
          recordBulkPayment({
            kind: "THAI_FREIGHT",
            items: freightPicked.map((r) => ({ poId: r.poId, amountSatang: bahtToSatang(r.baht) })),
          }),
        );
      }
      if (calls.length === 0) {
        setError("กรุณาเลือกใบที่จะจ่ายอย่างน้อย 1 ใบ");
        setConfirm(false);
        return;
      }
      const results = await Promise.all(calls);
      const failed = results.find((r) => !r.ok) as { ok: false; error: string } | undefined;
      if (failed) {
        setError(failed.error);
        setConfirm(false);
        return;
      }
      const total = results.reduce((s, r) => s + (r.ok ? r.count : 0), 0);
      setDone({ count: total });
      setConfirm(false);
      onPaid(); // refresh list ฝั่ง parent
    });
  }

  if (!open) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 70 }} aria-modal="true" role="dialog">
      {/* backdrop soft (เห็นลิสต์ข้างหลังราง ๆ) */}
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(24,28,40,.20)" }} />

      <aside style={panel} onClick={(e) => e.stopPropagation()}>
        <style>{`@keyframes dcDrawerIn { from { transform: translateX(24px); opacity: .4; } to { transform: translateX(0); opacity: 1; } }`}</style>
        <header style={head}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--dc-ink, #1c2533)" }}>รวมจ่ายหลายใบ</h2>
            <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "var(--dc-muted, #5b6676)" }}>
              ติ๊กใบที่จะจ่าย · ระบบเติมยอดที่แนะนำให้ (แก้ได้) · กดจ่ายทีเดียว
            </p>
          </div>
          <button type="button" onClick={onClose} style={closeBtn} aria-label="ปิด">
            <X size={20} />
          </button>
        </header>

        <div style={body}>
          {loading ? (
            <div style={centerMsg}>
              <Loader2 size={22} className="animate-spin" /> กำลังโหลดรายการที่ค้างจ่าย…
            </div>
          ) : done ? (
            <div style={{ ...centerMsg, color: "var(--dc-ink, #1c2533)", flexDirection: "column", gap: 10 }}>
              <CheckCircle2 size={40} color="#167a41" />
              <div style={{ fontSize: 16, fontWeight: 700 }}>จ่ายแล้ว {done.count} ใบ</div>
              <div style={{ fontSize: 13, color: "var(--dc-muted, #5b6676)" }}>ระบบบันทึกการจ่ายเรียบร้อย · สถานะใบจะปลดล็อกขั้นต่อไป</div>
              <button type="button" onClick={load} style={ghostBtn}>โหลดรายการที่ยังค้างใหม่</button>
              <button type="button" onClick={onClose} style={{ ...primaryBtn, marginTop: 4 }}>ปิด</button>
            </div>
          ) : (
            <>
              <PayGroup
                title="ค่าของ (จ่ายตอนของถึงไทย)"
                icon={<PackageCheck size={16} />}
                rows={goods}
                kind="GOODS"
                total={goodsTotal}
                onTick={(poId, ticked) => patchRow("GOODS", poId, { ticked })}
                onAmount={(poId, baht) => patchRow("GOODS", poId, { baht })}
              />
              <PayGroup
                title="ค่าขนส่งในไทย (จ่ายตอนของถึงโกดัง)"
                icon={<Truck size={16} />}
                rows={freight}
                kind="THAI_FREIGHT"
                total={freightTotal}
                onTick={(poId, ticked) => patchRow("THAI_FREIGHT", poId, { ticked })}
                onAmount={(poId, baht) => patchRow("THAI_FREIGHT", poId, { baht })}
              />

              {error && (
                <p style={{ color: "#dc2626", fontSize: 14, fontWeight: 600, margin: "4px 0 0", display: "flex", gap: 6, alignItems: "center" }}>
                  <AlertCircle size={16} /> {error}
                </p>
              )}
            </>
          )}
        </div>

        {/* footer สรุป + จ่าย (ซ่อนตอน loading/done) */}
        {!loading && !done && (
          <footer style={foot}>
            {!confirm ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                  <span style={{ fontSize: 13.5, color: "var(--dc-muted, #5b6676)" }}>
                    เลือก {pickedCount} ใบ
                  </span>
                  <span style={{ fontSize: 22, fontWeight: 820, color: "var(--dc-ink, #1c2533)", fontVariantNumeric: "tabular-nums" }}>
                    ฿{fmtBaht(grandTotal)}
                  </span>
                </div>
                <button
                  type="button"
                  className="dc-btn-xl"
                  disabled={pickedCount === 0 || grandTotal <= 0}
                  onClick={() => setConfirm(true)}
                  style={{ width: "100%" }}
                >
                  จ่ายทั้งหมด {pickedCount > 0 ? `(${pickedCount} ใบ · ฿${fmtBaht(grandTotal)})` : ""}
                </button>
              </>
            ) : (
              // ขั้นยืนยัน (เงิน — กันจ่ายพลาด)
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 14, color: "var(--dc-ink, #1c2533)", fontWeight: 600 }}>
                  ยืนยันจ่าย {pickedCount} ใบ รวม <b>฿{fmtBaht(grandTotal)}</b> ?
                </div>
                <div style={{ fontSize: 12.5, color: "var(--dc-muted, #5b6676)" }}>
                  {goodsPicked.length > 0 && <>ค่าของ {goodsPicked.length} ใบ ฿{fmtBaht(goodsTotal)}</>}
                  {goodsPicked.length > 0 && freightPicked.length > 0 && " · "}
                  {freightPicked.length > 0 && <>ค่าขนส่ง {freightPicked.length} ใบ ฿{fmtBaht(freightTotal)}</>}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="dc-btn-xl dc-btn-xl--ghost" onClick={() => setConfirm(false)} disabled={pending} style={{ flex: "0 0 auto" }}>
                    กลับไปแก้
                  </button>
                  <button type="button" className="dc-btn-xl" onClick={submit} disabled={pending} style={{ flex: 1 }}>
                    {pending ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                    ยืนยันจ่าย
                  </button>
                </div>
              </div>
            )}
          </footer>
        )}
      </aside>
    </div>
  );
}

/* ── 1 กลุ่ม (ค่าของ / ค่าขนส่ง) ── */
function PayGroup({
  title,
  icon,
  rows,
  kind,
  total,
  onTick,
  onAmount,
}: {
  title: string;
  icon: React.ReactNode;
  rows: EditableRow[];
  kind: Kind;
  total: number;
  onTick: (poId: string, ticked: boolean) => void;
  onAmount: (poId: string, baht: string) => void;
}) {
  return (
    <section style={{ display: "grid", gap: 8, marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 14, fontWeight: 800, color: "var(--dc-ink, #1c2533)" }}>
          {icon} {title}
        </span>
        <span style={{ fontSize: 12.5, color: "var(--dc-muted, #5b6676)" }}>{rows.length} ใบค้าง</span>
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--dc-subtle, #8a94a3)", padding: "12px 10px", background: "var(--color-brand-50, #f7faff)", borderRadius: 10, textAlign: "center" }}>
          ไม่มีใบค้างจ่ายกลุ่มนี้
        </div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {rows.map((r) => (
            <PayRow key={r.poId} row={r} onTick={(t) => onTick(r.poId, t)} onAmount={(b) => onAmount(r.poId, b)} />
          ))}
          <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 13, color: "var(--dc-muted, #5b6676)", paddingTop: 2, fontVariantNumeric: "tabular-nums" }}>
            รวมกลุ่มนี้: <b style={{ color: "var(--dc-ink, #1c2533)", marginLeft: 6 }}>฿{fmtBaht(total)}</b>
          </div>
        </div>
      )}
    </section>
  );
}

/* ── 1 แถว: ติ๊ก + ใบ + ยอด (แก้ได้) ── */
function PayRow({
  row,
  onTick,
  onAmount,
}: {
  row: EditableRow;
  onTick: (ticked: boolean) => void;
  onAmount: (baht: string) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 11px",
        borderRadius: 11,
        border: `1.5px solid ${row.ticked ? "var(--color-brand-300, #a9c2ec)" : "var(--dc-line, #e7ebf2)"}`,
        background: row.ticked ? "var(--color-brand-50, #eef3fb)" : "#fff",
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={row.ticked}
        onChange={(e) => onTick(e.target.checked)}
        style={{ width: 18, height: 18, accentColor: "var(--color-brand-600, #2563eb)", flex: "0 0 auto" }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--dc-ink, #1c2533)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.title ?? row.supplierName ?? "— ไม่ระบุผู้ขาย —"}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--dc-muted, #5b6676)", fontVariantNumeric: "tabular-nums" }}>
          {row.title ? `${row.poCode} · ${row.supplierName ?? "ไม่ระบุผู้ขาย"}` : row.poCode}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, flex: "0 0 auto" }} onClick={(e) => e.preventDefault()}>
        <span style={{ fontSize: 14, color: "var(--dc-muted, #5b6676)" }}>฿</span>
        <input
          value={row.baht}
          onChange={(e) => onAmount(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          inputMode="decimal"
          style={{
            width: 96,
            height: 36,
            borderRadius: 8,
            border: "1px solid var(--dc-line, #e7ebf2)",
            padding: "0 9px",
            fontSize: 14,
            textAlign: "right",
            fontWeight: 700,
            color: "var(--dc-ink, #1c2533)",
            background: "#fff",
            fontVariantNumeric: "tabular-nums",
            outline: "none",
          }}
          aria-label={`ยอดจ่าย ${row.poCode}`}
        />
      </div>
    </label>
  );
}

/* ── styles ── */
const panel: React.CSSProperties = {
  position: "absolute",
  top: 0,
  right: 0,
  height: "100%",
  width: "min(520px, 100vw)",
  background: "var(--dc-bg, #faf7f1)",
  borderLeft: "1px solid var(--dc-line, #e7ebf2)",
  boxShadow: "-12px 0 40px rgba(20,30,60,.16)",
  display: "flex",
  flexDirection: "column",
  animation: "dcDrawerIn .18s ease-out",
};

const head: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
  padding: "16px 18px",
  borderBottom: "1px solid var(--dc-line, #e7ebf2)",
  background: "#fff",
  flex: "0 0 auto",
};

const closeBtn: React.CSSProperties = {
  flex: "0 0 auto",
  height: 36,
  width: 36,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 10,
  border: "1px solid var(--dc-line, #e7ebf2)",
  background: "#fff",
  color: "var(--dc-muted, #5b6676)",
  cursor: "pointer",
};

const body: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "16px 18px",
  WebkitOverflowScrolling: "touch",
};

const foot: React.CSSProperties = {
  flex: "0 0 auto",
  padding: "14px 18px calc(14px + env(safe-area-inset-bottom, 0px))",
  borderTop: "1px solid var(--dc-line, #e7ebf2)",
  background: "#fff",
};

const centerMsg: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "60px 16px",
  color: "var(--dc-muted, #5b6676)",
  fontSize: 14,
};

const primaryBtn: React.CSSProperties = {
  height: 44,
  borderRadius: 11,
  border: "none",
  background: "var(--color-brand-600, #2563eb)",
  color: "#fff",
  fontSize: 14.5,
  fontWeight: 700,
  cursor: "pointer",
  padding: "0 22px",
};

const ghostBtn: React.CSSProperties = {
  height: 38,
  borderRadius: 10,
  border: "1px solid var(--color-brand-200, #c9d8f0)",
  background: "var(--color-brand-50, #eef3fb)",
  color: "var(--dc-blue-strong, #1d4ed8)",
  fontSize: 13.5,
  fontWeight: 600,
  cursor: "pointer",
  padding: "0 16px",
};
