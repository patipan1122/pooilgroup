"use client";

// DC · รายละเอียดใบรับสินค้า (GRN) + ต้นทุนนำเข้าต่อบรรทัด (จาก cost layers) +
// สถานะ TRCloud + ปุ่มดำเนินการ:
//   • ยังไม่ลงบัญชี (ไม่มี cost layer) → "ลงรับเข้า + คิดต้นทุน" (postGrn)
//   • PENDING/FAILED (ลงแล้วแต่ TRCloud ยังไม่สำเร็จ) → "ดันเข้า TRCloud อีกครั้ง" (retryTrcloud)
//   • POSTED → ไม่มีปุ่ม (จบ)
// ภาษีซื้อขอคืน (VAT claimable) แสดงแยก = "ไม่รวมต้นทุน" (capitalised คือ landed-unit).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Receipt } from "lucide-react";
import { postGrn, retryTrcloud } from "@/lib/dc/grn-actions";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";

export type GrnLineCost = {
  goodsThbSatang: number;
  dutyThbSatang: number;
  freightThbSatang: number;
  brokerThbSatang: number;
  insuranceThbSatang: number;
  landedUnitSatang: number;
  vatClaimableSatang: number;
  qty: number;
};

export type GrnLineData = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  qtyExpected: number;
  qtyReceived: number;
  qtyDamaged: number;
  note: string | null;
  cost: GrnLineCost | null;
};

export type GrnDetailData = {
  id: string;
  grnCode: string;
  postStatus: string;
  note: string | null;
  receivedAt: string;
  warehouseName: string | null;
  poCode: string | null;
  shipmentId: string | null;
  shipmentCode: string | null;
  lines: GrnLineData[];
};

const POST_TONE: Record<string, "neutral" | "brand" | "success" | "warning" | "danger" | "info"> = {
  PENDING: "warning",
  POSTED: "success",
  FAILED: "danger",
  NA: "neutral",
};
const POST_LABEL: Record<string, string> = {
  PENDING: "รอลงบัญชี",
  POSTED: "ลง TRCloud แล้ว",
  FAILED: "ส่งไม่สำเร็จ",
  NA: "ไม่เกี่ยวข้อง",
};

