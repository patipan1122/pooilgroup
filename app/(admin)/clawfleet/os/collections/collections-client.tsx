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

import { useMemo, useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2, AlertTriangle, Check, ChevronRight, Coins, Info, Maximize2, ImageOff,
  X, ZoomIn, SearchX, ShieldCheck, Download, Calendar, ChevronLeft, Pencil,
} from "lucide-react";
import { bahtN } from "@/components/clawfleet/os/format";
import { EmptyState } from "@/components/clawfleet/os/kit";
import { reviewV2Session, adminEditCollectionEvent, type V2Decision } from "@/lib/clawfleet/actions";
import { buildCsv } from "@/lib/clawfleet/csv";

/* ───────── types ───────── */
export type BranchOption = { value: string; label: string };

/** รูปจริงต่อตู้ที่พนักงานถ่ายตอนเก็บเงิน (anti-cheat) — label = ความหมายจริง */
export type CollectionMachine = {
  code: string;
  name: string;
  photoShots: { label: string; url: string | null }[];
  /** ข้อมูลที่พนักงานกรอกจริงทุกช่อง (label→value · จัดรูปฝั่ง server · kind-aware) — โชว์ให้เทียบกับรูป */
  entered?: { k: string; v: string }[];
  /** ประเภทตู้ (CLAW/EXCHANGER) — ป้ายกำกับหัวการ์ดตู้ */
  kind?: string;
  /** true = event รอบตั้งต้น (INITIAL) */
  isInitial?: boolean;
  /** id ของ event (COLLECTION) — หลังบ้านใช้แก้เลข (adminEditCollectionEvent) · undefined = mock/legacy */
  eventId?: string;
  coinMeterAfter?: number; // มิเตอร์เหรียญ (ค่าปัจจุบัน · prefill ฟอร์มแก้)
  dollMeterAfter?: number; // มิเตอร์ตุ๊กตา
  cashBaht?: number; // เงินสดที่เก็บได้ (บาท)
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
  /** รอบตั้งต้น (baseline) — ตั้งมิเตอร์ครั้งแรกของตู้ · ยังไม่มีรอบก่อนไว้เทียบ →
   *  แยกป้าย "รอบตั้งต้น" ไม่ปนกับ "ไม่ตรง/เกิน" (expectedCash=0 โดยธรรมชาติ ดูเหมือนเงินเกินทั้งที่ปกติ) */
  isBaseline?: boolean;
  /** รอบ "กำลังเก็บ" (OPEN · ยังเก็บไม่ครบทุกตู้) — โชว์สดแต่ยังไม่กระทบยอด */
  isOpen?: boolean;
  /** เก็บแล้วกี่ตู้ / ทั้งสาขากี่ตู้ — โชว์ "X/Y" บนรอบ OPEN */
  collectedCount?: number;
  machineTotal?: number;
  /** มิเตอร์เหรียญรวมทั้งรอบจาก event จริง — มี = โชว์ delta×10 จริง · undefined/null = ประมาณจากยอด */
  coinMeterBefore?: number | null;
  coinMeterAfter?: number | null;
  /** ตู้ในรอบนี้ พร้อมรูปจริงต่อตู้ (real tier ส่งมา · sample = []) */
  machines: CollectionMachine[];
  sample: boolean;
};

/** สรุปรายวันต่อสาขา (จาก server · null = ช่วงหลายวัน ไม่โชว์การ์ด) */
export type DaySummaryRow = {
  branchId: string;
  totalMachines: number;
  collected: number;
  notCollected: number;
  baseline: number;
  refill: number;
  cashBaht: number;
};

type ReviewState = "pending" | "reviewed" | "rechecked" | "escalated";
type StatusKind = "match" | "diff" | "broken" | "baseline" | "open";

/** รอบตั้งต้นไหม — เชื่อ flag จาก server ก่อน · เผื่อไว้เช็ครหัส BASE- (belt-and-suspenders) */
function isBaselineRow(r: CollectionRow): boolean {
  return r.isBaseline === true || r.code.startsWith("BASE-");
}

/** รอบ "กำลังเก็บ" — OPEN · ยังเก็บไม่ครบทุกตู้ · ยังไม่กระทบยอด (ไม่นับเป็นตรง/ไม่ตรง) */
function isInProgress(r: CollectionRow): boolean {
  return r.isOpen === true;
}

/* ───────── sample fallback (จาก design) ───────── */
const SAMPLE_BRANCHES: BranchOption[] = [
  { value: "all", label: "ทุกสาขา" },
  { value: "s-rs", label: "รังสิต (RS)" },
  { value: "s-lp", label: "ลาดพร้าว (LP)" },
  { value: "s-bk", label: "บางแค (BK)" },
];

// NOTE (CEO 2026-07-10): เดิมมี SAMPLE_ROWS (฿6,100 ฯลฯ) โชว์เป็น "ตัวอย่าง" ตอนยังไม่มี
// ข้อมูลจริง — ทำให้ดูเหมือนมีเงินเก็บทั้งที่ยังไม่เคยเก็บ (สับสน/หลอกตา). ตัดทิ้ง →
// ว่าง = โชว์ empty-state จริง (ดู neverCollected / allClean ด้านล่าง). ไม่โชว์เลขปลอมอีก.

/* ───────── helpers ───────── */
/** ส่วนต่างเงิน ไม่เกินเท่านี้ = ถือว่าตรง (display only — logic เดิมใช้ r.gap > 50) */
const CASH_TOLERANCE = 50;

function statusOf(r: CollectionRow): StatusKind {
  // รอบกำลังเก็บ (OPEN) มาก่อน — ยังเก็บไม่จบ ยังไม่กระทบยอด ห้ามตัดสินว่าตรง/ไม่ตรง
  if (isInProgress(r)) return "open";
  // รอบตั้งต้นมาก่อนทุกเงื่อนไข — ไม่มีมิเตอร์เก่าให้เทียบ ห้ามตัดสินว่า "เกิน/ไม่ตรง"
  if (isBaselineRow(r)) return "baseline";
  if (r.expectedCash === 0 && r.actualCash === 0 && r.gap === 0) return "broken";
  // ส่วนต่างเกินเกณฑ์ "ทั้งขาดและเกิน" (|gap|) = ไม่ตรง · หรือตุ๊กตาไม่ตรงมิเตอร์ (หาย prizeGap>0 / เกิน prizeGap<0)
  if (Math.abs(r.gap) > CASH_TOLERANCE || r.prizeGap !== 0) return "diff";
  return "match";
}

/** "YYYY-MM-DD" → "1 ก.ค. 68" (พ.ศ. ย่อ) · ค่าเสีย → คืน string เดิม (graceful) */
function thaiDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12) return iso;
  return `${d} ${months[mo - 1]} ${(y + 543) % 100}`;
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
  // รอบตั้งต้น = indigo จาง (ข้อมูล ไม่ใช่ error) — อ่านออกทันทีว่า "ปกติ ไม่ต้องตกใจ"
  baseline: { label: "รอบตั้งต้น", bg: "#EEF0FE", color: "#4F46E5" },
  // กำลังเก็บ = ฟ้า (สด · ยังไม่ปิด) — เงินขึ้นแล้วแต่ยังไม่กระทบยอด
  open: { label: "กำลังเก็บ", bg: "#E5F2FD", color: "#0B69C7" },
};

const TABS: { id: "all" | StatusKind; label: string }[] = [
  { id: "all", label: "ทั้งหมด" },
  { id: "open", label: "กำลังเก็บ" },
  { id: "match", label: "ตรงกัน" },
  { id: "diff", label: "ไม่ตรง" },
  { id: "broken", label: "ตู้เสีย" },
  { id: "baseline", label: "รอบตั้งต้น" },
];

