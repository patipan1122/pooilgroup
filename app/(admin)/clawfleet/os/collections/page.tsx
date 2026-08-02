/**
 * ตู้คีบ OS — ตรวจเงิน & กระทบยอด (Collections / Audit)
 * Server: "รอบเก็บเงินทั้งหมด" ที่ปิดแล้วในช่วงวันที่ที่เลือก (default 30 วันล่าสุด)
 *         → แบ่งหน้า (pageSize ~50) กัน payload บาน · total = จำนวนรอบจริงทั้งช่วง.
 *         การ์ด "รอบทั้งหมด" ใช้ total จริง · การ์ด ตรงกัน/ไม่ตรง/ตู้เสีย นับจากหน้าปัจจุบัน
 *         (ป้ายในหน้าอธิบายให้ชัด — client รู้แค่หน้าที่โหลดมา).
 * ถ้า DB ว่าง → client ใช้ SAMPLE fallback + แบนเนอร์ "กำลังแสดงตัวอย่าง"
 * (ตาม pattern ClawFleet เดิม — ห้ามหน้าโล่ง).
 *
 * ช่วงวันที่ + หน้า มาจาก searchParams (?from=&to=&page=) → soft-nav ผ่าน next/link ในฝั่ง client.
 */
import { getV2AllRounds, getV2Branches, orgHasAnyRounds, getDaySummaries, type DaySummary } from "@/lib/clawfleet/queries";
import { CollectionsClient, type CollectionRow, type BranchOption } from "./collections-client";
import { requireSession } from "@/lib/auth/session";
import { isCfAdmin, isCfBranchManager } from "@/lib/clawfleet/role-guard";

export const dynamic = "force-dynamic";

