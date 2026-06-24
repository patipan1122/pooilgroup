"use client";

// DC · รายละเอียดชิปเมนต์ + ตัวแก้ "ค่าขนส่ง/ต้นทุนนำเข้า" + คุมสถานะ.
//   • ช่องต้นทุน = บาท (input) → แปลงเป็น satang ตอนบันทึก (Math.round(baht*100))
//   • สถานะ: PREPARING → IN_TRANSIT → ARRIVED → RECEIVED (เดินหน้า/ถอยได้)
//   • ปุ่ม "สร้างใบรับสินค้า (GRN)" → /dc/office/receipts/new?shipmentId=...

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateShipmentCosts,
  setShipmentStatus,
  type ShipmentActionResult,
} from "@/lib/dc/shipment-actions";
import { SHIPMENT_STATUS_LABEL } from "@/lib/dc/nav";
import { DcShipmentStatus } from "@/lib/generated/prisma/enums";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export type ShipmentLineData = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  qty: number;
  cbm: number | null;
};

export type ShipmentDetailData = {
  id: string;
  shipmentCode: string;
  status: string;
  mode: string;
  trackingNo: string | null;
  cbmTotal: number | null;
  chinaFreightThbSatang: number;
  intlFreightThbSatang: number;
  dutyThbSatang: number;
  brokerThbSatang: number;
  insuranceThbSatang: number;
  fxRate: number | null;
  fxDate: string | null;
  etd: string | null;
  eta: string | null;
  note: string | null;
  createdAt: string;
  poCode: string | null;
  lines: ShipmentLineData[];
  grns: { id: string; grnCode: string; postStatus: string }[];
};

