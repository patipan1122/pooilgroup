"use client";

/**
 * ตู้คีบ OS — ตรวจเงิน & กระทบยอด (Collections / Audit) · client island
 *
 * recreate design `ระบบตู้คีบ.dc.html` 599–696 เป๊ะ:
 *   control bar (สาขา select + status tabs) → 4-stat summary → list ของรอบเก็บ
 *   แต่ละแถวกดขยาย = drill-down: เส้นทางตุ๊กตา | เส้นทางเงิน + มิเตอร์ต่อเนื่อง
 *   + รูปมิเตอร์ 4 รูป + แนะนำ action + ปุ่ม review (ตรวจแล้ว/ยังไม่ตรวจ)
 *
 * หัวใจ = 3-way reconcile: มิเตอร์(ควรได้) ↔ เงินสด(นับได้) ↔ ส่วนต่าง
 *
 * WRITE: ปุ่ม review → reviewV2Session(id, decision, note) สำหรับ id จริง
 *        · id ตัวอย่าง (sample) → optimistic ฝั่ง client (ไม่เรียก action)
 */

import { useMemo, useState, useTransition } from "react";
import {
  Building2, AlertTriangle, Check, ChevronRight, Coins, Info, Maximize2, ImageOff,
  X, ZoomIn, SearchX, ShieldCheck, Download,
} from "lucide-react";
import { bahtN } from "@/components/clawfleet/os/format";
import { EmptyState } from "@/components/clawfleet/os/kit";
import { reviewV2Session, type V2Decision } from "@/lib/clawfleet/actions";
import { buildCsv } from "@/lib/clawfleet/csv";

/* ───────── types ───────── */
export type BranchOption = { value: string; label: string };

/** รูปจริงต่อตู้ที่พนักงานถ่ายตอนเก็บเงิน (anti-cheat) — label = ความหมายจริง */
export type CollectionMachine = {
  code: string;
  name: string;
  photoShots: { label: string; url: string | null }[];
};

export type CollectionRow = {
  id: string;
  code: string;
  /** id สาขาจริง — ใช้กรอง dropdown แบบตรงตัว (ไม่ใช่ substring ชื่อ) */
  branchId?: string;
  branch: string;
  staff: string;
  date: string;
  expectedCash: number; // บาท — มิเตอร์ควรได้
  actualCash: number; // บาท — เงินนับได้
  gap: number; // บาท — ส่วนต่าง เก็บทิศทาง: บวก = ขาด · ลบ = เกิน
  prizeExpected: number; // ตุ๊กตาควรหาย (มิเตอร์)
  prizeActual: number; // ตุ๊กตานับจริง
  prizeGap: number; // ตุ๊กตาหาย
  severity: "P0" | "P1" | "P2";
  type: "cash_short" | "prize_short";
  reason: string;
  /** มิเตอร์เหรียญรวมทั้งรอบจาก event จริง — มี = โชว์ delta×10 จริง · undefined/null = ประมาณจากยอด */
  coinMeterBefore?: number | null;
  coinMeterAfter?: number | null;
  /** ตู้ในรอบนี้ พร้อมรูปจริงต่อตู้ (real tier ส่งมา · sample = []) */
  machines: CollectionMachine[];
  sample: boolean;
};

type ReviewState = "pending" | "reviewed" | "rechecked" | "escalated";
type StatusKind = "match" | "diff" | "broken";

/* ───────── sample fallback (จาก design) ───────── */
const SAMPLE_BRANCHES: BranchOption[] = [
  { value: "all", label: "ทุกสาขา" },
  { value: "s-rs", label: "รังสิต (RS)" },
  { value: "s-lp", label: "ลาดพร้าว (LP)" },
  { value: "s-bk", label: "บางแค (BK)" },
];

