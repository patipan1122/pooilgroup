"use client";

import { useMemo, useState } from "react";
import { Info, AlertTriangle } from "lucide-react";
import { Pill, IconBox } from "@/components/clawfleet/os/kit";
import { bahtN, type Tone } from "@/components/clawfleet/os/format";

/* ── สถานะคำขอตั้งค่าตู้ ── */
type CfStatus = "pending" | "approved" | "rejected";

type ConfigRequest = {
  id: string;
  machine: string; // รหัสตู้ เช่น "RS-03"
  branch: string; // ชื่อสาขา
  staff: string; // ผู้เสนอ
  time: string; // เวลาที่เสนอ
  status: CfStatus;
  clawFrom: number; // ความแรงการคีบเดิม
  clawTo: number; // ความแรงการคีบที่เสนอ
  product: string; // สินค้าในตู้
  priceBaht: number; // ราคาขายตั้งไว้ (บาทเต็ม)
  reason: string; // เหตุผล
};

const STATUS_META: Record<CfStatus, { label: string; tone: Tone }> = {
  pending: { label: "รอตรวจ", tone: "amber" },
  approved: { label: "อนุมัติแล้ว", tone: "green" },
  rejected: { label: "ตีกลับ", tone: "red" },
};

/* ── SAMPLE คำขอตั้งค่าตู้ (หน้านี้ยังไม่มี backend table — ดู RETURN/backend gap) ── */
const SAMPLE_REQUESTS: ConfigRequest[] = [
  {
    id: "s1",
    machine: "RS-03",
    branch: "รังสิต",
    staff: "สมชาย ก.",
    time: "วันนี้ 09:42",
    status: "pending",
    clawFrom: 55,
    clawTo: 70,
    product: "หมีบราวน์ ไซต์ L",
    priceBaht: 250,
    reason: "ตู้ออกง่ายเกินไป ลูกค้าคีบได้ทุกครั้ง ต้นทุนตุ๊กตาเฉลี่ยต่ำกว่าราคาขายมาก ขอเพิ่มความแรงให้สมดุล",
  },
  {
    id: "s2",
    machine: "NB-02",
    branch: "นนทบุรี",
    staff: "วราภรณ์ ส.",
    time: "วันนี้ 08:15",
    status: "pending",
    clawFrom: 80,
    clawTo: 65,
    product: "ยูนิคอร์น พาสเทล",
    priceBaht: 200,
    reason: "ตู้ยากเกินไป ไม่มีตุ๊กตาออก 3 วัน ลูกค้าเริ่มบ่น ขอลดความแรงเพื่อให้คีบได้บ้าง",
  },
  {
    id: "s3",
    machine: "LP-01",
    branch: "ลาดพร้าว",
    staff: "ธีรพงษ์ ม.",
    time: "เมื่อวาน 17:30",
    status: "pending",
    clawFrom: 60,
    clawTo: 72,
    product: "แมวเหมียวชมพู",
    priceBaht: 300,
    reason: "เปลี่ยนตุ๊กตาใหม่ราคาต้นทุนสูงขึ้น ขอปรับความแรงและราคาขายให้คุ้มทุน",
  },
  {
    id: "s4",
    machine: "BK-05",
    branch: "บางแค",
    staff: "อนุชา ป.",
    time: "เมื่อวาน 11:08",
    status: "approved",
    clawFrom: 50,
    clawTo: 68,
    product: "ไดโนเสาร์เขียว",
    priceBaht: 250,
    reason: "อัตราตุ๊กตาออกสูงผิดปกติ ปรับความแรงตามรอบที่แล้ว เจ้าของอนุมัติ",
  },
  {
    id: "s5",
    machine: "BN-04",
    branch: "บางนา",
    staff: "กิตติ ว.",
    time: "2 วันก่อน",
    status: "rejected",
    clawFrom: 75,
    clawTo: 90,
    product: "หมีบราวน์ ไซต์ M",
    priceBaht: 200,
    reason: "ขอเพิ่มความแรงสูงเกินเกณฑ์ เสี่ยงตู้ยากเกินจนลูกค้าเลิกเล่น เจ้าของตีกลับให้ตั้งไม่เกิน 75",
  },
];

