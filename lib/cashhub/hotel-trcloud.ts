// CashHub Hotel — ดึง IV (ใบแจ้งหนี้/ขาย) ของโรงแรมจาก TRCloud (co.45 JPS)
//
// หน้างานคีย์ IV เข้า TRCloud อยู่แล้ว (แยก "กะเช้า"/"กะดึก" ในชื่อลูกค้า) → ดึงมาเติม
// ยอดขาย+วัน+กะ ให้อัตโนมัติ ไม่ต้องคีย์ Excel ซ้ำ + เช็คว่า IV ถูกคีย์ครบทุกวัน/กะไหม.
//
// IV header มี: invoice_number, issue_date, name(=ลูกค้า มีคำว่ากะเช้า/กะดึก), project
//   (="Hotel_001-โรงแรม MIX"), grand_total, status (Debtor=ยังไม่จ่าย). ⚠️ IV ไม่มีช่องทาง
//   จ่าย (เงินสด/QR/OTA) — อันนั้นอยู่ที่ RV/statement → ยังต้องกรอก/เทียบเอง.
//
// Rate-limit: TRCloud จำกัดหนัก (429 หลัง ~8-10 calls) → เรียกครั้งเดียวต่อเดือน, cache ฝั่งเรียก.
import { createHash } from "crypto";

const BASE =
  process.env.TRCLOUD_BASE ??
  "https://pooil.trcloud.co/application/api-connector2/end-point";
const COMPANY_ID = process.env.TRCLOUD_JPS_COMPANY_ID ?? "";
const PASSKEY = process.env.TRCLOUD_JPS_PASSKEY ?? "";
const ENCRYPT_HEAD = process.env.TRCLOUD_JPS_ENCRYPT_HEAD ?? "";

// TRCloud project ของโรงแรม (ทุก IV โรงแรมอยู่ใต้ project นี้) — กรองให้ดึงเฉพาะของโรงแรม
const HOTEL_PROJECT = process.env.HOTEL_TRCLOUD_PROJECT ?? "Hotel_001-โรงแรม MIX";

export function hotelTrcloudConfigured(): boolean {
  return Boolean(COMPANY_ID && PASSKEY && ENCRYPT_HEAD);
}

function authFields() {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const securekey = createHash("md5")
    .update(`${ENCRYPT_HEAD}t${timestamp}`)
    .digest("hex");
  return { company_id: COMPANY_ID, passkey: PASSKEY, timestamp, securekey };
}