const SAMPLE_ROWS: CollectionRow[] = [
  {
    id: "s-CFS-000041", code: "CFS-000041", branchId: "s-rs", branch: "รังสิต", staff: "น้องเอ", date: "12 นาทีที่แล้ว",
    expectedCash: 8400, actualCash: 5860, gap: 2540, prizeExpected: 32, prizeActual: 32, prizeGap: 0,
    severity: "P0", type: "cash_short", reason: "เงินสดน้อยกว่ามิเตอร์ ฿2,540 (30% ห่าง)", machines: [], sample: true,
  },
  {
    id: "s-CFS-000040", code: "CFS-000040", branchId: "s-lp", branch: "ลาดพร้าว", staff: "น้องบี", date: "40 นาทีที่แล้ว",
    expectedCash: 4200, actualCash: 4380, gap: -180, prizeExpected: 18, prizeActual: 18, prizeGap: 0,
    severity: "P1", type: "cash_short", reason: "เงินสดมากกว่ามิเตอร์ ฿180 — เงินเกิน ต้องสอบที่มา", machines: [], sample: true,
  },
  {
    id: "s-CFS-000038", code: "CFS-000038", branchId: "s-bk", branch: "บางแค", staff: "พี่สอง", date: "2 ชม.ที่แล้ว",
    expectedCash: 6100, actualCash: 6100, gap: 0, prizeExpected: 28, prizeActual: 22, prizeGap: 6,
    severity: "P0", type: "prize_short", reason: "ตุ๊กตาหาย 6 ตัว — มิเตอร์ตุ๊กตากับนับจริงไม่ตรง", machines: [], sample: true,
  },
  {
    id: "s-CFS-000035", code: "CFS-000035", branchId: "s-lp", branch: "ลาดพร้าว", staff: "น้องบี", date: "เมื่อวาน",
    expectedCash: 5400, actualCash: 5380, gap: 20, prizeExpected: 24, prizeActual: 24, prizeGap: 0,
    severity: "P2", type: "cash_short", reason: "ส่วนต่าง ฿20 อยู่ในเกณฑ์ — ตรงกัน", machines: [], sample: true,
  },
  {
    id: "s-CFS-000033", code: "CFS-000033", branchId: "s-rs", branch: "รังสิต", staff: "น้องเอ", date: "เมื่อวาน",
    expectedCash: 7200, actualCash: 7200, gap: 0, prizeExpected: 30, prizeActual: 30, prizeGap: 0,
    severity: "P2", type: "cash_short", reason: "ทุกตัวเลขตรงกัน — รอบสะอาด", machines: [], sample: true,
  },
  {
    id: "s-CFS-000029", code: "CFS-000029", branchId: "s-bk", branch: "บางแค", staff: "พี่สอง", date: "2 วันก่อน",
    expectedCash: 0, actualCash: 0, gap: 0, prizeExpected: 0, prizeActual: 0, prizeGap: 0,
    severity: "P1", type: "cash_short", reason: "มิเตอร์ไม่ขยับ 3 วัน — ตู้อาจเสีย/ไม่มีลูกค้า", machines: [], sample: true,
  },
];

/* ───────── helpers ───────── */
/** ส่วนต่างเงิน ไม่เกินเท่านี้ = ถือว่าตรง (display only — logic เดิมใช้ r.gap > 50) */
const CASH_TOLERANCE = 50;

function statusOf(r: CollectionRow): StatusKind {
  if (r.expectedCash === 0 && r.actualCash === 0 && r.gap === 0) return "broken";
  // ส่วนต่างเกินเกณฑ์ "ทั้งขาดและเกิน" (|gap|) = ไม่ตรง · หรือตุ๊กตาหาย
  if (Math.abs(r.gap) > CASH_TOLERANCE || r.prizeGap > 0) return "diff";
  return "match";
}

/** เขียนส่วนต่างเป็นคำพูด: ตรงกัน / ขาด ฿x / เกิน ฿x (บวก=ขาด, ลบ=เกิน) */
function gapWords(gap: number): string {
  if (gap === 0) return "ตรงกัน";
  if (gap > 0) return `ขาด ${bahtN(gap)}`;
  return `เกิน ${bahtN(-gap)}`;
}

const STATUS_META: Record<StatusKind, { label: string; bg: string; color: string }> = {
  match: { label: "ตรงกัน", bg: "#E7F4EC", color: "#15803D" },
  diff: { label: "ไม่ตรง · ต้องสอบ", bg: "#FCEDEC", color: "#B42318" },
  broken: { label: "ตู้เสีย/ไม่ขยับ", bg: "#EFF1F4", color: "#5A6270" },
};

const TABS: { id: "all" | StatusKind; label: string }[] = [
  { id: "all", label: "ทั้งหมด" },
  { id: "match", label: "ตรงกัน" },
  { id: "diff", label: "ไม่ตรง" },
  { id: "broken", label: "ตู้เสีย" },
];