export function ConfigClient({
  branches,
}: {
  branches: { id: string; name: string; code: string }[];
}) {
  // หน้านี้ sample-driven เสมอ (ยังไม่มี table จริง) → state เริ่มจาก SAMPLE
  const [requests, setRequests] = useState<ConfigRequest[]>(SAMPLE_REQUESTS);

  const pendingCount = useMemo(
    () => requests.filter((r) => r.status === "pending").length,
    [requests],
  );

  // optimistic: อัปเดตสถานะคำขอในฝั่ง client (sample id → ไม่เรียก action จริง)
  function decide(id: string, next: Extract<CfStatus, "approved" | "rejected">) {
    const req = requests.find((r) => r.id === id);
    if (!req) return;
    const verb = next === "approved" ? "อนุมัติให้ตั้งค่า" : "ตีกลับคำขอ";
    if (!window.confirm(`${verb}ตู้ ${req.machine} (${req.branch}) ?`)) return;
    setRequests((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: next } : r)),
    );
  }

  return (
    <div>
      {/* แบนเนอร์ตัวอย่าง — หน้านี้ยังไม่มีข้อมูลจริง (ไม่มี cf_config_request table) */}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          background: "#FCF8EC",
          border: "1px solid #F0E2BE",
          borderRadius: 10,
          padding: "9px 14px",
          marginBottom: 16,
          fontSize: 12,
          color: "#7A5510",
        }}
      >
        <AlertTriangle size={15} style={{ flex: "0 0 15px" }} />
        <span>
          ยังไม่มีระบบคำขอตั้งค่าตู้ในฐานข้อมูล — กำลังแสดง<b> ตัวอย่าง</b>{" "}
          เพื่อให้เห็นภาพการอนุมัติ ({branches.length > 0 ? `${branches.length} สาขาในระบบจริง` : "ยังไม่มีสาขาจริง"})
        </span>
      </div>

      {/* แบนเนอร์อธิบายขั้นตอน (amber) — พนักงานเสนอ → รอตรวจ จนเจ้าของอนุมัติ */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "#FCF8EC",
          border: "1px solid #F0E2BE",
          borderRadius: 12,
          padding: "13px 18px",
          marginBottom: 18,
        }}
      >
        <IconBox tone="amber" size={30} radius={9}>
          <Info size={16} />
        </IconBox>
        <span style={{ fontSize: 13, color: "#7A5510", lineHeight: 1.5 }}>
          พนักงานเก็บเงินเป็นผู้เสนอตั้งค่าตู้ — คำขอจะอยู่สถานะ{" "}
          <b>“รอตรวจ”</b> จนกว่าเจ้าของจะกดอนุมัติ
          {pendingCount > 0 && (
            <>
              {" · "}
              <b className="num">{pendingCount}</b> คำขอรอตรวจ
            </>
          )}
        </span>
      </div>

      {/* รายการคำขอตั้งค่าตู้ */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {requests.map((cf) => {
          const sm = STATUS_META[cf.status];
          const isPending = cf.status === "pending";
          return (
            <div
              key={cf.id}
              style={{
                background: "#fff",
                border: "1px solid #E8EAED",
                borderRadius: 14,
                padding: "18px 22px",
              }}
            >
              {/* หัวการ์ด: รหัสตู้ + สาขา + ผู้เสนอ + สถานะ */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <span
                  className="num"
                  style={{
                    width: 40,
                    height: 40,
                    flex: "0 0 40px",
                    borderRadius: 10,
                    background: "#F1F2F7",
                    color: "#4F46E5",
                    fontSize: 12.5,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {cf.machine}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700 }}>
                    ตู้ {cf.machine} · {cf.branch}
                  </div>
                  <div style={{ fontSize: 11.5, color: "#9AA1AB" }}>
                    เสนอโดย {cf.staff} · {cf.time}
                  </div>
                </div>
                <Pill tone={sm.tone}>{sm.label}</Pill>
              </div>

              {/* กริดสรุปค่าที่เสนอ — ความแรงคีบ / สินค้า / ราคาขาย */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mb-4">
                <div style={{ background: "#F8F9FB", borderRadius: 11, padding: "12px 14px" }}>
                  <div style={{ fontSize: 10.5, color: "#9AA1AB", marginBottom: 7 }}>ปรับความแรงการคีบ</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <span
                      className="num"
                      style={{ fontSize: 14, fontWeight: 600, color: "#9AA1AB", textDecoration: "line-through" }}
                    >
                      {cf.clawFrom}
                    </span>
                    <span style={{ color: "#4F46E5" }}>→</span>
                    <span className="num" style={{ fontSize: 15, fontWeight: 700, color: "#4F46E5" }}>
                      {cf.clawTo}
                    </span>
                  </div>
                </div>
                <div style={{ background: "#F8F9FB", borderRadius: 11, padding: "12px 14px" }}>
                  <div style={{ fontSize: 10.5, color: "#9AA1AB", marginBottom: 7 }}>สินค้าในตู้</div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{cf.product}</div>
                </div>
                <div style={{ background: "#F8F9FB", borderRadius: 11, padding: "12px 14px" }}>
                  <div style={{ fontSize: 10.5, color: "#9AA1AB", marginBottom: 7 }}>ราคาขายตั้งไว้</div>
                  <div className="num" style={{ fontSize: 15, fontWeight: 700 }}>{bahtN(cf.priceBaht)}</div>
                </div>
              </div>

              {/* เหตุผล */}
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  fontSize: 12.5,
                  background: "#FCEDEC",
                  borderRadius: 10,
                  padding: "11px 14px",
                  marginBottom: isPending ? 16 : 0,
                }}
              >
                <AlertTriangle size={15} color="#B42318" style={{ flex: "0 0 15px", marginTop: 1 }} />
                <span style={{ color: "#9B3127" }}>
                  <b>เหตุผล:</b> {cf.reason}
                </span>
              </div>

              {/* ปุ่ม (เฉพาะ pending) — ตีกลับ / อนุมัติ */}
              {isPending && (
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => decide(cf.id, "rejected")}
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#B42318",
                      background: "#fff",
                      border: "1px solid #F0CFCB",
                      padding: "9px 18px",
                      borderRadius: 9,
                      cursor: "pointer",
                    }}
                  >
                    ตีกลับ
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(cf.id, "approved")}
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#fff",
                      background: "#15803D",
                      border: "none",
                      padding: "9px 18px",
                      borderRadius: 9,
                      cursor: "pointer",
                    }}
                  >
                    อนุมัติให้ตั้งค่า
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