/* ───────── component ───────── */
export function CollectionsClient({
  rows,
  branchOptions,
  hasAnyRounds = false,
  total = 0,
  page = 1,
  pageSize = 50,
  fromISO = "",
  toISO = "",
  canEdit = false,
  daySummaries = null,
}: {
  rows: CollectionRow[];
  branchOptions: BranchOption[];
  // แอดมิน/ผู้จัดการสาขา = แก้เลขที่พนักงานกรอกผิดได้ (ปุ่ม "แก้เลข" ต่อตู้) · อื่น ๆ = ดูอย่างเดียว
  canEdit?: boolean;
  // org นี้เคยเก็บเงินจริงไหม (มี CfCollectionSession ใด ๆ) — จาก server.
  // true = เคยเก็บ → 0 anomaly = "ตรวจแล้วไม่พบผิดปกติ" (ไม่ใช่ตัวอย่าง)
  hasAnyRounds?: boolean;
  // total = รอบทั้งหมดในช่วงวันที่ (ก่อนตัดหน้า) จาก server · page/pageSize = หน้าปัจจุบัน
  total?: number;
  page?: number;
  pageSize?: number;
  // ช่วงวันที่ปัจจุบัน (YYYY-MM-DD) — เติมค่า <input type=date> + คง state ใน link
  fromISO?: string;
  toISO?: string;
  // สรุปรายวันต่อสาขา (single-day เท่านั้น · null = ไม่โชว์การ์ด)
  daySummaries?: DaySummaryRow[] | null;
}) {
  // rows = เฉพาะรอบที่ระบบ flag ผิดปกติ (ANOMALY_REVIEW).
  //   - rows ว่าง + ไม่เคยเก็บเลย  → "ว่างจริง" → โชว์ตัวอย่างเพื่อให้เห็นภาพการตรวจ
  //   - rows ว่าง + เคยเก็บแล้ว     → "ตรวจแล้ว ไม่พบผิดปกติ" (empty-state จริง · ห้ามโชว์ theft ปลอม)
  const noRows = rows.length === 0;
  // ⛔ เลิกโชว์ข้อมูลตัวอย่างปลอม (CEO: อยากเห็นข้อมูลจริง) — ว่าง = ว่างจริงเสมอ
  const empty = false;
  const neverCollected = noRows && !hasAnyRounds; // ยังไม่เคยเก็บเงินจริง → empty-state "เริ่มต้น"
  const allClean = noRows && hasAnyRounds;        // เคยเก็บ + ไม่มี anomaly → empty-state "สะอาด"
  const data = rows;                              // ใช้ข้อมูลจริงเสมอ
  const branchOpts = branchOptions.length > 0
    ? [{ value: "all", label: "ทุกสาขา" }, ...branchOptions]
    : SAMPLE_BRANCHES;

  const [branch, setBranch] = useState("all");
  const [tab, setTab] = useState<"all" | StatusKind>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Record<string, ReviewState>>({});
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  // ── ช่วงวันที่ (local input state) · กด "ดูช่วงนี้" → soft-nav ผ่าน <Link> (reset page=1) ──
  const [fromInput, setFromInput] = useState(fromISO);
  const [toInput, setToInput] = useState(toISO);

  // ── pagination (จาก server · เฉพาะข้อมูลจริง · sample ไม่มีหน้า) ──
  const isReal = !empty;
  const pageCount = isReal ? Math.max(1, Math.ceil(total / Math.max(1, pageSize))) : 1;
  const curPage = isReal ? Math.min(Math.max(1, page), pageCount) : 1;
  const hasPrev = isReal && curPage > 1;
  const hasNext = isReal && curPage < pageCount;
  // มีหลายหน้า → การ์ดสรุป ตรงกัน/ไม่ตรง/ตู้เสีย นับจากหน้านี้เท่านั้น (ต้องติดป้าย)
  const multiPage = isReal && pageCount > 1;
  const perPageFoot = multiPage ? "นับจากหน้านี้" : undefined;

  /** สร้าง href คงช่วงวันที่ + ระบุหน้า (soft-nav · ไม่ hard reload) */
  const pageHref = (p: number) => {
    const q = new URLSearchParams();
    if (fromISO) q.set("from", fromISO);
    if (toISO) q.set("to", toISO);
    q.set("page", String(p));
    return `?${q.toString()}`;
  };
  /** href เปลี่ยนช่วงวันที่ (จากค่า input) — reset page=1 เสมอ (ข้อมูลชุดใหม่) */
  const rangeHref = (() => {
    const q = new URLSearchParams();
    if (fromInput) q.set("from", fromInput);
    if (toInput) q.set("to", toInput);
    q.set("page", "1");
    return `?${q.toString()}`;
  })();
  // ช่วง input ต่างจากที่ query อยู่ตอนนี้ไหม (เปิดปุ่ม "ดูช่วงนี้" เฉพาะเมื่อเปลี่ยน)
  const rangeDirty = fromInput !== fromISO || toInput !== toISO;

  // ── ปุ่มลัดช่วงเวลา (วันนี้/เมื่อวาน/7 วัน/เดือนนี้) ──
  // ใช้ "วันตามปฏิทินเครื่อง" (local) ให้ตรงกับที่ server parse (parseDateStart ใช้ T00:00:00 local)
  const quickRanges = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const isoLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const now = new Date();
    const todayI = isoLocal(now);
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    const wk = new Date(now); wk.setDate(now.getDate() - 6);
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return [
      { key: "today", label: "วันนี้", from: todayI, to: todayI },
      { key: "yesterday", label: "เมื่อวาน", from: isoLocal(yest), to: isoLocal(yest) },
      { key: "7d", label: "7 วัน", from: isoLocal(wk), to: todayI },
      { key: "month", label: "เดือนนี้", from: isoLocal(firstOfMonth), to: todayI },
    ];
  }, []);
  /** href ปุ่มลัด — set ช่วง + reset page=1 (soft-nav เหมือน rangeHref) */
  const quickHref = (from: string, to: string) => {
    const q = new URLSearchParams();
    q.set("from", from);
    q.set("to", to);
    q.set("page", "1");
    return `?${q.toString()}`;
  };

  const filtered = useMemo(() => {
    return data.filter((r) => {
      // กรองด้วย branchId ตรงตัว (ไม่ใช่ substring ชื่อ — เดิมสาขาชื่อคล้ายกันจะปนกัน)
      const matchBranch = branch === "all" || r.branchId === branch;
      const matchTab = tab === "all" || statusOf(r) === tab;
      return matchBranch && matchTab;
    });
  }, [data, branch, tab]);

  // สรุปรายวัน (single-day) สำหรับสาขาที่เลือก — "all" = รวมทุกสาขา
  const daySummary = useMemo(() => {
    if (!daySummaries || daySummaries.length === 0) return null;
    const list = branch === "all" ? daySummaries : daySummaries.filter((d) => d.branchId === branch);
    return list.reduce(
      (acc, d) => ({
        totalMachines: acc.totalMachines + d.totalMachines,
        collected: acc.collected + d.collected,
        notCollected: acc.notCollected + d.notCollected,
        baseline: acc.baseline + d.baseline,
        refill: acc.refill + d.refill,
        cashBaht: acc.cashBaht + d.cashBaht,
      }),
      { totalMachines: 0, collected: 0, notCollected: 0, baseline: 0, refill: 0, cashBaht: 0 },
    );
  }, [daySummaries, branch]);

  /* summary strip — นับจาก data (หน้าปัจจุบัน หรือ sample) · total ทั้งช่วงใช้ prop `total`
     แยก "เงิน" กับ "ตุ๊กตา" คนละการ์ด (CEO: อยากเห็นเช็คตุ๊กตาชัด ๆ) · baseline ไม่นับเป็นปัญหา */
  const pageTotal = data.length;
  const matchN = data.filter((r) => statusOf(r) === "match").length;
  const baselineN = data.filter((r) => statusOf(r) === "baseline").length;
  const brokenN = data.filter((r) => statusOf(r) === "broken").length;
  // รอบกำลังเก็บ (OPEN) ในหน้านี้ + เงินที่เก็บแล้วรวม — โชว์เป็นชิปฟ้า "เงินขึ้นแล้ว ยังไม่ปิด"
  const openRows = data.filter((r) => statusOf(r) === "open");
  const openN = openRows.length;
  const openCashSum = openRows.reduce((s, r) => s + r.actualCash, 0);
  // สัดส่วน "ตรงกัน" ในหน้านี้ — ใช้เป็นแถบ progress บนการ์ดหลัก (mockup hero) · display จากตัวนับจริงเท่านั้น
  const reconciledPct = pageTotal > 0 ? Math.round((matchN / pageTotal) * 100) : 0;
  const totalShown = isReal ? total : pageTotal;

  // เงินไม่ตรง — เฉพาะรอบจริง (ไม่ใช่ baseline) ที่ |ส่วนต่าง| เกินเกณฑ์ · รวมขนาด exposure (ไม่หักกลบ)
  const moneyDiffRows = data.filter((r) => !isBaselineRow(r) && Math.abs(r.gap) > CASH_TOLERANCE);
  const moneyDiffN = moneyDiffRows.length;
  const moneyDiffSum = moneyDiffRows.reduce((s, r) => s + Math.abs(r.gap), 0);

  // ตุ๊กตาหาย — รอบจริงที่ตุ๊กตานับได้น้อยกว่าที่มิเตอร์บอกว่าออก (เสี่ยงโกง/ตู้พัง)
  const dollShortRows = data.filter((r) => !isBaselineRow(r) && r.prizeGap > 0);
  const dollShortN = dollShortRows.length;
  const dollMissingTotal = dollShortRows.reduce((s, r) => s + r.prizeGap, 0);
  // ตุ๊กตาเกิน — นับได้มากกว่าที่มิเตอร์บอกว่าออก (prizeGap<0 · นับซ้ำ/เติมไม่ลงระบบ) · CEO 2026-07-20 "โชว์ตามจริงทุกฝั่ง"
  const dollOverRows = data.filter((r) => !isBaselineRow(r) && r.prizeGap < 0);
  const dollOverN = dollOverRows.length;
  const dollOverTotal = dollOverRows.reduce((s, r) => s + -r.prizeGap, 0);
  const dollIssueN = dollShortN + dollOverN;

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
        { key: "prizeGap", label: "ตุ๊กตา (+หาย/−เกิน)" },
        { key: "severity", label: "ระดับ" },
      ];
      const STATUS_TH: Record<StatusKind, string> = {
        match: "ตรงกัน", diff: "ไม่ตรง", broken: "ตู้เสีย/ไม่ขยับ", baseline: "รอบตั้งต้น", open: "กำลังเก็บ",
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
      {/* บอกให้ชัดว่านี่คือ "รอบเก็บทั้งหมด" ในช่วงที่เลือก ไม่ใช่แค่รอบผิดปกติ */}
      <p style={{ fontSize: 12.5, color: "#6B7280", marginBottom: 14, lineHeight: 1.5 }}>
        รอบเก็บเงิน<b style={{ color: "#1A1D21" }}>ทั้งหมด</b> (ปิดแล้ว + กำลังเก็บ)
        {isReal && fromISO && toISO ? <> ในช่วง <b style={{ color: "#1A1D21" }}>{thaiDate(fromISO)}–{thaiDate(toISO)}</b></> : " ในช่วง 30 วันล่าสุด"}
        {" "}— กระทบยอดมิเตอร์ ↔ เงินสด ↔ ตุ๊กตา
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

        {/* ── ช่วงวันที่ (จาก/ถึง) · กด "ดูช่วงนี้" → soft-nav · sample = ปิด (ไม่มีข้อมูลจริง) ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #E3E6EA", borderRadius: 10, padding: "6px 10px", flexWrap: "wrap" }}>
          <Calendar size={15} color="#6B7280" style={{ flex: "0 0 15px" }} />
          <input
            type="date"
            value={fromInput}
            max={toInput || undefined}
            disabled={empty}
            onChange={(e) => setFromInput(e.target.value)}
            aria-label="วันที่เริ่มต้น"
            title="วันที่เริ่มต้น"
            style={{ border: "none", background: "transparent", fontSize: 12.5, fontWeight: 600, color: "#1A1D21", outline: "none", cursor: empty ? "not-allowed" : "pointer" }}
          />
          <span style={{ fontSize: 12, color: "#9AA1AB" }}>ถึง</span>
          <input
            type="date"
            value={toInput}
            min={fromInput || undefined}
            disabled={empty}
            onChange={(e) => setToInput(e.target.value)}
            aria-label="วันที่สิ้นสุด"
            title="วันที่สิ้นสุด"
            style={{ border: "none", background: "transparent", fontSize: 12.5, fontWeight: 600, color: "#1A1D21", outline: "none", cursor: empty ? "not-allowed" : "pointer" }}
          />
          {empty ? (
            <span style={{ fontSize: 11, color: "#C2C7CF", fontWeight: 600 }}>ดูช่วงนี้</span>
          ) : rangeDirty ? (
            <Link
              href={rangeHref}
              style={{ fontSize: 11.5, fontWeight: 700, color: "#fff", background: "#4F46E5", padding: "5px 12px", borderRadius: 8, textDecoration: "none", whiteSpace: "nowrap" }}
            >
              ดูช่วงนี้
            </Link>
          ) : (
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "#C2C7CF" }}>ดูช่วงนี้</span>
          )}
        </div>

        {/* ปุ่มลัดช่วงเวลา — กดปุ๊บกรองเลย ไม่ต้องเปิดปฏิทินทีละช่อง (CEO ขอ วันนี้/เมื่อวาน) */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {quickRanges.map((q) => {
            const active = fromISO === q.from && toISO === q.to;
            return empty ? (
              <span key={q.key} style={quickChipStyle(false, active)}>{q.label}</span>
            ) : (
              <Link key={q.key} href={quickHref(q.from, q.to)} className="co-tap" style={quickChipStyle(true, active)}>
                {q.label}
              </Link>
            );
          })}
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

      {/* สรุปรายวัน (CEO 2026-08-01) — เฉพาะช่วงวันเดียว · เก็บ/ยังไม่เก็บ/ตั้งค่าใหม่/เติมตุ๊กตา/เงินวันนี้ */}
      {daySummary && (
        <DaySummaryCard dateLabel={thaiDate(fromISO)} branchAll={branch === "all"} s={daySummary} />
      )}

      {/* summary strip
          "รอบเก็บทั้งหมด" = total จริงทั้งช่วง (จาก server · ทุกหน้ารวมกัน).
          ตรงกัน/ไม่ตรง/ตู้เสีย = นับจาก "หน้านี้" เท่านั้น (client มีแค่หน้าที่โหลด) → ติดป้ายให้ชัด. */}
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", gap: 14, marginBottom: 16 }}>
        {/* การ์ดหลัก (hero · indigo gradient) — รอบทั้งหมด + แถบสัดส่วน "ตรงกัน" ให้เห็นภาพรวมกระทบยอดเด่น ๆ */}
        <HeroCard
          total={totalShown}
          matchN={matchN}
          pageTotal={pageTotal}
          pct={reconciledPct}
          multiPage={multiPage}
          curPage={curPage}
          pageCount={pageCount}
        />
        <SummaryCard label="ตรงกันหมด" value={`${matchN} รอบ`} valueColor="#15803D" foot={perPageFoot} footColor="#9AA1AB" />
        {/* การ์ดเงิน (แยกจากตุ๊กตา) — เขียว/จางเมื่อ 0 · แดงเมื่อมีรอบต้องสอบ */}
        <SummaryCard
          label="เงินไม่ตรง · ต้องสอบ" value={`${moneyDiffN} รอบ`}
          valueColor={moneyDiffN > 0 ? "#B42318" : "#5A6270"}
          bg={moneyDiffN > 0 ? "#FFF9F8" : "#fff"} border={moneyDiffN > 0 ? "#F3D9D5" : "#E8EAED"}
          labelColor={moneyDiffN > 0 ? "#B42318" : "#6B7280"}
          foot={moneyDiffN > 0 ? `ส่วนต่างรวม ${bahtN(moneyDiffSum)}${multiPage ? " · หน้านี้" : ""}` : "เงินตรงทุกรอบ ✓"}
          footColor={moneyDiffN > 0 ? "#C2756C" : "#8FA99A"}
        />
        {/* การ์ดตุ๊กตา (เช็คตุ๊กตาออกตรงมิเตอร์ไหม) — ส้มเมื่อมีหาย/เกิน · จาง/เขียวเมื่อครบ */}
        <SummaryCard
          label="ตุ๊กตาไม่ตรงมิเตอร์" value={`${dollIssueN} รอบ`}
          valueColor={dollIssueN > 0 ? "#B45309" : "#5A6270"}
          bg={dollIssueN > 0 ? "#FCF8EC" : "#fff"} border={dollIssueN > 0 ? "#F0E2BE" : "#E8EAED"}
          labelColor={dollIssueN > 0 ? "#B45309" : "#6B7280"}
          foot={dollIssueN > 0 ? `${[dollShortN > 0 ? `หาย ${dollMissingTotal}` : "", dollOverN > 0 ? `เกิน ${dollOverTotal}` : ""].filter(Boolean).join(" · ")} ตัว${multiPage ? " · หน้านี้" : ""}` : "ตุ๊กตาครบทุกรอบ ✓"}
          footColor={dollIssueN > 0 ? "#B98A2E" : "#8FA99A"}
        />
      </div>

      {/* บรรทัดรอง — รอบตั้งต้น + ตู้เสีย (บริบท ไม่ใช่ปัญหา) โชว์เป็นชิปจาง ไม่ให้แย่งสายตาการ์ดหลัก */}
      {(openN > 0 || baselineN > 0 || brokenN > 0) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {openN > 0 && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#0B69C7", background: "#E5F2FD", border: "1px solid #C9E4FA", borderRadius: 20, padding: "5px 13px" }}>
              <Coins size={13} /> กำลังเก็บ {openN} รอบ · เก็บแล้ว {bahtN(openCashSum)} · ยังไม่ปิด
            </span>
          )}
          {baselineN > 0 && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "#4F46E5", background: "#EEF0FE", border: "1px solid #DEE0FB", borderRadius: 20, padding: "5px 13px" }}>
              <ShieldCheck size={13} /> รอบตั้งต้น {baselineN} รอบ · ปกติ ไม่ต้องสอบ
            </span>
          )}
          {brokenN > 0 && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "#5A6270", background: "#EFF1F4", border: "1px solid #E3E6EA", borderRadius: 20, padding: "5px 13px" }}>
              <AlertTriangle size={13} /> ตู้เสีย/ไม่ขยับ {brokenN} ตู้
            </span>
          )}
        </div>
      )}

      {/* หมายเหตุแบ่งหน้า: การ์ด ตรงกัน/ไม่ตรง/ตู้เสีย นับจากหน้าที่แสดงอยู่ ไม่ใช่ทั้งช่วง */}
      {multiPage && (
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12, fontSize: 11.5, color: "#8A6D3B", background: "#FCF8EC", border: "1px solid #F0E2BE", borderRadius: 9, padding: "7px 12px" }}>
          <Info size={13} color="#B98A2E" style={{ flex: "0 0 13px" }} />
          <span>
            รอบทั้งช่วง <b>{total}</b> รอบ แบ่งเป็น <b>{pageCount}</b> หน้า — ตัวเลข ตรงกัน/ไม่ตรง/ตู้เสีย ด้านบนนับจาก
            <b> หน้านี้</b> ({data.length} รอบ) เท่านั้น · เลื่อนหน้าด้านล่างเพื่อดูรอบที่เหลือ
          </span>
        </div>
      )}

      {/* คำอธิบายสี (legend) — ให้สีในรายการอ่านออกเองได้ */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 11, fontSize: 11.5, color: "#6B7280" }}>
        <span style={{ fontWeight: 600, color: "#9AA1AB" }}>สีสถานะ:</span>
        <LegendDot color="#15803D" label="เขียว = ตรงกัน" />
        <LegendDot color="#B42318" label="แดง = ไม่ตรง · ต้องสอบ" />
        <LegendDot color="#9AA1AB" label="เทา = ตู้เสีย/ไม่ขยับ" />
        <span style={{ color: "#9AA1AB" }}>· ส่วนต่างไม่เกิน {bahtN(CASH_TOLERANCE)} = ถือว่าตรง</span>
      </div>

      {/* หัวรายการ (mockup) — บอกว่านี่คือรอบที่เก็บมาแล้ว + ใบ้ว่าแตะแถวไม่ตรงเพื่อเจาะดูสาเหตุ/ข้อมูลดิบ/รูป */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 11 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#454B54" }}>รอบที่เก็บมาแล้ว · ตรวจกระทบยอด</span>
        <span style={{ fontSize: 11.5, color: "#9AA1AB" }}>แตะแถวไม่ตรงเพื่อดูสาเหตุ · ข้อมูลดิบ · รูปย้อนหลัง</span>
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
            canEdit={canEdit}
          />
        ))}
        {filtered.length === 0 && (
          <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 14 }}>
            {neverCollected ? (
              // ยังไม่เคยเก็บเงินจริงเลย — โชว์ empty-state ตรงไปตรงมา (ไม่ใช่ตัวเลขตัวอย่าง)
              <EmptyState
                icon={<Coins size={30} />}
                title="ยังไม่มีรอบเก็บเงิน"
                sub="เมื่อพนักงานเริ่มเก็บเงินจากตู้ รอบเก็บเงินจะขึ้นมาให้ตรวจกระทบยอดที่นี่"
              />
            ) : allClean ? (
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

      {/* ── ตัวเปลี่ยนหน้า (soft-nav ผ่าน <Link> · คงช่วงวันที่) · โชว์เฉพาะข้อมูลจริง & มีหลายหน้า ── */}
      {multiPage && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 18 }}>
          {hasPrev ? (
            <Link href={pageHref(curPage - 1)} className="co-tap" style={pagerBtnStyle(true)}>
              <ChevronLeft size={15} /> ก่อนหน้า
            </Link>
          ) : (
            <span style={pagerBtnStyle(false)}>
              <ChevronLeft size={15} /> ก่อนหน้า
            </span>
          )}
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "#5A6270", whiteSpace: "nowrap" }}>
            หน้า <b className="num" style={{ color: "#1A1D21" }}>{curPage}</b> จาก <b className="num" style={{ color: "#1A1D21" }}>{pageCount}</b>
          </span>
          {hasNext ? (
            <Link href={pageHref(curPage + 1)} className="co-tap" style={pagerBtnStyle(true)}>
              ถัดไป <ChevronRight size={15} />
            </Link>
          ) : (
            <span style={pagerBtnStyle(false)}>
              ถัดไป <ChevronRight size={15} />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** สไตล์ชิปปุ่มลัดช่วงเวลา — active = indigo ทึบ · enabled = ขาวกดได้ · disabled = จาง */
function quickChipStyle(enabled: boolean, active: boolean): CSSProperties {
  return {
    fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8,
    textDecoration: "none", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center",
    border: active ? "1px solid #4F46E5" : "1px solid #E3E6EA",
    background: active ? "#4F46E5" : "#fff",
    color: active ? "#fff" : enabled ? "#5A6270" : "#C2C7CF",
    cursor: enabled ? "pointer" : "not-allowed",
  };
}

/** สไตล์ปุ่มเปลี่ยนหน้า — enabled = คลิกได้ (indigo) · disabled = จาง กดไม่ได้ */
function pagerBtnStyle(enabled: boolean): CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700,
    padding: "8px 16px", borderRadius: 10, textDecoration: "none",
    border: "1px solid #E3E6EA",
    background: enabled ? "#fff" : "#F7F8FA",
    color: enabled ? "#4F46E5" : "#C2C7CF",
    cursor: enabled ? "pointer" : "not-allowed",
  };
}