async function trcloudPost(
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const payload = new URLSearchParams({
    json: JSON.stringify({ ...authFields(), ...body }),
  });
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: process.env.TRCLOUD_JPS_ORIGIN ?? "https://pooil.trcloud.co",
    },
    body: payload.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`TRCloud ${path} HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`TRCloud ${path} non-JSON: ${text.slice(0, 160)}`);
  }
}

type RawIv = {
  invoice_id?: string;
  invoice_number?: string;
  issue_date?: string;
  name?: string;
  project?: string;
  grand_total?: string | number;
  total?: string | number;
  status?: string;
  special_note?: string; // JSON {"c1":"เงินสด","c2":"QR",...} = ช่องทางเงิน "ไส้ใน"
};

export type HotelIv = {
  ivId: string; // invoice_id (ใช้เรียก iv/read ดู line items)
  ivNo: string;
  date: string; // YYYY-MM-DD
  shift: "morning" | "evening" | "unknown";
  total: number;
  status: string;
  customer: string;
  // ── ไส้ในช่องทางเงิน (จาก special_note c1-c40) ──
  cash: number; // c1 เงินสด
  qr: number; // c2 QR Payment (+ c13 QRManual)
  delivery: number; // c3 Grab + c4 LineMan + c5 ShopeeFood
  wallet: number; // c6 TrueMoney + c14/15 bluePlus
  discount: number; // c7+c8+c9 ส่วนลด
  shortAmt: number; // c18 เงินขาด
  overAmt: number; // c19 เงินเกิน
};

/** parse special_note (JSON c1-c40) → ยอดแต่ละช่องทาง */
function parseChannels(raw: string | undefined): {
  cash: number; qr: number; delivery: number; wallet: number;
  discount: number; shortAmt: number; overAmt: number;
} {
  const z = { cash: 0, qr: 0, delivery: 0, wallet: 0, discount: 0, shortAmt: 0, overAmt: 0 };
  if (!raw) return z;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return z;
  }
  const c = (k: string): number => {
    const v = o[k];
    if (v == null || v === "") return 0;
    const n = Number.parseFloat(String(v).replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  return {
    cash: c("c1"),
    qr: c("c2") + c("c13"), // QR Payment + QRManual
    delivery: c("c3") + c("c4") + c("c5"), // Grab + LineMan + ShopeeFood
    wallet: c("c6") + c("c14") + c("c15"), // TrueMoney + bluePlus wallet/credit
    discount: c("c7") + c("c8") + c("c9"),
    shortAmt: c("c18"),
    overAmt: c("c19"),
  };
}

function isHotel(iv: RawIv): boolean {
  const s = `${iv.project ?? ""}${iv.name ?? ""}`;
  return /โรงแรม\s*mix|hotel_001/i.test(s);
}

function shiftOf(name: string): "morning" | "evening" | "unknown" {
  if (/กะเช้า|เช้า/.test(name)) return "morning";
  if (/กะดึก|ดึก|กะค่ำ|ค่ำ/.test(name)) return "evening";
  return "unknown";
}

function amount(v: string | number | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number.parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** ดึง IV โรงแรมในช่วงวัน (กรอง project/ชื่อ = โรงแรม MIX, จับกะจากชื่อลูกค้า) */
export async function fetchHotelIvs(
  periodStart: string,
  periodEnd: string,
): Promise<{
  ivs: HotelIv[];
  error?: string;
  totalReturned: number;
  availableMonths: string[]; // YYYY-MM ของ IV โรงแรมที่ TRCloud คืนมา (ไว้บอก "ไปดูเดือนไหน")
}> {
  if (!hotelTrcloudConfigured())
    return {
      ivs: [],
      error: "TRCloud ยังไม่ได้ตั้งค่า (TRCLOUD_JPS_*)",
      totalReturned: 0,
      availableMonths: [],
    };
  try {
    // ⚠️ TRCloud ใช้ param "date-from"/"date-to" (ขีดกลาง) — underscore ถูกเมิน
    //    (คืนเฉพาะล่าสุด) + project filter ดึงเฉพาะ IV โรงแรม
    const data = await trcloudPost("iv/search.php", {
      project: HOTEL_PROJECT,
      "date-from": periodStart,
      "date-to": periodEnd,
      limit: 500,
    });
    const list = (
      Array.isArray(data.data)
        ? data.data
        : Array.isArray(data.list)
          ? data.list
          : Array.isArray(data.result)
            ? data.result
            : []
    ) as RawIv[];
    // TRCloud คืน 200 พร้อม body ที่ไม่มี array ตอนติด rate-limit/error → แยกให้ชัด
    if (list.length === 0) {
      const hint =
        (typeof data.message === "string" && data.message) ||
        (typeof data.error === "string" && data.error) ||
        (data.success === false ? "TRCloud ปฏิเสธคำขอ" : "");
      return {
        ivs: [],
        error: hint
          ? `TRCloud: ${hint}`
          : "TRCloud คืนข้อมูลว่าง — อาจติด rate-limit (เรียกถี่เกินไป) ลองใหม่ใน 1–2 นาที",
        totalReturned: 0,
        availableMonths: [],
      };
    }
    // IV โรงแรมทั้งหมด (ยังไม่กรองช่วงวัน) → ใช้บอก "TRCloud มี IV เดือนไหน"
    const allHotel: HotelIv[] = list.filter(isHotel).map((iv) => {
      const ch = parseChannels(iv.special_note);
      return {
        ivId: String(iv.invoice_id ?? ""),
        ivNo: String(iv.invoice_number ?? ""),
        date: String(iv.issue_date ?? "").slice(0, 10),
        shift: shiftOf(String(iv.name ?? "")),
        total: amount(iv.grand_total ?? iv.total),
        status: String(iv.status ?? ""),
        customer: String(iv.name ?? ""),
        ...ch,
      };
    });
    const availableMonths = [
      ...new Set(allHotel.map((iv) => iv.date.slice(0, 7)).filter(Boolean)),
    ].sort();
    const ivs = allHotel.filter(
      (iv) => iv.date >= periodStart && iv.date <= periodEnd,
    );
    return { ivs, totalReturned: list.length, availableMonths };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "TRCloud error";
    const friendly = /429/.test(msg)
      ? "TRCloud ติด rate-limit (เรียกถี่เกินไป) — ลองใหม่ใน 1–2 นาที"
      : msg;
    return { ivs: [], error: friendly, totalReturned: 0, availableMonths: [] };
  }
}

type RawIvLine = {
  description?: string;
  product_id?: string;
  total?: string | number;
};

export type IvLineSplit = {
  room: number; // ค่าห้อง (line "ห้องพัก")
  tip: number; // ทิป (line "ทิป")
  fine: number; // ค่าปรับ (line "ปรับ")
  goods: number; // ขนม/ของ (ที่เหลือ — เบียร์/น้ำ/H_S*)
};

/** ดึง line items ของ IV (iv/read) → แยก ค่าห้อง/ขนม/ทิป/ค่าปรับ ตาม description.
 *  ⚠️ 1 call ต่อ IV — เรียกเท่าที่จำเป็น (rate-limit TRCloud ~8-10/รอบ) */
export async function fetchIvLineSplit(
  invoiceId: string,
): Promise<{ split?: IvLineSplit; error?: string }> {
  if (!hotelTrcloudConfigured())
    return { error: "TRCloud ยังไม่ได้ตั้งค่า" };
  try {
    const data = await trcloudPost("iv/read.php", { id: invoiceId });
    const body = (Array.isArray(data.body) ? data.body : []) as RawIvLine[];
    if (body.length === 0) {
      const hint =
        (typeof data.message === "string" && data.message) || "ไม่พบรายการสินค้า";
      return { error: hint };
    }
    const split: IvLineSplit = { room: 0, tip: 0, fine: 0, goods: 0 };
    for (const ln of body) {
      const desc = String(ln.description ?? "");
      const t = amount(ln.total);
      if (/ห้องพัก|ค่าห้อง|ห้อง/.test(desc)) split.room += t;
      else if (/ทิป|tip/i.test(desc)) split.tip += t;
      else if (/ปรับ|fine/i.test(desc)) split.fine += t;
      else split.goods += t; // เบียร์/น้ำ/ขนม/ของ
    }
    return { split };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "TRCloud error";
    return {
      error: /429/.test(msg) ? "TRCloud ติด rate-limit — ลองใหม่ใน 1–2 นาที" : msg,
    };
  }
}

export type IvDayMatch = {
  day: number;
  date: string;
  morning: HotelIv | null;
  evening: HotelIv | null;
  ivTotal: number; // รวมยอด IV ของวัน
  missing: boolean; // วันนี้ยังขาด IV (อย่างน้อย 1 กะ)
};

export type IvCompleteness = {
  days: IvDayMatch[];
  ivCount: number;
  expectedShifts: number; // วัน × 2
  missingShifts: number; // กะที่ยังไม่มี IV
  unknownShift: HotelIv[]; // IV ที่แยกกะไม่ได้ (ชื่อไม่บอก)
};

/** จับคู่ IV เข้าวัน/กะ + คำนวณความครบ (ต้องมี 2 IV/วัน) */
export function matchIvsToDays(
  ivs: HotelIv[],
  year: number,
  month: number,
): IvCompleteness {
  const daysInMonth = new Date(year, month, 0).getDate();
  const byDay = new Map<number, IvDayMatch>();
  const unknownShift: HotelIv[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    byDay.set(d, {
      day: d,
      date: `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      morning: null,
      evening: null,
      ivTotal: 0,
      missing: true,
    });
  }
  for (const iv of ivs) {
    const d = Number(iv.date.slice(8, 10));
    const m = byDay.get(d);
    if (!m) continue;
    if (iv.shift === "morning") m.morning = iv;
    else if (iv.shift === "evening") m.evening = iv;
    else {
      unknownShift.push(iv);
      continue;
    }
    m.ivTotal += iv.total;
  }
  let missingShifts = 0;
  for (const m of byDay.values()) {
    const hasM = !!m.morning;
    const hasE = !!m.evening;
    if (!hasM) missingShifts++;
    if (!hasE) missingShifts++;
    m.missing = !hasM || !hasE;
  }
  return {
    days: [...byDay.values()].sort((a, b) => a.day - b.day),
    ivCount: ivs.length,
    expectedShifts: daysInMonth * 2,
    missingShifts,
    unknownShift,
  };
}
