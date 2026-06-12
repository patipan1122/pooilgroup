// LedgerLine — ตัวแปลงรหัสธนาคาร → ไฟล์โลโก้จริง + ข้อมูลแบรนด์.
// โลโก้ SVG อยู่ที่ public/logos/banks/*.svg (จาก omise/banks-logo — ชุดมาตรฐานสำหรับ
// แสดงผลการจ่ายเงินในไทย). pure data → ใช้ได้ทั้ง server + client.
// รับได้ทั้งตัวย่อ (KBANK) และรหัสธนาคารมาตรฐาน BOT 3 หลัก ("004").

/** ตัวย่อธนาคาร → ชื่อไฟล์ SVG ใน public/logos/banks/ (มีไฟล์จริงครบ 10 ตัวนี้). */
const LOGO_BY_ABBR: Record<string, string> = {
  KBANK: "kbank",
  SCB: "scb",
  TTB: "ttb",
  BBL: "bbl",
  BAAC: "baac",
  KTB: "ktb",
  BAY: "bay",
  GSB: "gsb",
  CIMB: "cimb",
  UOB: "uob",
};

/** รหัสธนาคารมาตรฐาน (BOT 3 หลัก) → ตัวย่อ — payee เก็บเป็นเลขรหัส. */
const ABBR_BY_NUM: Record<string, string> = {
  "002": "BBL",
  "004": "KBANK",
  "006": "KTB",
  "011": "TTB",
  "014": "SCB",
  "022": "CIMB",
  "024": "UOB",
  "025": "BAY",
  "030": "GSB",
  "034": "BAAC",
};

/** ชื่อไทยสั้น (สำหรับข้อความข้างโลโก้). */
const NAME_BY_ABBR: Record<string, string> = {
  KBANK: "กสิกรไทย",
  SCB: "ไทยพาณิชย์",
  TTB: "ทหารไทยธนชาต",
  BBL: "กรุงเทพ",
  BAAC: "ธ.ก.ส.",
  KTB: "กรุงไทย",
  BAY: "กรุงศรีอยุธยา",
  GSB: "ออมสิน",
  CIMB: "ซีไอเอ็มบี ไทย",
  UOB: "ยูโอบี",
  TRUEMONEY: "ทรูมันนี่",
};

/** สีแบรนด์ (ใช้กับ badge สำรองเมื่อไม่มีไฟล์โลโก้ เช่น TrueMoney/อื่น ๆ). */
const BRAND_COLOR: Record<string, string> = {
  KBANK: "#138f2d",
  SCB: "#4e2e7f",
  TTB: "#1279be",
  BBL: "#1e4598",
  BAAC: "#4b9f47",
  KTB: "#1ba5e1",
  BAY: "#fdb913",
  GSB: "#eb198d",
  CIMB: "#7a1f2b",
  UOB: "#005eb8",
  TRUEMONEY: "#f47b20",
};
// BAY ทองอ่อนเกินไป (ขาวอ่านไม่ออก) → ใช้ทองเข้มสำหรับ tile.
BRAND_COLOR.BAY = "#c8961e";

/** สีพื้น tile ของแต่ละธนาคาร (โลโก้ omise เป็นสีขาว → วางบนพื้นสีแบรนด์ให้เห็นชัด).
 *  ค่าเริ่มต้น zinc-600 สำหรับธนาคารที่ไม่รู้จัก. */
export function bankBrandColor(code: string | null | undefined): string {
  const ab = toAbbr(code);
  return (ab && BRAND_COLOR[ab]) || "#52525b";
}

/** normalize input (ตัวย่อ/เลขรหัส) → ตัวย่อมาตรฐาน หรือ null. */
function toAbbr(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = code.trim().toUpperCase();
  if (LOGO_BY_ABBR[c] || BRAND_COLOR[c] || NAME_BY_ABBR[c]) return c;
  const num = code.replace(/\D/g, "");
  if (num && ABBR_BY_NUM[num]) return ABBR_BY_NUM[num];
  return null;
}

/** path โลโก้ SVG จริง หรือ null ถ้าไม่มีไฟล์ (→ ใช้ badge สำรอง). */
export function bankLogoSrc(code: string | null | undefined): string | null {
  const ab = toAbbr(code);
  return ab && LOGO_BY_ABBR[ab] ? `/logos/banks/${LOGO_BY_ABBR[ab]}.svg` : null;
}

/** ชื่อไทยของธนาคาร (สั้น) หรือ null. */
export function bankDisplayName(code: string | null | undefined): string | null {
  const ab = toAbbr(code);
  return ab ? NAME_BY_ABBR[ab] ?? null : null;
}

/** badge สำรอง — {label, color} สำหรับธนาคารที่ไม่มีไฟล์โลโก้ (TrueMoney/อื่น ๆ). */
export function bankBadge(
  code: string | null | undefined,
  name?: string | null,
): { label: string; color: string } {
  const ab = toAbbr(code);
  const color = (ab && BRAND_COLOR[ab]) || "#71717a"; // zinc-500
  let label: string;
  if (ab === "TRUEMONEY") label = "TMN";
  else if (ab && /^[A-Z]{2,5}$/.test(ab)) label = ab.length <= 4 ? ab : ab.slice(0, 4);
  else label = (name ?? code ?? "ธ").trim().slice(0, 2) || "ธ";
  return { label, color };
}