/* ───────── hero card (mockup gradient · รอบทั้งหมด + แถบตรงกัน) ───────── */
function HeroCard({
  total, matchN, pageTotal, pct, multiPage, curPage, pageCount,
}: {
  total: number; matchN: number; pageTotal: number; pct: number;
  multiPage: boolean; curPage: number; pageCount: number;
}) {
  return (
    <div style={{ background: "linear-gradient(135deg,#4F46E5,#6D5CE8)", borderRadius: 14, padding: "16px 18px", color: "#fff" }}>
      <div style={{ fontSize: 12, color: "#D7D5FA", marginBottom: 9 }}>รอบเก็บเงินทั้งหมด</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
        <span className="num" style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{total}</span>
        <span className="num" style={{ fontSize: 15, color: "#CFCBFA" }}>รอบ</span>
      </div>
      <div style={{ height: 7, background: "rgba(255,255,255,0.22)", borderRadius: 6, marginTop: 11, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: "#fff", borderRadius: 6 }} />
      </div>
      <div className="num" style={{ fontSize: 11, color: "#D7D5FA", marginTop: 6 }}>
        ตรงกัน {matchN}/{pageTotal} รอบ{multiPage ? ` · หน้า ${curPage}/${pageCount}` : ""} · {pct}%
      </div>
    </div>
  );
}