/* ───────── component ───────── */
export function CollectionsClient({
  rows,
  branchOptions,
  hasAnyRounds = false,
}: {
  rows: CollectionRow[];
  branchOptions: BranchOption[];
  // org นี้เคยเก็บเงินจริงไหม (มี CfCollectionSession ใด ๆ) — จาก server.
  // true = เคยเก็บ → 0 anomaly = "ตรวจแล้วไม่พบผิดปกติ" (ไม่ใช่ตัวอย่าง)
  hasAnyRounds?: boolean;
}) {
  // rows = เฉพาะรอบที่ระบบ flag ผิดปกติ (ANOMALY_REVIEW).
  //   - rows ว่าง + ไม่เคยเก็บเลย  → "ว่างจริง" → โชว์ตัวอย่างเพื่อให้เห็นภาพการตรวจ
  //   - rows ว่าง + เคยเก็บแล้ว     → "ตรวจแล้ว ไม่พบผิดปกติ" (empty-state จริง · ห้ามโชว์ theft ปลอม)
  const noRows = rows.length === 0;
  const empty = noRows && !hasAnyRounds;        // ว่างจริง = โชว์ตัวอย่าง
  const allClean = noRows && hasAnyRounds;      // เก็บแล้วสะอาด = empty-state บวก
  const data = empty ? SAMPLE_ROWS : rows;
  const branchOpts = branchOptions.length > 0
    ? [{ value: "all", label: "ทุกสาขา" }, ...branchOptions]
    : SAMPLE_BRANCHES;

  const [branch, setBranch] = useState("all");
  const [tab, setTab] = useState<"all" | StatusKind>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Record<string, ReviewState>>({});
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return data.filter((r) => {
      // กรองด้วย branchId ตรงตัว (ไม่ใช่ substring ชื่อ — เดิมสาขาชื่อคล้ายกันจะปนกัน)
      const matchBranch = branch === "all" || r.branchId === branch;
      const matchTab = tab === "all" || statusOf(r) === tab;
      return matchBranch && matchTab;
    });
  }, [data, branch, tab]);

  /* summary strip */
  const total = data.length;
  const matchN = data.filter((r) => statusOf(r) === "match").length;
  const diffRows = data.filter((r) => statusOf(r) === "diff");
  const diffN = diffRows.length;
  // รวมขนาดส่วนต่าง (|gap|) — ทั้งขาดและเกินคือ exposure ที่ต้องสอบ (อย่าให้หักกลบกัน)
  const diffSum = diffRows.reduce((s, r) => s + Math.abs(r.gap), 0);
  const brokenN = data.filter((r) => statusOf(r) === "broken").length;

  /* review wiring */
  const setReview = (id: string, st: ReviewState) =>
    setReviews((prev) => ({ ...prev, [id]: st }));

  const review = (row: CollectionRow, decision: V2Decision) => {
    const target: ReviewState =
      decision === "approve" ? "reviewed" : decision === "recheck" ? "rechecked" : "escalated";
    // sample row → optimistic only (no real session) · ใช้ flag จาก server ไม่เดาจาก id
    if (row.sample) {
      setReview(row.id, target);
      return;
    }
    setBusyId(row.id);
    setReview(row.id, target); // optimistic
    startTransition(async () => {
      const res = await reviewV2Session(row.id, decision, "ตรวจจากหน้า ตรวจเงิน & กระทบยอด");
      if (!res.ok) setReview(row.id, "pending"); // rollback ถ้า action ปฏิเสธ
      setBusyId(null);
    });
  };

  /* ดาวน์โหลด CSV — export รอบที่กรองอยู่ตอนนี้ (ตาม สาขา + แท็บ) ให้เอาไปเปิด Excel/ทำรายงาน */
  const downloadCsv = () => {
    try {
      const headers = [
        { key: "code", label: "รหัสรอบ" },
        { key: "branch", label: "สาขา" },
        { key: "staff", label: "พนักงาน" },
        { key: "date", label: "เมื่อ" },
        { key: "status", label: "สถานะ" },
        { key: "expectedCash", label: "มิเตอร์ควรได้ (บาท)" },
        { key: "actualCash", label: "เงินนับได้ (บาท)" },
        { key: "gap", label: "ส่วนต่าง (บาท · +ขาด/−เกิน)" },
        { key: "prizeExpected", label: "ตุ๊กตาควรหาย" },
        { key: "prizeActual", label: "ตุ๊กตานับจริง" },
        { key: "prizeGap", label: "ตุ๊กตาหาย" },
        { key: "severity", label: "ระดับ" },
      ];
      const STATUS_TH: Record<StatusKind, string> = {
        match: "ตรงกัน", diff: "ไม่ตรง", broken: "ตู้เสีย/ไม่ขยับ",
      };
      const csvRows = filtered.map((r) => ({
        code: r.code,
        branch: r.branch,
        staff: r.staff,
        date: r.date,
        status: STATUS_TH[statusOf(r)],
        expectedCash: r.expectedCash,
        actualCash: r.actualCash,
        gap: r.gap,
        prizeExpected: r.prizeExpected,
        prizeActual: r.prizeActual,
        prizeGap: r.prizeGap,
        severity: r.severity,
      }));
      // buildCsv ใส่ BOM (﻿) นำหน้ามาให้แล้ว — ไม่ต้องเติมซ้ำ (กัน Excel อ่านภาษาไทยเพี้ยน)
      const csv = buildCsv(headers, csvRows);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `กระทบยอดตู้คีบ-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ดาวน์โหลดพลาด (เบราว์เซอร์ไม่รองรับ / ไม่มีข้อมูล) → เงียบ ไม่ให้หน้าพัง
    }
  };

  return (
    <div>
      {/* บอกให้ชัดว่านี่คือ "รอบเก็บทั้งหมด" ในช่วง 30 วัน ไม่ใช่แค่รอบผิดปกติ */}
      <p style={{ fontSize: 12.5, color: "#6B7280", marginBottom: 14, lineHeight: 1.5 }}>
        รอบเก็บเงิน<b style={{ color: "#1A1D21" }}>ทั้งหมด</b>ที่ปิดแล้วในช่วง 30 วันล่าสุด — กระทบยอดมิเตอร์ ↔ เงินสด ↔ ตุ๊กตา
        ทุกรอบ (ไม่ใช่แค่รอบที่ระบบเตือน). ใช้แท็บ<b> ไม่ตรง</b> เพื่อดูเฉพาะรอบที่ต้องสอบ
      </p>

      {empty && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", background: "#FCF8EC", border: "1px solid #F0E2BE", borderRadius: 10, padding: "9px 14px", marginBottom: 16, fontSize: 12, color: "#7A5510" }}>
          <AlertTriangle size={15} /> ยังไม่มีรอบเก็บเงินจริงในระบบ — กำลังแสดง<b> ตัวอย่าง</b> เพื่อให้เห็นภาพการตรวจ (จะเปลี่ยนเป็นข้อมูลจริงเมื่อเริ่มเก็บเงิน)
        </div>
      )}

      {/* control bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #E3E6EA", borderRadius: 10, padding: "7px 12px" }}>
          <Building2 size={15} color="#6B7280" />
          <span style={{ fontSize: 12, color: "#9AA1AB" }}>สาขา</span>
          <select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            aria-label="เลือกสาขา"
            title="เลือกสาขา"
            style={{ border: "none", background: "transparent", fontSize: 13, fontWeight: 600, color: "#1A1D21", cursor: "pointer", outline: "none" }}
          >
            {branchOpts.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  fontSize: 13, fontWeight: 600, padding: "7px 15px", borderRadius: 9, cursor: "pointer",
                  border: active ? "1px solid #4F46E5" : "1px solid #E3E6EA",
                  background: active ? "#4F46E5" : "#fff",
                  color: active ? "#fff" : "#5A6270",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <span style={{ flex: 1 }} />

        {/* ดาวน์โหลด CSV — เอารอบที่กรองอยู่ตอนนี้ไปเปิด Excel/ทำรายงาน */}
        <button
          onClick={downloadCsv}
          disabled={filtered.length === 0}
          title={filtered.length === 0 ? "ไม่มีรอบให้ดาวน์โหลด" : "ดาวน์โหลดรอบที่กรองอยู่เป็นไฟล์ CSV"}
          style={{
            display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600,
            padding: "7px 14px", borderRadius: 10, border: "1px solid #E3E6EA", background: "#fff",
            color: filtered.length === 0 ? "#C2C7CF" : "#334155",
            cursor: filtered.length === 0 ? "not-allowed" : "pointer",
          }}
        >
          <Download size={14} /> ดาวน์โหลด CSV
        </button>
      </div>

      {/* summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-[18px]">
        <SummaryCard label="รอบเก็บทั้งหมด" value={`${total} รอบ`} />
        <SummaryCard label="ตรงกัน" value={`${matchN} รอบ`} valueColor="#15803D" />
        <SummaryCard
          label="ไม่ตรง · ต้องสอบ" value={`${diffN} รอบ`} valueColor="#B42318"
          bg="#FFF9F8" border="#F3D9D5" labelColor="#B42318"
          foot={`ส่วนต่างรวม ${bahtN(diffSum)}`} footColor="#C2756C"
        />
        <SummaryCard label="ตู้เสีย/ไม่ขยับ" value={`${brokenN} ตู้`} valueColor="#5A6270" />
      </div>

      {/* คำอธิบายสี (legend) — ให้สีในรายการอ่านออกเองได้ */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 11, fontSize: 11.5, color: "#6B7280" }}>
        <span style={{ fontWeight: 600, color: "#9AA1AB" }}>สีสถานะ:</span>
        <LegendDot color="#15803D" label="เขียว = ตรงกัน" />
        <LegendDot color="#B42318" label="แดง = ไม่ตรง · ต้องสอบ" />
        <LegendDot color="#9AA1AB" label="เทา = ตู้เสีย/ไม่ขยับ" />
        <span style={{ color: "#9AA1AB" }}>· ส่วนต่างไม่เกิน {bahtN(CASH_TOLERANCE)} = ถือว่าตรง</span>
      </div>

      {/* list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        {filtered.map((r) => (
          <CollectionCard
            key={r.id}
            row={r}
            open={openId === r.id}
            onToggle={() => setOpenId(openId === r.id ? null : r.id)}
            reviewState={reviews[r.id] ?? "pending"}
            onReview={(d) => review(r, d)}
            busy={busyId === r.id && pending}
          />
        ))}
        {filtered.length === 0 && (
          <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 14 }}>
            {allClean ? (
              // org เคยเก็บเงินแล้ว แต่ไม่มีรอบไหนถูก flag = สถานะที่ดี (ห้ามโชว์ theft ตัวอย่าง)
              <EmptyState
                icon={<ShieldCheck size={30} />}
                title="ทุกรอบตรวจแล้ว · ไม่พบผิดปกติ"
                sub="ทุกรอบเก็บเงินกระทบยอดตรงกับมิเตอร์ — ไม่มีรอบที่ต้องสอบ"
              />
            ) : (
              <EmptyState
                icon={<SearchX size={30} />}
                title="ไม่มีรอบเก็บในตัวกรองนี้"
                sub="ลองเปลี่ยนสาขา หรือเลือกแท็บ “ทั้งหมด” เพื่อดูทุกรอบ"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────── summary card ───────── */
function SummaryCard({
  label, value, valueColor, bg = "#fff", border = "#E8EAED", labelColor = "#6B7280", foot, footColor,
}: {
  label: string; value: string; valueColor?: string; bg?: string; border?: string;
  labelColor?: string; foot?: string; footColor?: string;
}) {
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 14, padding: "15px 17px" }}>
      <div style={{ fontSize: 12.5, color: labelColor, marginBottom: 8 }}>{label}</div>
      <div className="num" style={{ fontSize: 24, fontWeight: 700, color: valueColor }}>{value}</div>
      {foot && <div style={{ fontSize: 11, color: footColor, marginTop: 2 }}>{foot}</div>}
    </div>
  );
}

/* ───────── one collection round (row + drill-down) ───────── */
function CollectionCard({
  row, open, onToggle, reviewState, onReview, busy,
}: {
  row: CollectionRow;
  open: boolean;
  onToggle: () => void;
  reviewState: ReviewState;
  onReview: (d: V2Decision) => void;
  busy: boolean;
}) {
  // รูปที่กดขยาย (lightbox) — null = ปิด
  const [lightbox, setLightbox] = useState<{ url: string; label: string } | null>(null);
  const st = statusOf(row);
  const meta = STATUS_META[st];
  const diffColor = row.gap > CASH_TOLERANCE ? "#B42318" : row.gap > 0 ? "#B45309" : row.gap < 0 ? "#B45309" : "#15803D";
  // ส่วนต่างเป็นคำพูด: ตรงกัน / ขาด ฿x / เกิน ฿x (ไม่โชว์เลขติดลบให้งง)
  const diffStr = gapWords(row.gap);
  const rowBg = open ? "#FCFCFD" : "#fff";

  // เส้นทางเงิน — เหรียญเข้า
  // มีมิเตอร์จริง (before/after รวมทั้งรอบจาก event) → delta จริง ×฿10 · ไม่มี → ประมาณจากยอด (ติดป้ายให้ชัด)
  const meterBefore = row.coinMeterBefore;
  const meterAfter = row.coinMeterAfter;
  // narrow ด้วยตัวแปร local (ไม่ใช้ as) — meterDelta จะเป็น number เมื่อ hasRealMeter เท่านั้น
  const meterDelta =
    meterBefore != null && meterAfter != null && meterAfter >= meterBefore
      ? meterAfter - meterBefore
      : null;
  const hasRealMeter = meterDelta != null;
  const coinDelta = meterDelta != null ? meterDelta : Math.round(row.expectedCash / 10);

  // เส้นทางตุ๊กตา
  const dollOk = row.prizeGap === 0;
  // ส่วนต่างไม่เกินเกณฑ์ (รวมเกิน) = ถือว่าตรง
  const cashOk = Math.abs(row.gap) <= CASH_TOLERANCE;

  // แนะนำ action
  const action =
    st === "broken" ? "ตู้ไม่ขยับ — ส่งช่างเช็คเซ็นเซอร์/มอเตอร์ ก่อนเปิดรอบถัดไป"
      : row.gap > 50 ? "เงินขาดเกินเกณฑ์ — เรียกพนักงานยืนยันยอด + เทียบรูปเงินสดกับมิเตอร์"
        : row.prizeGap > 0 ? "ตุ๊กตาหาย — ตรวจสต๊อกในตู้ + รูปก่อน/หลังเติม"
          : "ทุกตัวเลขตรงกัน — อนุมัติเข้ารายงานได้เลย";
  const actionColor = st === "diff" ? "#B42318" : st === "broken" ? "#B45309" : "#15803D";

  const reviewed = reviewState !== "pending";
  const reviewedLabel =
    reviewState === "reviewed" ? "อนุมัติแล้ว"
      : reviewState === "rechecked" ? "ส่งตรวจซ้ำ"
        : reviewState === "escalated" ? "ส่งผู้จัดการ" : "";
  // สีป้ายผลตรวจให้ตรงกับผล (เขียว=อนุมัติ · ส้ม=ตรวจซ้ำ · แดง=ส่งผจก.)
  const reviewedChip =
    reviewState === "reviewed" ? { color: "#15803D", bg: "#E7F4EC" }
      : reviewState === "rechecked" ? { color: "#B45309", bg: "#FDF3E7" }
        : { color: "#B42318", bg: "#FCEDEC" };

  // รูปจริงต่อตู้ (anti-cheat) — real tier ส่ง machines[].photoShots มา
  // ถ้าไม่มีตู้ (sample/legacy) → โชว์ช่องว่าง 5 ป้ายเป็น placeholder "ไม่มีรูป"
  const FALLBACK_LABELS = ["มิเตอร์เหรียญ", "มิเตอร์ตุ๊กตา", "สต็อกก่อนเติม", "สต็อกหลังเติม", "เงินสด"];
  const photoMachines: { code: string; name: string; shots: { label: string; url: string | null }[] }[] =
    row.machines.length > 0
      ? row.machines.map((m) => ({
          code: m.code,
          name: m.name,
          shots: m.photoShots.length > 0
            ? m.photoShots
            : FALLBACK_LABELS.map((label) => ({ label, url: null })),
        }))
      : [{ code: "", name: "", shots: FALLBACK_LABELS.map((label) => ({ label, url: null })) }];

  // severity left-accent — แดง=ไม่ตรง · เทา=ตู้เสีย · เขียว=ตรงกัน (อ่านระดับได้ตั้งแต่ขอบซ้าย)
  const accent = st === "diff" ? "#B42318" : st === "broken" ? "#9AA1AB" : "#15803D";

  return (
    <div
      className="co-accent-l"
      style={{ background: rowBg, border: "1px solid #E8EAED", borderRadius: 14, overflow: "hidden", ["--co-accent" as string]: accent }}
    >
      {/* row header */}
      <button
        onClick={onToggle}
        className="co-rowlink"
        style={{ display: "flex", alignItems: "center", gap: 16, padding: "15px 20px", cursor: "pointer", width: "100%", background: "transparent", border: "none", textAlign: "left", flexWrap: "wrap" }}
      >
        <span style={{ width: 38, height: 38, flex: "0 0 38px", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: meta.bg, color: meta.color }}>
          {st === "match" ? <Check size={18} /> : st === "broken" ? <AlertTriangle size={17} /> : <AlertTriangle size={17} />}
        </span>
        <div style={{ flex: "0 0 158px", minWidth: 130 }}>
          <div className="num" style={{ fontSize: 14.5, fontWeight: 700 }}>
            {row.code} <span style={{ fontWeight: 500, color: "#6B7280", fontSize: 12.5 }}>· {row.branch}</span>
          </div>
          <div style={{ fontSize: 11.5, color: "#9AA1AB", marginTop: 2 }}>{row.staff} · {row.date}</div>
        </div>
        <div style={{ display: "flex", gap: 26, flex: 1, minWidth: 220, flexWrap: "wrap" }}>
          <Stat label="เก็บเงินได้" value={bahtN(row.actualCash)} />
          <Stat label="มิเตอร์ควรได้" value={bahtN(row.expectedCash)} />
          <Stat label="ส่วนต่าง" value={diffStr} color={diffColor} />
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, padding: "6px 13px", borderRadius: 20, background: meta.bg, color: meta.color, whiteSpace: "nowrap" }}>
          {meta.label}
        </span>
        <span style={{ color: "#C2C7CF", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s", display: "inline-flex" }}>
          <ChevronRight size={18} />
        </span>
      </button>

      {/* drill-down */}
      {open && (
        <div style={{ padding: "4px 20px 20px" }}>
          <div style={{ borderTop: "1px dashed #E2E5EA", paddingTop: 16 }} className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            {/* doll track */}
            <div style={{ background: dollOk ? "#F7F8FA" : "#FFF9F8", borderRadius: 12, padding: "15px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <PrizeIcon />
                <span style={{ fontSize: 13, fontWeight: 700 }}>เส้นทางตุ๊กตา</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11.5, fontWeight: 700, color: dollOk ? "#15803D" : "#B42318" }}>
                  {dollOk ? "ตรงกัน" : `หาย ${row.prizeGap} ตัว`}
                </span>
              </div>
              <div className="num" style={{ fontSize: 12.5, color: "#5A6270", marginBottom: 9, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>มิเตอร์ <b style={{ color: "#1A1D21" }}>{row.prizeExpected}</b></span>
                <span style={{ color: "#C2C7CF" }}>→</span>
                <span><b style={{ color: "#1A1D21" }}>นับจริง {row.prizeActual}</b></span>
                <span style={{ background: "#fff", border: "1px solid #E3E6EA", borderRadius: 6, padding: "1px 7px", fontWeight: 600, color: dollOk ? "#4F46E5" : "#B42318" }}>
                  {dollOk ? "ตรง" : `ต่าง ${row.prizeGap}`}
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: "#5A6270" }}>
                ตุ๊กตาควรหาย <b className="num" style={{ color: "#1A1D21" }}>{row.prizeExpected} ตัว</b> · นับจริงได้ <b className="num" style={{ color: "#1A1D21" }}>{row.prizeActual} ตัว</b>
                {row.prizeGap > 0 && <> · หาย <b className="num" style={{ color: "#B42318" }}>{row.prizeGap} ตัว</b></>}
              </div>
            </div>

            {/* coin / cash track — 3-way reconcile หัวใจ */}
            <div style={{ background: cashOk ? "#F7F8FA" : "#FFF9F8", borderRadius: 12, padding: "15px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <Coins size={16} color="#5A6270" />
                <span style={{ fontSize: 13, fontWeight: 700 }}>เส้นทางเงิน</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11.5, fontWeight: 700, color: cashOk ? "#15803D" : "#B42318" }}>
                  {cashOk ? "ตรงกัน" : gapWords(row.gap)}
                </span>
              </div>
              {/* 3-way: มิเตอร์ควรได้ ↔ เงินนับได้ ↔ ส่วนต่าง */}
              <div style={{ display: "flex", alignItems: "stretch", gap: 8, marginBottom: 9 }}>
                <ReconCell label="มิเตอร์ควรได้" value={bahtN(row.expectedCash)} color="#1A1D21" />
                <Arrow />
                <ReconCell label="เงินสดนับได้" value={bahtN(row.actualCash)} color="#1A1D21" />
                <Arrow />
                <ReconCell label="ส่วนต่าง" value={diffStr} color={diffColor} strong />
              </div>
              {hasRealMeter ? (
                // แสดงสมการ ×฿10 เฉพาะเมื่อ delta×10 ตรงกับ "ควรได้" จริง (ตู้ ฿10 ล้วน)
                // ถ้าตู้เป็น ฿20/฿30 หรือปนโทเคน → delta×10 ≠ ควรได้ → ห้ามตอกสมการที่ไม่ balance
                // (หลอกตาบนจอกันโกง) · โชว์แค่ delta มิเตอร์ + ควรได้ (ยังถูกต้อง)
                Math.round(coinDelta * 10) === row.expectedCash ? (
                  <div style={{ fontSize: 12, color: "#5A6270" }}>
                    มิเตอร์เหรียญขยับ <b className="num" style={{ color: "#1A1D21" }}>{coinDelta}</b> เหรียญ
                    {" "}(รวมทุกตู้ในรอบ) ×฿10 ={" "}
                    <b className="num" style={{ color: "#1A1D21" }}>{bahtN(row.expectedCash)}</b>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "#5A6270" }}>
                    มิเตอร์เหรียญขยับ <b className="num" style={{ color: "#1A1D21" }}>{coinDelta}</b> เหรียญ
                    {" "}(รวมทุกตู้ในรอบ) · ควรได้ ={" "}
                    <b className="num" style={{ color: "#1A1D21" }}>{bahtN(row.expectedCash)}</b>
                  </div>
                )
              ) : (
                <div style={{ fontSize: 12, color: "#5A6270" }}>
                  เหรียญเข้า <span style={{ color: "#9AA1AB" }}>≈</span> <b className="num" style={{ color: "#1A1D21" }}>{coinDelta}</b> เหรียญ · ควรได้ ={" "}
                  <b className="num" style={{ color: "#1A1D21" }}>{bahtN(row.expectedCash)}</b>
                  <span style={{ color: "#9AA1AB", fontSize: 11 }}> · ≈ ประมาณจากยอด (ไม่มีเลขมิเตอร์ในรอบนี้)</span>
                </div>
              )}
              {cashOk && row.gap !== 0 && (
                <div style={{ fontSize: 11, color: "#9AA1AB", marginTop: 5 }}>
                  {gapWords(row.gap)} · ต่างไม่เกิน {bahtN(CASH_TOLERANCE)} = ถือว่าตรง
                </div>
              )}
            </div>
          </div>

          {/* หมายเหตุ: แบนเนอร์ "มิเตอร์ต่อเนื่อง" ถูกเอาออก — เดิม hardcode 18420 ทำให้โชว์ไฟเขียว
             "ผ่าน" กับทุกแถวโดยไม่ได้ตรวจจริง (ฟีเจอร์กันโกง ห้ามโชว์ผลปลอม). จะกลับมาใส่เมื่อ
             query ส่งเลขมิเตอร์ปิดรอบก่อน/เปิดรอบนี้จริงมา (CollectionRow ยังไม่มี field นี้) */}

          {/* รูปจริงที่พนักงานถ่าย (anti-cheat) — แยกต่อตู้ · กดรูปเพื่อขยายตรวจ */}
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9 }}>
              <ZoomIn size={13} color="#9AA1AB" style={{ flex: "0 0 13px" }} />
              <span className="co-eyebrow">
                รูปที่พนักงานถ่ายตอนเก็บเงิน · กดรูปเพื่อขยายตรวจว่าเลขในรูปตรงกับที่กรอกไหม
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {photoMachines.map((m, mi) => {
                // มีรูปจริงอย่างน้อย 1 รูปไหม — ถ้าไม่มีเลย → ซ่อนกริด 5 ช่อง โชว์บรรทัดเดียว
                const hasAnyPhoto = m.shots.some((s) => s.url);
                return (
                  <div key={m.code || `m-${mi}`}>
                    {m.name && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color: "#5A6270", marginBottom: 7 }}>
                        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#C2C7CF", flex: "0 0 5px" }} />
                        {m.name} {m.code && <span style={{ color: "#9AA1AB", fontWeight: 500 }}>· {m.code}</span>}
                      </div>
                    )}
                    {hasAnyPhoto ? (
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-[10px]">
                        {m.shots.map((s, si) => (
                          <PhotoTile
                            key={`${s.label}-${si}`}
                            label={s.label}
                            url={s.url}
                            onOpen={s.url ? () => setLightbox({ url: s.url as string, label: s.label }) : undefined}
                          />
                        ))}
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "#9AA1AB", background: "#F7F8FA", border: "1px dashed #E2E5EA", borderRadius: 9, padding: "10px 13px" }}>
                        <ImageOff size={14} color="#C2C7CF" style={{ flex: "0 0 14px" }} />
                        ยังไม่มีรูปในรอบนี้
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* lightbox overlay — กดรูปแล้วขยายเต็ม · กดพื้นหลัง/ปุ่มปิด */}
          {lightbox && (
            <div
              role="dialog"
              aria-modal="true"
              onClick={() => setLightbox(null)}
              style={{
                position: "fixed", inset: 0, zIndex: 90, background: "rgba(13,15,20,0.9)",
                backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)",
                display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
              }}
            >
              <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: "92vw", maxHeight: "88vh", display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "#fff", fontSize: 13, fontWeight: 700, background: "rgba(255,255,255,0.1)", padding: "5px 12px", borderRadius: 20 }}>
                    <ZoomIn size={13} /> {lightbox.label}
                  </span>
                  <span style={{ flex: 1 }} />
                  <button
                    type="button"
                    onClick={() => setLightbox(null)}
                    aria-label="ปิดรูป"
                    className="co-tap"
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", background: "rgba(255,255,255,0.14)", border: "none", borderRadius: 10, width: 36, height: 36, cursor: "pointer" }}
                  >
                    <X size={17} />
                  </button>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element — เลี่ยง next/image remote-domain config */}
                <img
                  src={lightbox.url}
                  alt={lightbox.label}
                  style={{ maxWidth: "92vw", maxHeight: "76vh", objectFit: "contain", borderRadius: 12, background: "#000", boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}
                />
                <div style={{ textAlign: "center", color: "rgba(255,255,255,0.55)", fontSize: 11 }}>
                  กดพื้นหลังหรือปุ่มปิดเพื่อออก
                </div>
              </div>
            </div>
          )}

          {/* recommended action + review buttons */}
          <div style={{ marginTop: 14, background: "#F8F9FB", borderRadius: 11, padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 9, marginBottom: 12 }}>
              <Info size={17} color={actionColor} style={{ flex: "0 0 17px", marginTop: 1 }} />
              <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: actionColor }}>แนะนำ: {action}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11.5, color: "#9AA1AB" }}>ตรวจเสร็จแล้ว เลือกผล →</span>
              <ReviewBtn label="อนุมัติ" tone="green" active={reviewState === "reviewed"} disabled={busy} onClick={() => onReview("approve")} />
              <ReviewBtn label="ตรวจซ้ำ" tone="amber" active={reviewState === "rechecked"} disabled={busy} onClick={() => onReview("recheck")} />
              <ReviewBtn label="ส่งผู้จัดการ" tone="red" active={reviewState === "escalated"} disabled={busy} onClick={() => onReview("escalate")} />
              <span style={{ flex: 1 }} />
              {reviewed ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color: reviewedChip.color, background: reviewedChip.bg, padding: "5px 12px", borderRadius: 20 }}>
                  <Check size={14} /> {reviewedLabel}
                </span>
              ) : (
                <span style={{ fontSize: 11, color: "#C2756C", background: "#FCEDEC", padding: "5px 11px", borderRadius: 20, fontWeight: 600 }}>
                  ยังไม่ได้ตรวจ
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────── small parts ───────── */
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, flex: "0 0 9px" }} />
      {label}
    </span>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: "#9AA1AB" }}>{label}</div>
      <div className="num" style={{ fontSize: 15, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function ReconCell({ label, value, color, strong }: { label: string; value: string; color: string; strong?: boolean }) {
  return (
    <div style={{ flex: 1, background: "#fff", border: "1px solid #E3E6EA", borderRadius: 9, padding: "8px 10px", minWidth: 0 }}>
      <div style={{ fontSize: 10, color: "#9AA1AB", marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      <div className="num" style={{ fontSize: strong ? 15 : 14, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function Arrow() {
  return <span style={{ display: "flex", alignItems: "center", color: "#C2C7CF", fontSize: 14, fontWeight: 700 }}>↔</span>;
}

function ReviewBtn({
  label, tone, active, disabled, onClick,
}: {
  label: string; tone: "green" | "amber" | "red"; active: boolean; disabled?: boolean; onClick: () => void;
}) {
  const palette = {
    green: { on: "#15803D", soft: "#E7F4EC", text: "#15803D" },
    amber: { on: "#B45309", soft: "#FDF3E7", text: "#B45309" },
    red: { on: "#B42318", soft: "#FCEDEC", text: "#B42318" },
  }[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontSize: 11.5, fontWeight: 700, padding: "6px 13px", borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer",
        border: active ? `1px solid ${palette.on}` : "1px solid #E3E6EA",
        background: active ? palette.on : palette.soft,
        color: active ? "#fff" : palette.text,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  );
}

/** การ์ดรูปเดียว — มีรูปจริง → กดขยายได้ · null → placeholder "ไม่มีรูป" */
function PhotoTile({
  label, url, onOpen,
}: {
  label: string;
  url: string | null;
  onOpen?: () => void;
}) {
  return (
    <div className={url ? "co-lift" : ""} style={{ border: "1px solid #E8EAED", borderRadius: 11, overflow: "hidden", background: "#fff" }}>
      {url ? (
        <button
          type="button"
          onClick={onOpen}
          title="กดเพื่อดูรูปเต็ม"
          className="co-tap"
          style={{ display: "block", width: "100%", height: 72, padding: 0, border: "none", background: "#EFF1F4", position: "relative", cursor: "pointer" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element — เลี่ยง next/image remote-domain config */}
          <img
            src={url}
            alt={label}
            loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
          <span style={{ position: "absolute", top: 5, right: 5, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(17,20,24,0.55)", borderRadius: 6, width: 20, height: 20 }}>
            <Maximize2 size={11} color="#fff" />
          </span>
        </button>
      ) : (
        <div style={{ height: 72, background: "#F7F8FA", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
          <ImageOff size={15} color="#CDD2DA" />
          <span style={{ fontSize: 9, color: "#B6BBC4" }}>ไม่มีรูป</span>
        </div>
      )}
      <div style={{ padding: "6px 9px", borderTop: "1px solid #F0F1F4" }}>
        <div style={{ fontSize: 9.5, color: "#9AA1AB", lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      </div>
    </div>
  );
}

function PrizeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5A6270" strokeWidth="2">
      <path d="M12 3v6" /><path d="M8 9h8l-1.2 4.2a3 3 0 0 1-2.88 2.18h-.84a3 3 0 0 1-2.88-2.18Z" />
      <path d="M12 15.5V21" /><path d="M8.5 21h7" />
    </svg>
  );
}