function fmtMoney(satang: number): string {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(satang / 100);
}
function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function GrnDetail({ data, canManage }: { data: GrnDetailData; canManage: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const hasCost = data.lines.some((l) => l.cost != null);
  const status = data.postStatus;

  function doPost() {
    if (!window.confirm("ยืนยันลงรับเข้า + คิดต้นทุนนำเข้า + ตัดสต๊อก + ส่ง TRCloud?")) return;
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const res = await postGrn(data.id);
      if (res.ok) {
        const t = res.trcloud;
        setInfo(
          t.posted
            ? `ลงรับเข้าสำเร็จ + ส่ง TRCloud แล้ว${t.docNo ? ` (เลขที่ ${t.docNo})` : ""}`
            : `ลงรับเข้า + คิดต้นทุนสำเร็จ — แต่ยังไม่เข้า TRCloud: ${t.reason ?? t.error ?? "รอส่งใหม่"}`,
        );
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function doRetry() {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const res = await retryTrcloud(data.id);
      if (res.ok && res.posted) {
        setInfo(`ส่ง TRCloud สำเร็จ${res.docNo ? ` (เลขที่ ${res.docNo})` : ""}`);
      } else {
        const reason = "reason" in res ? res.reason : undefined;
        setError(res.error ?? reason ?? "ยังส่ง TRCloud ไม่สำเร็จ");
      }
      router.refresh();
    });
  }

  // ยอดรวมต้นทุนที่ทุน (ไม่รวม VAT) + VAT ขอคืน (แยก)
  const totalLandedSatang = data.lines.reduce(
    (s, l) => s + (l.cost ? l.cost.landedUnitSatang * l.cost.qty : 0),
    0,
  );
  const totalVatSatang = data.lines.reduce((s, l) => s + (l.cost ? l.cost.vatClaimableSatang : 0), 0);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* หัวใบ + สถานะ + ปุ่ม */}
      <div className="dc-card" style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <StatusPill tone={POST_TONE[status] ?? "neutral"} dot>
              {POST_LABEL[status] ?? status}
            </StatusPill>
            <div style={{ display: "grid", gap: 2, fontSize: 14, color: "#52525b", marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
              <div>คลัง: <b style={{ color: "#18181b" }}>{data.warehouseName ?? "—"}</b></div>
              <div>ใบสั่งซื้อ: {data.poCode ?? "—"}</div>
              <div>
                ชิปเมนต์:{" "}
                {data.shipmentId ? (
                  <a href={`/dc/office/shipments/${data.shipmentId}`} style={{ color: "var(--color-brand-700, #1d4ed8)", fontWeight: 600 }}>
                    {data.shipmentCode}
                  </a>
                ) : (
                  "—"
                )}
              </div>
              <div>รับเมื่อ: {fmtDateTime(data.receivedAt)}</div>
              {data.note && <div>โน้ต: {data.note}</div>}
            </div>
          </div>

          {canManage && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
              {!hasCost && status !== "POSTED" && (
                <Button size="lg" loading={pending} onClick={doPost}>
                  ลงรับเข้า + คิดต้นทุน
                </Button>
              )}
              {hasCost && (status === "PENDING" || status === "FAILED") && (
                <Button size="lg" variant="outline" loading={pending} onClick={doRetry}>
                  ดันเข้า TRCloud อีกครั้ง
                </Button>
              )}
            </div>
          )}
        </div>

        {error && <p style={{ color: "var(--color-danger, #dc2626)", fontSize: 14, fontWeight: 600 }}>{error}</p>}
        {info && <p style={{ color: "var(--color-success, #16a34a)", fontSize: 14, fontWeight: 600 }}>{info}</p>}
      </div>

      {/* รายการ + ต้นทุนนำเข้าต่อบรรทัด */}
      <div className="dc-card" style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#71717a", background: "#fafafa" }}>
              <th style={cellHead}>สินค้า</th>
              <th style={{ ...cellHead, textAlign: "right" }}>คาดหวัง</th>
              <th style={{ ...cellHead, textAlign: "right" }}>รับจริง</th>
              <th style={{ ...cellHead, textAlign: "right" }}>เสียหาย</th>
              <th style={{ ...cellHead, textAlign: "right" }}>ต้นทุน/ชิ้น (รวมถึงคลัง)</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => {
              const diff = l.qtyExpected > 0 ? l.qtyReceived - l.qtyExpected : 0;
              return (
                <tr key={l.id} style={{ borderTop: "1px solid var(--dc-line, #f0f0f2)", verticalAlign: "top" }}>
                  <td style={cell}>
                    <div style={{ fontWeight: 600, color: "#18181b" }}>{l.name}</div>
                    <div style={{ fontSize: 12, color: "#a1a1aa", fontVariantNumeric: "tabular-nums" }}>{l.sku}</div>
                    {l.note && <div style={{ fontSize: 12, color: "#a1a1aa" }}>{l.note}</div>}
                    {diff !== 0 && (
                      <div style={{ fontSize: 12, fontWeight: 600, color: diff < 0 ? "var(--color-danger, #dc2626)" : "var(--color-brand-700, #1d4ed8)" }}>
                        {diff < 0 ? `รับขาด ${Math.abs(diff)}` : `รับเกิน ${diff}`}
                      </div>
                    )}
                  </td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#52525b" }}>{l.qtyExpected}</td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{l.qtyReceived} {l.unit}</td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", color: l.qtyDamaged > 0 ? "var(--color-danger, #dc2626)" : "#a1a1aa" }}>
                    {l.qtyDamaged}
                  </td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {l.cost ? (
                      <div style={{ display: "grid", gap: 2 }}>
                        <div style={{ fontWeight: 800, fontSize: 15 }}>฿{fmtMoney(l.cost.landedUnitSatang)}</div>
                        <div style={{ fontSize: 11, color: "#71717a", lineHeight: 1.5 }}>
                          สินค้า ฿{fmtMoney(l.cost.goodsThbSatang)} · ภาษีนำเข้า ฿{fmtMoney(l.cost.dutyThbSatang)}
                          <br />
                          ขนส่ง ฿{fmtMoney(l.cost.freightThbSatang)} · ชิปปิ้ง ฿{fmtMoney(l.cost.brokerThbSatang)} · ประกัน ฿{fmtMoney(l.cost.insuranceThbSatang)}
                        </div>
                        {l.cost.vatClaimableSatang > 0 && (
                          <div style={{ fontSize: 11, color: "var(--color-brand-700, #1d4ed8)" }}>
                            ภาษีซื้อขอคืน ฿{fmtMoney(l.cost.vatClaimableSatang)} — ไม่รวมต้นทุน
                          </div>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: "#a1a1aa", fontSize: 13 }}>ยังไม่คิดต้นทุน</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {hasCost && (
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--dc-line, #e4e4e7)", background: "#fafafa" }}>
                <td style={cell} colSpan={4}>
                  <b>รวมมูลค่าต้นทุน (ทุนเข้าคลัง)</b>
                  <div style={{ fontSize: 12, color: "#71717a", marginTop: 2 }}>
                    ภาษีซื้อขอคืนรวม ฿{fmtMoney(totalVatSatang)} — แยกต่างหาก ไม่รวมในต้นทุน
                  </div>
                </td>
                <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>฿{fmtMoney(totalLandedSatang)}</div>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {!hasCost && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#71717a" }}>
          <Receipt size={15} /> ใบนี้ยังไม่ได้ลงรับเข้า — กด "ลงรับเข้า + คิดต้นทุน" เพื่อคิดต้นทุนนำเข้า ตัดสต๊อก และส่ง TRCloud
        </div>
      )}
    </div>
  );
}

const cellHead: React.CSSProperties = {
  padding: "10px 14px",
  fontSize: 12,
  fontWeight: 700,
  whiteSpace: "nowrap",
};
const cell: React.CSSProperties = {
  padding: "12px 14px",
  verticalAlign: "top",
};