/* ───────── day summary (CEO 2026-08-01 · "วันนี้สาขานี้ทำอะไรบ้าง") ───────── */
function DaySummaryCard({
  dateLabel, branchAll, s,
}: {
  dateLabel: string;
  branchAll: boolean;
  s: { totalMachines: number; collected: number; notCollected: number; baseline: number; refill: number; cashBaht: number };
}) {
  const pill = (label: string, value: string | number, color: string, bg: string) => (
    <div style={{ background: bg, borderRadius: 10, padding: "8px 13px", minWidth: 78 }}>
      <div style={{ fontSize: 10.5, color: "#6B7280" }}>{label}</div>
      <div className="num" style={{ fontSize: 17, fontWeight: 700, color }}>{value}</div>
    </div>
  );
  return (
    <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 14, padding: "13px 16px", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <Calendar size={14} color="#4F46E5" />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "#1A1D21" }}>สรุปวันที่ {dateLabel}</span>
        <span style={{ fontSize: 11.5, color: "#9AA1AB" }}>· {branchAll ? "ทุกสาขา" : "สาขาที่เลือก"} · นับตามตู้</span>
        <span style={{ flex: 1 }} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 700, color: "#0B69C7", background: "#E5F2FD", borderRadius: 20, padding: "5px 13px" }}>
          <Coins size={13} /> เงินวันนี้ {bahtN(s.cashBaht)}
        </span>
      </div>
      <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
        {pill("ตู้ทั้งหมด", s.totalMachines, "#1A1D21", "#F5F6F8")}
        {pill("เก็บเงินแล้ว", s.collected, "#15803D", "#EAF6EF")}
        {pill("ยังไม่เก็บ", s.notCollected, s.notCollected > 0 ? "#B45309" : "#5A6270", s.notCollected > 0 ? "#FCF6EC" : "#F5F6F8")}
        {pill("ตั้งค่าใหม่", s.baseline, "#4F46E5", "#EEF0FE")}
        {pill("เติมตุ๊กตา", s.refill, "#0B69C7", "#E5F2FD")}
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
      <div style={{ fontSize: 12, color: labelColor, marginBottom: 8 }}>{label}</div>
      <div className="num" style={{ fontSize: 24, fontWeight: 700, color: valueColor }}>{value}</div>
      {foot && <div style={{ fontSize: 11, color: footColor, marginTop: 2 }}>{foot}</div>}
    </div>
  );
}