/** แปลง "YYYY-MM-DD" (จาก <input type=date>) → Date ต้นวัน/ปลายวัน · ค่าเสีย → undefined (graceful) */
function parseDateStart(s?: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
function parseDateEnd(s?: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(`${s}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** วันที่ตามปฏิทินไทย (Asia/Bangkok) — ให้ default ฝั่ง server ตรงกับปุ่มลัดฝั่ง client (local ไทย)
 *  เดิม toISOString() = UTC → ช่วงเที่ยงคืน–ตี 7 น. วันที่ต่างจากไทย 1 วัน (ปุ่มลัดไฮไลต์เพี้ยน) */
function bangkokISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  // en-CA → รูปแบบ "YYYY-MM-DD"
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(d);
}
/** default ช่วง = 30 วันล่าสุด (ให้ค่า input ตรงกับที่ query ใช้จริงเมื่อไม่ได้เลือกเอง) */
function defaultFromISO(): string {
  return bangkokISO(-30);
}
function todayISO(): string {
  return bangkokISO(0);
}

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; page?: string }>;
}) {
  const sp = await searchParams;

  // ช่วงวันที่: ถ้าไม่ได้เลือก "หรือ" ค่าใน URL เป็นขยะ (parse ไม่ได้) → default 30 วันล่าสุด
  // สำคัญ: fromISO/toISO ที่ส่งเข้า client (banner + input) ต้อง derive จากวันที่ parse "ผ่านจริง" เท่านั้น
  //        ไม่งั้นค่าขยะใน ?from=xyz จะโชว์บนป้าย/ช่องกรอก ทั้งที่ query fallback 30 วันไปแล้ว (ป้ายไม่ตรง query)
  const parsedFrom = parseDateStart(sp.from);
  const parsedTo = parseDateEnd(sp.to);
  const fromISO = parsedFrom ? sp.from! : defaultFromISO();
  const toISO = parsedTo ? sp.to! : todayISO();
  const from = parsedFrom ?? parseDateStart(fromISO);
  const to = parsedTo ?? parseDateEnd(toISO);

  const pageNum = Math.max(1, Math.floor(Number(sp.page) || 1));

  let rounds: Awaited<ReturnType<typeof getV2AllRounds>>["rounds"] = [];
  let branches: Awaited<ReturnType<typeof getV2Branches>> = [];
  // total/page/pageSize จาก query — total = รอบทั้งหมดในช่วง (ก่อนตัดหน้า)
  let total = 0;
  let page = pageNum;
  let pageSize = 50;
  // hasAnyRounds = org เคยมีรอบใด ๆ (ทุกสถานะ/ทุกเวลา) — ตัดสิน sample-vs-empty.
  let hasAnyRounds = false;
  // สรุปรายวัน (เฉพาะช่วงวันเดียว · หลายวัน → null → การ์ดไม่ขึ้น)
  let daySummaries: DaySummary[] | null = null;
  try {
    const [res, br, everHad, days] = await Promise.all([
      getV2AllRounds({ from, to, page: pageNum }),
      getV2Branches(),
      orgHasAnyRounds(),
      from && to ? getDaySummaries(from, to) : Promise.resolve(null),
    ]);
    rounds = res.rounds;
    total = res.total;
    page = res.page;
    pageSize = res.pageSize;
    branches = br;
    hasAnyRounds = everHad;
    daySummaries = days;
  } catch {
    // graceful: DB ว่าง/ยังไม่ migrate → client ใช้ sample fallback
  }

  // แอดมิน/ผู้จัดการสาขา = แก้เลขหลังบ้านได้ (ปุ่ม "แก้เลข") · server บังคับสิทธิ์ซ้ำใน action
  let canEdit = false;
  try {
    const s = await requireSession();
    canEdit = isCfAdmin(s.user.role) || isCfBranchManager(s.user.role);
  } catch {
    // ไม่มี session/สิทธิ์ → ดูอย่างเดียว
  }

  const branchOptions: BranchOption[] = branches.map((b) => ({
    value: b.id,
    label: `${b.name} (${b.code})`,
  }));

  // Map V2Round → CollectionRow (ทุกรอบที่ปิดแล้ว · ไม่ใช่แค่ผิดปกติ)
  // expectedCash/actualCash/gap เป็น "บาท" แล้ว · gap เก็บทิศทาง (+ ขาด / − เกิน)
  const rows: CollectionRow[] = rounds.map((r) => ({
    id: r.id,
    // id ตัวจริง (sessionCode) ใช้กดตรวจ/รีวิว — คงไว้.
    // "code" = ชื่อที่โชว์บนการ์ด: รอบตั้งต้น sessionCode เป็น "BASE-<uuid>..." อ่านไม่รู้เรื่อง
    // → โชว์ "รอบตั้งต้น · <เวลา · วันที่>" (สาขาต่อท้ายให้เองที่การ์ด) · รอบเก็บปกติ (CFS-...) คงเดิม.
    code: r.isBaseline ? `รอบตั้งต้น · ${r.when}` : r.id,
    branchId: r.branchId,
    branch: r.branchName || r.branchCode || "สาขา",
    staff: r.staff || "—",
    date: r.timeAgo ? `${r.timeAgo}ที่แล้ว` : r.when || "—",
    expectedCash: r.expectedCash,
    actualCash: r.actualCash,
    gap: r.gap,
    prizeExpected: r.prizeExpected,
    prizeActual: r.prizeActual,
    prizeGap: r.prizeGap,
    severity: r.severity,
    type: r.type,
    reason: r.reason || (r.type === "cash_short" ? "ยอดเงินไม่ตรงกับมิเตอร์" : "ตุ๊กตาหายไม่ตรงกับมิเตอร์"),
    // ธง anomaly จริงจาก server — filter "มีปัญหา" ใช้ (จับรอบที่ gap จอเล็กแต่ server ตั้งธง)
    hasAnomaly: r.hasAnomaly,
    // วันของรอบ — client รวมรอบตั้งต้นต่อสาขา/วัน
    dayKey: r.dayKey,
    // รอบตั้งต้น — client แยกป้าย/ไม่นับเป็น "ไม่ตรง" (กัน expectedCash=0 ดูเหมือนเงินเกิน)
    isBaseline: r.isBaseline,
    // รอบ "กำลังเก็บ" (OPEN · ยังเก็บไม่ครบ) — โชว์สด "X/Y ตู้ · ฿ · ยังไม่ปิด"
    isOpen: r.isOpen,
    collectedCount: r.collectedCount,
    machineTotal: r.machineTotal,
    // มิเตอร์เหรียญจริงจาก event (รวมทั้งรอบ) — client โชว์ delta×10 จริง (ไม่ประมาณ)
    coinMeterBefore: r.coinMeterBefore,
    coinMeterAfter: r.coinMeterAfter,
    // รูปจริง + "ข้อมูลที่พนักงานกรอกครบทุกช่อง" ต่อตู้ (anti-cheat) — ผ่าน eventToMachine
    machines: r.machines.map((m) => ({
      eventId: m.eventId,
      code: m.code,
      name: m.name,
      kind: m.kind,
      isInitial: m.isInitial,
      photoShots: m.photoShots ?? [],
      // ข้อมูลที่กรอกจริง (label→value · จัดรูปฝั่ง server · kind-aware) — โชว์ครบทุกช่องให้เทียบรูป
      entered: m.entered ?? [],
      // ผลกระทบยอดต่อตู้ (server คิดให้) — ลงสี + นับ ตรง/ต้องตรวจ
      reconcile: m.reconcile ?? null,
      // เลขปัจจุบันต่อตู้ (หลังบ้านแก้เลข) — meterAfter=มิเตอร์เหรียญ · prizeMeterNow=มิเตอร์ตุ๊กตา · cashIn=บาท
      coinMeterAfter: m.meterAfter,
      dollMeterAfter: m.prizeMeterNow,
      cashBaht: m.cashIn,
      // เฟือง + สต๊อก/เติม — ฟอร์มแก้เลข "โชว์ครบ" (เฟืองแก้ได้ · สต๊อก/เติมโชว์อย่างเดียว)
      coinGear: m.coinGear ?? null,
      dollGear: m.dollGear ?? null,
      stockBefore: m.prizeBefore,
      stockAfter: m.prizeAfter,
      refillQty: m.refilled,
    })),
    sample: false,
  }));

  return (
    <CollectionsClient
      rows={rows}
      branchOptions={branchOptions}
      hasAnyRounds={hasAnyRounds}
      total={total}
      page={page}
      pageSize={pageSize}
      fromISO={fromISO}
      toISO={toISO}
      canEdit={canEdit}
      daySummaries={daySummaries}
    />
  );
}