const STATUS_TONE: Record<string, "neutral" | "brand" | "success" | "warning" | "danger" | "info"> = {
  PREPARING: "neutral",
  IN_TRANSIT: "warning",
  ARRIVED: "info",
  RECEIVED: "success",
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
const MODE_LABEL: Record<string, string> = { TRUCK: "รถบรรทุก", SEA: "เรือ" };

// ลำดับสถานะถัดไป (เดินหน้าทีละขั้น)
const NEXT_STATUS: Record<string, DcShipmentStatus | null> = {
  PREPARING: DcShipmentStatus.IN_TRANSIT,
  IN_TRANSIT: DcShipmentStatus.ARRIVED,
  ARRIVED: DcShipmentStatus.RECEIVED,
  RECEIVED: null,
};

function fmtMoney(satang: number): string {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(satang / 100);
}
function fmtNum(n: number, d = 4): string {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" }).format(new Date(iso));
}
function satangToBaht(satang: number): string {
  return satang > 0 ? String(satang / 100) : "";
}
function bahtToSatang(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}
function toDateInput(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
}

export function ShipmentDetail({
  data,
  canManage,
}: {
  data: ShipmentDetailData;
  canManage: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // ── ตัวแก้ค่าขนส่ง/ต้นทุน (บาท) ──
  const [china, setChina] = useState(satangToBaht(data.chinaFreightThbSatang));
  const [intl, setIntl] = useState(satangToBaht(data.intlFreightThbSatang));
  const [duty, setDuty] = useState(satangToBaht(data.dutyThbSatang));
  const [broker, setBroker] = useState(satangToBaht(data.brokerThbSatang));
  const [insurance, setInsurance] = useState(satangToBaht(data.insuranceThbSatang));
  const [fxRate, setFxRate] = useState(data.fxRate != null ? String(data.fxRate) : "");
  const [fxDate, setFxDate] = useState(toDateInput(data.fxDate));
  const [costMsg, setCostMsg] = useState<string | null>(null);

  function run(action: () => Promise<ShipmentActionResult>, confirmMsg?: string, onOk?: () => void) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        onOk?.();
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function saveCosts() {
    setCostMsg(null);
    run(
      () =>
        updateShipmentCosts(data.id, {
          chinaFreightThbSatang: bahtToSatang(china),
          intlFreightThbSatang: bahtToSatang(intl),
          dutyThbSatang: bahtToSatang(duty),
          brokerThbSatang: bahtToSatang(broker),
          insuranceThbSatang: bahtToSatang(insurance),
          fxRate: Number(fxRate) > 0 ? Number(fxRate) : null,
          fxDate: fxDate || null,
        }),
      undefined,
      () => setCostMsg("บันทึกค่าขนส่ง/ต้นทุนนำเข้าแล้ว"),
    );
  }

  const status = data.status;
  const next = NEXT_STATUS[status] ?? null;
  const totalCostSatang =
    data.chinaFreightThbSatang +
    data.intlFreightThbSatang +
    data.dutyThbSatang +
    data.brokerThbSatang +
    data.insuranceThbSatang;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* หัว + สถานะ + ปุ่ม */}
      <div className="dc-card" style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <StatusPill tone={STATUS_TONE[status] ?? "neutral"} dot>
              {SHIPMENT_STATUS_LABEL[status] ?? status}
            </StatusPill>
            <div style={{ display: "grid", gap: 2, fontSize: 14, color: "#52525b", marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
              <div>ขนส่งโดย: <b style={{ color: "#18181b" }}>{MODE_LABEL[data.mode] ?? data.mode}</b></div>
              <div>Tracking: {data.trackingNo ?? "—"}</div>
              <div>ใบสั่งซื้อ: {data.poCode ?? "—"}</div>
              <div>ETD: {fmtDate(data.etd)} · ETA: {fmtDate(data.eta)}</div>
              {data.note && <div>โน้ต: {data.note}</div>}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
            {canManage && next && (
              <Button
                size="lg"
                loading={pending}
                onClick={() => run(() => setShipmentStatus(data.id, next))}
              >
                → {SHIPMENT_STATUS_LABEL[next] ?? next}
              </Button>
            )}
            <Button
              size="lg"
              variant="outline"
              onClick={() => router.push(`/dc/office/receipts/new?shipmentId=${data.id}`)}
              disabled={pending}
            >
              สร้างใบรับสินค้า (GRN)
            </Button>
          </div>
        </div>

        {error && <p style={{ color: "var(--color-danger, #dc2626)", fontSize: 14, fontWeight: 600 }}>{error}</p>}

        <div style={{ display: "grid", gap: 4, fontSize: 13, color: "#71717a", borderTop: "1px solid var(--dc-line, #f0f0f2)", paddingTop: 12, fontVariantNumeric: "tabular-nums" }}>
          <div>สร้างเมื่อ: {fmtDate(data.createdAt)}</div>
          <div>ปริมาตรรวม: <b style={{ color: "#18181b" }}>{data.cbmTotal != null ? `${fmtNum(data.cbmTotal)} m³` : "—"}</b></div>
        </div>
      </div>

      {/* ค่าขนส่ง/ต้นทุนนำเข้า */}
      <div className="dc-card" style={{ display: "grid", gap: 14 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>ค่าขนส่ง / ต้นทุนนำเข้า</div>
          <div style={{ fontSize: 13, color: "#71717a", marginTop: 2 }}>
            ใส่ยอดเป็น "บาท" · ระบบจะหารเฉลี่ยลงต้นทุนสินค้าแต่ละชิ้นตาม CBM/มูลค่า ตอนรับเข้า (GRN)
          </div>
        </div>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <Field label="ค่าขนส่งในจีน (บาท)" optional htmlFor="c-china">
            <Input id="c-china" value={china} onChange={(e) => setChina(e.target.value)} inputMode="decimal" placeholder="0.00" disabled={!canManage} />
          </Field>
          <Field label="ค่าขนส่งระหว่างประเทศ (บาท)" optional htmlFor="c-intl">
            <Input id="c-intl" value={intl} onChange={(e) => setIntl(e.target.value)} inputMode="decimal" placeholder="0.00" disabled={!canManage} />
          </Field>
          <Field label="ภาษีนำเข้า (บาท)" optional htmlFor="c-duty">
            <Input id="c-duty" value={duty} onChange={(e) => setDuty(e.target.value)} inputMode="decimal" placeholder="0.00" disabled={!canManage} />
          </Field>
          <Field label="ค่าชิปปิ้ง/ดำเนินพิธีการ (บาท)" optional htmlFor="c-broker">
            <Input id="c-broker" value={broker} onChange={(e) => setBroker(e.target.value)} inputMode="decimal" placeholder="0.00" disabled={!canManage} />
          </Field>
          <Field label="ค่าประกัน (บาท)" optional htmlFor="c-ins">
            <Input id="c-ins" value={insurance} onChange={(e) => setInsurance(e.target.value)} inputMode="decimal" placeholder="0.00" disabled={!canManage} />
          </Field>
          <Field label="อัตราแลกเปลี่ยน (THB/CNY)" optional htmlFor="c-fx">
            <Input id="c-fx" value={fxRate} onChange={(e) => setFxRate(e.target.value)} inputMode="decimal" placeholder="เช่น 5.05" disabled={!canManage} />
          </Field>
          <Field label="วันที่อัตราแลกเปลี่ยน" optional htmlFor="c-fxd">
            <Input id="c-fxd" type="date" value={fxDate} onChange={(e) => setFxDate(e.target.value)} disabled={!canManage} />
          </Field>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ fontSize: 14, color: "#52525b", fontVariantNumeric: "tabular-nums" }}>
            รวมต้นทุนนำเข้าที่บันทึกไว้: <b style={{ color: "#18181b" }}>฿{fmtMoney(totalCostSatang)}</b>
          </div>
          {canManage && (
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {costMsg && <span style={{ color: "var(--color-success, #16a34a)", fontSize: 13, fontWeight: 600 }}>{costMsg}</span>}
              <Button size="lg" loading={pending} onClick={saveCosts}>
                บันทึกค่าขนส่ง
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* รายการสินค้า */}
      <div className="dc-card" style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#71717a", background: "#fafafa" }}>
              <th style={cellHead}>สินค้า</th>
              <th style={{ ...cellHead, textAlign: "right" }}>จำนวน</th>
              <th style={{ ...cellHead, textAlign: "right" }}>CBM</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.id} style={{ borderTop: "1px solid var(--dc-line, #f0f0f2)" }}>
                <td style={cell}>
                  <div style={{ fontWeight: 600, color: "#18181b" }}>{l.name}</div>
                  <div style={{ fontSize: 12, color: "#a1a1aa", fontVariantNumeric: "tabular-nums" }}>{l.sku}</div>
                </td>
                <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.qty} {l.unit}</td>
                <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#52525b" }}>
                  {l.cbm != null ? fmtNum(l.cbm) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ใบรับสินค้าที่ผูกกับชิปเมนต์นี้ */}
      {data.grns.length > 0 && (
        <div className="dc-card" style={{ display: "grid", gap: 10 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>ใบรับสินค้าที่ผูกกับชิปเมนต์นี้</div>
          <div style={{ display: "grid", gap: 8 }}>
            {data.grns.map((g) => (
              <div key={g.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <a href={`/dc/office/receipts/${g.id}`} style={{ fontWeight: 700, color: "var(--color-brand-700, #1d4ed8)", fontVariantNumeric: "tabular-nums" }}>
                  {g.grnCode}
                </a>
                <StatusPill tone={POST_TONE[g.postStatus] ?? "neutral"} size="sm" dot>
                  {POST_LABEL[g.postStatus] ?? g.postStatus}
                </StatusPill>
              </div>
            ))}
          </div>
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
  verticalAlign: "middle",
};