/* ───────── one collection round (row + drill-down) ───────── */
function CollectionCard({
  row, open, onToggle, reviewState, onReview, busy, canEdit,
}: {
  row: CollectionRow;
  open: boolean;
  onToggle: () => void;
  reviewState: ReviewState;
  onReview: (d: V2Decision) => void;
  busy: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  // รูปที่กดขยาย (lightbox) — null = ปิด
  const [lightbox, setLightbox] = useState<{ url: string; label: string } | null>(null);
  // หลังบ้านแก้เลข (admin/ผจก.) — target = ตู้ที่กำลังแก้ · null = ปิด
  const [editTarget, setEditTarget] = useState<
    { eventId: string; label: string; cash: string; coin: string; doll: string } | null
  >(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  async function saveEdit() {
    if (!editTarget) return;
    setEditBusy(true);
    setEditErr(null);
    try {
      const res = await adminEditCollectionEvent({
        eventId: editTarget.eventId,
        cashCents: Math.round((Number(editTarget.cash) || 0) * 100),
        coinMeterAfter: Math.round(Number(editTarget.coin) || 0),
        dollMeterAfter: editTarget.doll === "" ? null : Math.round(Number(editTarget.doll) || 0),
      });
      if (!res.ok) { setEditErr(res.error || "แก้ไม่สำเร็จ"); setEditBusy(false); return; }
      setEditTarget(null);
      setEditBusy(false);
      router.refresh(); // โหลดยอดที่คำนวณใหม่จาก server (force-dynamic)
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : "แก้ไม่สำเร็จ");
      setEditBusy(false);
    }
  }
  const st = statusOf(row);
  const meta = STATUS_META[st];
  const diffColor = row.gap > CASH_TOLERANCE ? "#B42318" : row.gap > 0 ? "#B45309" : row.gap < 0 ? "#B45309" : "#15803D";
  // ส่วนต่างเป็นคำพูด: ตรงกัน / ขาด ฿x / เกิน ฿x (ไม่โชว์เลขติดลบให้งง)
  const diffStr = gapWords(row.gap);
  const rowBg = open ? "#FCFCFD" : "#fff";

  // baseline = รอบตั้งต้น (ตั้งมิเตอร์ครั้งแรก) — ห้ามโชว์ "ควรได้/ส่วนต่าง" ให้ตกใจ
  const baseline = st === "baseline";
  // inProgress = รอบกำลังเก็บ (OPEN) — โชว์ "X/Y ตู้" แทน "ควรได้/ส่วนต่าง" · ยังไม่กระทบยอด
  const inProgress = st === "open";
  // ตุ๊กตา at-a-glance สำหรับหัวแถว (CEO ขอเห็นเช็คตุ๊กตาชัด) — ตรง/หาย X/— (ไม่มีข้อมูล)
  const dollHasData = row.prizeExpected !== 0 || row.prizeActual !== 0;
  const dollStr = !dollHasData ? "—" : row.prizeGap > 0 ? `หาย ${row.prizeGap}` : row.prizeGap < 0 ? `เกิน ${-row.prizeGap}` : "ตรง";
  const dollStatColor = row.prizeGap !== 0 ? "#B45309" : "#15803D";
  // รูปหลักฐานจริงทั้งรอบ (ทุกตู้) — โชว์เป็นบล็อกตัวอย่างตอนยังไม่กดกาง
  // interleave 1 รูป/ตู้ ก่อน → รอบหลายตู้เห็นครบทุกตู้ในแถบย่อ (ไม่ให้ตู้แรกกินโควตาหมด)
  const previewShots = (() => {
    const perMachine = row.machines.map((m) => m.photoShots.filter((s) => s.url));
    const out: { label: string; url: string | null }[] = [];
    const maxLen = perMachine.reduce((n, a) => Math.max(n, a.length), 0);
    for (let i = 0; i < maxLen; i++) {
      for (const arr of perMachine) {
        const shot = arr[i];
        if (shot) out.push(shot);
      }
    }
    return out;
  })();

  // item 5 (office side) · "รูปยังไม่ครบ" — ตู้ในรอบนี้ยังขาดรูปหลักฐาน (มิเตอร์/สต็อก) ที่ url=null.
  //  ไม่นับรูปเงินสด (label "เงินสด" · optional · CEO 2026-07-11) — สอดคล้องกับฝั่งมือถือ (deriveHistoryPhotosMissing).
  //  เฉพาะ real tier ที่มี machines[].photoShots จริง (sample = [] → ไม่โชว์ชิป).
  //  baseline (รอบตั้งต้น) รูปเป็น optional ฝั่งกรอก → ไม่เตือน "รูปยังไม่ครบ" (เดิมเตือนหลอนทุกใบ
  //  เพราะฝั่งอ่านบังคับ 7 รูป แต่ฝั่งกรอกไม่บังคับ). รอบเก็บจริง (COLLECTION) ยังเตือนตามเดิม (กันโกง).
  const photosMissing = !isBaselineRow(row) && row.machines.some((m) =>
    m.photoShots.some((s) => s.label !== "เงินสด" && !s.url),
  );

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
    inProgress ? `รอบนี้ยังเก็บไม่จบ (${row.collectedCount ?? 0}/${row.machineTotal ?? 0} ตู้) — เก็บครบแล้วระบบจะปิดรอบ + กระทบยอดให้เอง`
      : baseline ? "รอบตั้งต้น — ตั้งค่ามิเตอร์ครั้งแรกของตู้ ถือว่าปกติ · อนุมัติเพื่อเริ่มนับรอบถัดไป"
      : st === "broken" ? "ตู้ไม่ขยับ — ส่งช่างเช็คเซ็นเซอร์/มอเตอร์ ก่อนเปิดรอบถัดไป"
        : row.gap > 50 ? "เงินขาดเกินเกณฑ์ — เรียกพนักงานยืนยันยอด + เทียบรูปเงินสดกับมิเตอร์"
          : row.prizeGap > 0 ? "ตุ๊กตาหาย — ตรวจสต๊อกในตู้ + รูปก่อน/หลังเติม"
            : row.prizeGap < 0 ? "ตุ๊กตาเกิน — นับได้มากกว่าที่มิเตอร์บอก เช็คนับซ้ำ หรือมีคนเติมไม่ลงระบบ"
              : "ทุกตัวเลขตรงกัน — อนุมัติเข้ารายงานได้เลย";
  const actionColor = inProgress ? "#0B69C7" : baseline ? "#4F46E5" : st === "diff" ? "#B42318" : st === "broken" ? "#B45309" : "#15803D";

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
  const photoMachines: {
    code: string; name: string; shots: { label: string; url: string | null }[];
    entered?: { k: string; v: string }[]; kind?: string; isInitial?: boolean;
    eventId?: string; coin?: number; doll?: number; cash?: number;
  }[] =
    row.machines.length > 0
      ? row.machines.map((m) => ({
          code: m.code,
          name: m.name,
          shots: m.photoShots.length > 0
            ? m.photoShots
            : FALLBACK_LABELS.map((label) => ({ label, url: null })),
          entered: m.entered,
          kind: m.kind,
          isInitial: m.isInitial,
          eventId: m.eventId,
          coin: m.coinMeterAfter,
          doll: m.dollMeterAfter,
          cash: m.cashBaht,
        }))
      : [{ code: "", name: "", shots: FALLBACK_LABELS.map((label) => ({ label, url: null })) }];

  // severity left-accent — แดง=ไม่ตรง · เทา=ตู้เสีย · เขียว=ตรงกัน (อ่านระดับได้ตั้งแต่ขอบซ้าย)
  const accent = st === "diff" ? "#B42318" : st === "broken" ? "#9AA1AB" : "#15803D";

  // ── แผงเจาะสำหรับรอบ "ไม่ตรง" (mockup c.isDiff) — ข้อมูลดิบ + checklist สาเหตุ ──
  //   ทั้งหมดเป็น DISPLAY ของฟิลด์ที่มีอยู่แล้วบน row (ไม่คิดเงินใหม่ · ไม่แตะ reconcile math)
  const rawRows: { k: string; v: string }[] = [
    {
      k: "มิเตอร์เหรียญ (ก่อน → หลัง)",
      v: meterBefore != null && meterAfter != null ? `${meterBefore} → ${meterAfter}` : "— ไม่มีเลขมิเตอร์ในรอบนี้",
    },
    { k: "มิเตอร์ควรได้", v: bahtN(row.expectedCash) },
    { k: "เงินสดนับได้", v: bahtN(row.actualCash) },
    { k: "ส่วนต่างเงิน", v: diffStr },
    { k: "ตุ๊กตา ควรหาย → นับจริง", v: `${row.prizeExpected} → ${row.prizeActual} ตัว` },
    { k: "พนักงานเก็บ", v: row.staff },
  ];
  // สาเหตุที่เป็นไปได้ — likely=true เมื่อข้อมูลจริงชี้ไปทางนั้น (ติดป้าย "น่าจะใช่") · ไม่ใช่การคำนวณเงิน
  const causeChecks: { likely: boolean; label: string; hint: string }[] = [
    { likely: row.gap > CASH_TOLERANCE, label: "เงินขาด — เก็บไม่ครบ/หยิบออก", hint: "เงินสดที่นับได้น้อยกว่าที่มิเตอร์บอกว่าควรได้ · เทียบรูปเงินสดกับเลขมิเตอร์" },
    { likely: row.gap < -CASH_TOLERANCE, label: "เงินเกิน — ทอน/นับเกิน", hint: "เงินสดมากกว่าที่มิเตอร์บอก · อาจนับซ้ำ หรือมีเงินรอบก่อนตกค้างในตู้" },
    { likely: row.prizeGap > 0, label: "ตุ๊กตาหาย — คนหยิบ/ตู้คายเกิน", hint: `มิเตอร์บอกออก ${row.prizeExpected} แต่นับได้ ${row.prizeActual} · ตรวจสต๊อกในตู้ + รูปก่อน/หลังเติม` },
    { likely: row.prizeGap < 0, label: "ตุ๊กตาเกิน — เติมไม่ลงระบบ", hint: "นับได้มากกว่าที่มิเตอร์บอกว่าออก · อาจมีคนเติมตุ๊กตาโดยไม่บันทึก" },
    { likely: photosMissing, label: "รูปหลักฐานไม่ครบ — ตรวจย้อนไม่ได้", hint: "บางตู้ยังไม่มีรูปมิเตอร์/สต๊อก · เรียกพนักงานส่งรูปเพิ่มเพื่อยืนยัน" },
    { likely: false, label: "กรอกเลขมิเตอร์ผิด", hint: "ลองเทียบเลขในรูปมิเตอร์กับเลขที่กรอก — พิมพ์ตกหลัก/สลับตัวเลขทำให้ส่วนต่างเพี้ยน" },
  ];

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
          {st === "match" ? <Check size={18} /> : st === "baseline" ? <ShieldCheck size={17} /> : <AlertTriangle size={17} />}
        </span>
        <div style={{ flex: "0 0 158px", minWidth: 130 }}>
          <div className="num" style={{ fontSize: 14.5, fontWeight: 700 }}>
            {row.code} <span style={{ fontWeight: 500, color: "#6B7280", fontSize: 12.5 }}>· {row.branch}</span>
          </div>
          <div style={{ fontSize: 11.5, color: "#9AA1AB", marginTop: 2 }}>{row.staff} · {row.date}</div>
        </div>
        <div style={{ display: "flex", gap: 26, flex: 1, minWidth: 220, flexWrap: "wrap" }}>
          <Stat label="เก็บเงินได้" value={bahtN(row.actualCash)} />
          {baseline ? (
            // baseline: ไม่โชว์ "ควรได้/ส่วนต่าง" (ไม่มีมิเตอร์เก่าเทียบ) — โชว์ว่าเป็นยอดตั้งต้น
            <Stat label="ประเภท" value="ยอดตั้งต้น" color="#4F46E5" />
          ) : inProgress ? (
            // กำลังเก็บ: โชว์ความคืบหน้า X/Y ตู้ แทน "ควรได้/ส่วนต่าง" (ยังไม่กระทบยอด)
            <Stat label="กำลังเก็บ" value={`${row.collectedCount ?? 0}/${row.machineTotal ?? 0} ตู้`} color="#0B69C7" />
          ) : (
            <>
              <Stat label="มิเตอร์ควรได้" value={bahtN(row.expectedCash)} />
              <Stat label="ส่วนต่างเงิน" value={diffStr} color={diffColor} />
            </>
          )}
          {/* เช็คตุ๊กตา at-a-glance — ออกตรงมิเตอร์ไหม (CEO ขอ) */}
          <Stat label="ตุ๊กตา" value={baseline ? "ตั้งต้น" : inProgress ? "—" : dollStr} color={baseline ? "#4F46E5" : inProgress ? "#9AA1AB" : dollStatColor} />
        </div>
        {/* item 5 · ชิปเล็ก "รูปยังไม่ครบ" (amber · จาง) — ตู้ในรอบยังขาดรูปหลักฐาน (ไม่นับรูปเงินสด).
            ใช้ได้ทั้งรอบปกติและรอบตั้งต้น (isBaseline) · แค่ context ไม่ใช่ error → วางก่อนป้ายสถานะ ไม่แย่งสายตา. */}
        {photosMissing && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, background: "#FCF1E2", color: "#B45309", whiteSpace: "nowrap" }}>
            <ImageOff size={12} /> รูปยังไม่ครบ
          </span>
        )}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, padding: "6px 13px", borderRadius: 20, background: meta.bg, color: meta.color, whiteSpace: "nowrap" }}>
          {meta.label}
        </span>
        <span style={{ color: "#C2C7CF", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s", display: "inline-flex" }}>
          <ChevronRight size={18} />
        </span>
      </button>

      {/* บล็อกรูปหลักฐาน (เห็นตั้งแต่ยังไม่กดกาง) — CEO: "ต้องมีบล็อกรูปให้ดู" · กดรูปเพื่อขยายเทียบเลข */}
      {!open && previewShots.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 20px 14px 74px", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "#9AA1AB", display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
            <ZoomIn size={12} /> รูปหลักฐาน
          </span>
          {previewShots.slice(0, 6).map((s, i) => (
            <button
              key={`${s.label}-${i}`}
              type="button"
              onClick={() => setLightbox({ url: s.url as string, label: s.label })}
              title={`${s.label} — กดเพื่อดูรูปเต็ม`}
              className="co-tap co-lift"
              style={{ width: 54, height: 40, borderRadius: 8, overflow: "hidden", border: "1px solid #E8EAED", padding: 0, cursor: "pointer", background: "#EFF1F4", flex: "0 0 54px" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element — เลี่ยง next/image remote-domain config */}
              <img src={s.url as string} alt={s.label} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            </button>
          ))}
          {previewShots.length > 6 && (
            <span style={{ fontSize: 11, color: "#9AA1AB", fontWeight: 600 }}>+{previewShots.length - 6} รูป</span>
          )}
        </div>
      )}

      {/* drill-down */}
      {open && (
        <div style={{ padding: "4px 20px 20px" }}>
          {baseline ? (
            // รอบตั้งต้น — อธิบายให้ชัดว่าปกติ ไม่ใช่ "เงินเกิน" (เดิมโชว์ "เกิน ฿100" ทำ CEO งง)
            <div style={{ borderTop: "1px dashed #E2E5EA", paddingTop: 16 }}>
              <div style={{ background: "#EEF0FE", border: "1px solid #DEE0FB", borderRadius: 12, padding: "15px 17px", display: "flex", gap: 11, alignItems: "flex-start" }}>
                <ShieldCheck size={20} color="#4F46E5" style={{ flex: "0 0 20px", marginTop: 1 }} />
                <div style={{ fontSize: 12.5, color: "#3F3D6B", lineHeight: 1.65 }}>
                  <b style={{ color: "#4F46E5" }}>รอบตั้งต้น (baseline)</b> — ตั้งค่ามิเตอร์เริ่มต้นของตู้ครั้งแรก
                  ยังไม่มีรอบก่อนหน้าไว้เทียบ ระบบจึง<b>ยังไม่คิด “ควรได้/ส่วนต่าง”</b> ในรอบนี้<br />
                  เงินที่เก็บได้ <b className="num" style={{ color: "#1A1D21" }}>{bahtN(row.actualCash)}</b>
                  {dollHasData && <> · ตุ๊กตาตั้งต้น <b className="num" style={{ color: "#1A1D21" }}>{row.prizeActual} ตัว</b></>}
                  {" "}บันทึกเป็น<b>ยอดเริ่มต้น</b>ของตู้ — ถือว่าปกติ ไม่ต้องสอบ · รอบถัดไปจะเริ่มกระทบยอดกับมิเตอร์จริง
                </div>
              </div>
            </div>
          ) : inProgress ? (
            // รอบกำลังเก็บ (OPEN) — เงินขึ้นแล้วแต่ยังเก็บไม่ครบทุกตู้ · กระทบยอดคำนวณตอนปิดรอบ
            <div style={{ borderTop: "1px dashed #E2E5EA", paddingTop: 16 }}>
              <div style={{ background: "#E5F2FD", border: "1px solid #C9E4FA", borderRadius: 12, padding: "15px 17px", display: "flex", gap: 11, alignItems: "flex-start" }}>
                <Coins size={20} color="#0B69C7" style={{ flex: "0 0 20px", marginTop: 1 }} />
                <div style={{ fontSize: 12.5, color: "#0C4A7A", lineHeight: 1.65 }}>
                  <b style={{ color: "#0B69C7" }}>รอบกำลังเก็บ</b> — พนักงานเก็บไปแล้ว{" "}
                  <b className="num" style={{ color: "#1A1D21" }}>{row.collectedCount ?? 0}/{row.machineTotal ?? 0} ตู้</b>{" "}
                  เงินที่เก็บได้ตอนนี้ <b className="num" style={{ color: "#1A1D21" }}>{bahtN(row.actualCash)}</b> (บันทึกครบ · ดูรูปด้านล่างได้)<br />
                  ระบบจะ<b>กระทบยอด (เทียบมิเตอร์ ↔ เงินสด)</b> ให้อัตโนมัติเมื่อเก็บครบทุกตู้แล้วปิดรอบ — ตอนนี้ยังไม่ต้องสอบ
                </div>
              </div>
            </div>
          ) : (
          <div style={{ borderTop: "1px dashed #E2E5EA", paddingTop: 16 }} className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            {/* doll track */}
            <div style={{ background: dollOk ? "#F7F8FA" : "#FFF9F8", borderRadius: 12, padding: "15px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <PrizeIcon />
                <span style={{ fontSize: 13, fontWeight: 700 }}>เส้นทางตุ๊กตา</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11.5, fontWeight: 700, color: dollOk ? "#15803D" : "#B42318" }}>
                  {dollOk ? "ตรงกัน" : row.prizeGap > 0 ? `หาย ${row.prizeGap} ตัว` : `เกิน ${-row.prizeGap} ตัว`}
                </span>
              </div>
              <div className="num" style={{ fontSize: 12.5, color: "#5A6270", marginBottom: 9, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>มิเตอร์ <b style={{ color: "#1A1D21" }}>{row.prizeExpected}</b></span>
                <span style={{ color: "#C2C7CF" }}>→</span>
                <span><b style={{ color: "#1A1D21" }}>นับจริง {row.prizeActual}</b></span>
                <span style={{ background: "#fff", border: "1px solid #E3E6EA", borderRadius: 6, padding: "1px 7px", fontWeight: 600, color: dollOk ? "#4F46E5" : "#B42318" }}>
                  {dollOk ? "ตรง" : row.prizeGap > 0 ? `หาย ${row.prizeGap}` : `เกิน ${-row.prizeGap}`}
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: "#5A6270" }}>
                ตุ๊กตาควรหาย <b className="num" style={{ color: "#1A1D21" }}>{row.prizeExpected} ตัว</b> · นับจริงได้ <b className="num" style={{ color: "#1A1D21" }}>{row.prizeActual} ตัว</b>
                {row.prizeGap > 0 && <> · หาย <b className="num" style={{ color: "#B42318" }}>{row.prizeGap} ตัว</b></>}
                {row.prizeGap < 0 && <> · เกิน <b className="num" style={{ color: "#B42318" }}>{-row.prizeGap} ตัว</b></>}
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
          )}

          {/* หมายเหตุ: แบนเนอร์ "มิเตอร์ต่อเนื่อง" ถูกเอาออก — เดิม hardcode 18420 ทำให้โชว์ไฟเขียว
             "ผ่าน" กับทุกแถวโดยไม่ได้ตรวจจริง (ฟีเจอร์กันโกง ห้ามโชว์ผลปลอม). จะกลับมาใส่เมื่อ
             query ส่งเลขมิเตอร์ปิดรอบก่อน/เปิดรอบนี้จริงมา (CollectionRow ยังไม่มี field นี้) */}

          {/* รูปจริงที่พนักงานถ่าย (anti-cheat) — แยกต่อตู้ · กดรูปเพื่อขยายตรวจ */}
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9 }}>
              <ZoomIn size={13} color="#9AA1AB" style={{ flex: "0 0 13px" }} />
              <span className="co-eyebrow">
                ข้อมูลที่พนักงานกรอก + รูปหลักฐานจริง · กดรูปเพื่อขยายเทียบว่าเลขในรูปตรงกับที่กรอก
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {photoMachines.map((m, mi) => {
                // มีรูปจริงอย่างน้อย 1 รูปไหม — ถ้าไม่มีเลย → ซ่อนกริด 5 ช่อง โชว์บรรทัดเดียว
                const hasAnyPhoto = m.shots.some((s) => s.url);
                return (
                  <div key={m.code || `m-${mi}`}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
                      {m.name && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color: "#5A6270" }}>
                          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#C2C7CF", flex: "0 0 5px" }} />
                          {m.name} {m.code && <span style={{ color: "#9AA1AB", fontWeight: 500 }}>· {m.code}</span>}
                        </div>
                      )}
                      {/* CEO 2026-07-25 · หลังบ้านแก้เลขที่พนักงานกรอกผิด (ดูรูป → แก้ → คำนวณใหม่)
                          เฉพาะตู้คีบรอบปกติ — adminEditCollectionEvent กรอง eventType=COLLECTION + แก้ช่องตุ๊กตา
                          → รอบตั้งต้น (INITIAL) และตู้แลก (EXCHANGER) ปิดปุ่มไว้ กันกดแล้ว error/เพี้ยน */}
                      {canEdit && m.eventId && !m.isInitial && m.kind !== "EXCHANGER" && (
                        <button
                          type="button"
                          onClick={() => setEditTarget({
                            eventId: m.eventId as string,
                            label: `${m.name || "ตู้"}${m.code ? ` · ${m.code}` : ""}`,
                            cash: m.cash != null ? String(m.cash) : "",
                            coin: m.coin != null ? String(m.coin) : "",
                            doll: m.doll != null ? String(m.doll) : "",
                          })}
                          style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "#4F46E5", background: "#EEF0FE", border: "none", borderRadius: 8, padding: "4px 10px", cursor: "pointer" }}
                        >
                          <Pencil size={12} /> แก้เลข
                        </button>
                      )}
                    </div>
                    {/* ข้อมูลที่พนักงานกรอกจริงทุกช่อง (kind-aware · จัดรูปฝั่ง server) — กริด 2 คอลัมน์ให้แน่น
                        วางไว้เหนือรูป → ผู้ตรวจเทียบ "เลขที่กรอก" กับ "เลขในรูป" ได้ในสายตาเดียว */}
                    {m.entered && m.entered.length > 0 && (
                      <div
                        className="grid grid-cols-1 sm:grid-cols-2 gap-x-5"
                        style={{ marginBottom: 10, background: "#FAFBFC", border: "1px solid #EEF0F3", borderRadius: 10, padding: "4px 13px" }}
                      >
                        {m.entered.map((rw, ri) => (
                          <div key={`${rw.k}-${ri}`} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "6px 0", borderBottom: "1px solid #F1F2F5" }}>
                            <span style={{ flex: 1, fontSize: 11, color: "#6B7280", lineHeight: 1.35 }}>{rw.k}</span>
                            <span className="num" style={{ fontSize: 11.5, fontWeight: 600, color: "#1A1D21", textAlign: "right", wordBreak: "break-word" }}>{rw.v}</span>
                          </div>
                        ))}
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

          {/* c.isDiff — ข้อมูลดิบของตู้นี้ + checklist สาเหตุ (เฉพาะรอบ "ไม่ตรง · ต้องสอบ") */}
          {st === "diff" && (
            <div style={{ marginTop: 14 }} className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
              {/* ข้อมูลดิบ */}
              <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#454B54", marginBottom: 10 }}>ข้อมูลดิบของตู้นี้ (ใช้วิเคราะห์)</div>
                {rawRows.map((rw, i) => (
                  <div key={rw.k} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: i < rawRows.length - 1 ? "1px solid #F4F5F7" : "none" }}>
                    <span style={{ flex: 1, fontSize: 11.5, color: "#6B7280" }}>{rw.k}</span>
                    <span className="num" style={{ fontSize: 12, fontWeight: 600, color: "#1A1D21" }}>{rw.v}</span>
                  </div>
                ))}
              </div>
              {/* สาเหตุที่เป็นไปได้ — ไล่ตรวจทีละข้อ */}
              <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#454B54", marginBottom: 10 }}>สาเหตุที่เป็นไปได้ — ไล่ตรวจทีละข้อ</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {causeChecks.map((cc) => (
                    <div key={cc.label} style={{ display: "flex", alignItems: "flex-start", gap: 9, background: cc.likely ? "#FFF9F8" : "#F7F8FA", border: `1px solid ${cc.likely ? "#F3D9D5" : "#EFF1F4"}`, borderRadius: 9, padding: "8px 11px" }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: cc.likely ? "#B42318" : "#C2C7CF", flex: "0 0 8px", marginTop: 4 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "#3A3F47" }}>{cc.label}</span>
                          {cc.likely && (
                            <span style={{ fontSize: 9.5, fontWeight: 700, color: "#B42318", background: "#FBDAD5", padding: "1px 7px", borderRadius: 20 }}>น่าจะใช่</span>
                          )}
                        </div>
                        <div style={{ fontSize: 10.5, color: "#9AA1AB", marginTop: 2, lineHeight: 1.4 }}>{cc.hint}</div>
                      </div>
                    </div>
                  ))}
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
            {inProgress ? (
              <div style={{ fontSize: 11.5, color: "#0B69C7", background: "#E5F2FD", borderRadius: 8, padding: "8px 12px", lineHeight: 1.5 }}>
                รอบนี้ยังเก็บไม่จบ · ตรวจกระทบยอดได้เมื่อเก็บครบทุกตู้แล้วระบบปิดรอบ
              </div>
            ) : (
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
            )}
          </div>
        </div>
      )}

      {/* lightbox overlay (card-level — เปิดได้ทั้งจากบล็อกรูปตัวอย่าง และตอนกางเต็ม) */}
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

      {/* CEO 2026-07-25 · หลังบ้านแก้เลข (admin/ผจก.) — คำนวณกระทบยอดใหม่อัตโนมัติ + ต่อลูกโซ่รอบถัดไป */}
      {editTarget && (
        <div role="dialog" aria-modal="true" onClick={() => !editBusy && setEditTarget(null)}
          style={{ position: "fixed", inset: 0, zIndex: 95, background: "rgba(13,15,20,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 340, background: "#fff", borderRadius: 16, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "13px 16px", borderBottom: "1px solid #EEF0F3" }}>
              <Pencil size={15} color="#4F46E5" />
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700 }}>แก้เลข · {editTarget.label}</span>
              <button type="button" onClick={() => !editBusy && setEditTarget(null)} aria-label="ปิด"
                style={{ width: 30, height: 30, borderRadius: 9, background: "#F1F2F5", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <X size={15} color="#454B54" />
              </button>
            </div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 11 }}>
              <div style={{ fontSize: 11, color: "#8A909A", lineHeight: 1.5 }}>ดูรูปหลักฐานแล้วแก้เลขที่พนักงานกรอกผิด · ระบบจะคำนวณยอด/ส่วนต่างใหม่ + ต่อรอบถัดไปให้เอง</div>
              {[
                { k: "cash" as const, label: "เงินสดที่เก็บได้ (บาท)" },
                { k: "coin" as const, label: "มิเตอร์เหรียญ (เลขหลัง)" },
                { k: "doll" as const, label: "มิเตอร์ตุ๊กตา (เลขหลัง)" },
              ].map((f) => (
                <label key={f.k} style={{ display: "block" }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: "#5A6270" }}>{f.label}</span>
                  <input inputMode="numeric" value={editTarget[f.k]}
                    onChange={(e) => setEditTarget({ ...editTarget, [f.k]: e.target.value })}
                    style={{ width: "100%", marginTop: 4, fontSize: 15, fontWeight: 700, textAlign: "right", padding: "9px 11px", border: "1.5px solid #C7CBD2", borderRadius: 9 }} />
                </label>
              ))}
              {editErr && <div style={{ fontSize: 11.5, color: "#B42318", background: "#FCEDEC", borderRadius: 8, padding: "8px 11px", lineHeight: 1.45 }}>{editErr}</div>}
              <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                <button type="button" onClick={() => setEditTarget(null)} disabled={editBusy}
                  style={{ flex: "0 0 auto", fontSize: 12.5, fontWeight: 700, color: "#5A6270", background: "#F1F2F5", border: "none", borderRadius: 9, padding: "10px 18px", cursor: editBusy ? "default" : "pointer" }}>ยกเลิก</button>
                <button type="button" onClick={saveEdit} disabled={editBusy}
                  style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: "#fff", background: editBusy ? "#9AA1AB" : "#15803D", border: "none", borderRadius: 9, padding: 10, cursor: editBusy ? "default" : "pointer" }}>{editBusy ? "กำลังบันทึก…" : "บันทึก + คำนวณใหม่"}</button>
              </div>
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
