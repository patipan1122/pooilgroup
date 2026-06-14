// CashHub Café Amazon — สร้าง IV รายวันเข้า TRCloud (co.45 JPS) + ดึง IV กลับมาตรวจความครบ
//
// Goal 1: parse POS รายวัน → สร้างใบกำกับภาษีอัตโนมัติ (สูตร "AMAZON <สาขา>[IV]")
//   Dr 1421001 รายได้ค้างรับ = Σ(c-vars ช่องทาง) / Cr 4001013 รายได้ = total / Cr 2341000 ภาษีขาย = vat.
//   recipe (พิสูจน์แล้ว IV 1048468): payload = DOC flat@root + customer{} + product:[] + mirror data=product
//   + special-note c1.. flat@root. ⚠️ key ต้องเป็น `product` (ไม่ใช่ data) ไม่งั้น total/vat=0.
// Goal 2: ดึง IV กลับมาเช็คว่าคีย์ครบทุกวันไหม (mirror hotel-trcloud).
//
// ⚠️ TRCloud rate-limit หนัก (429 หลัง ~8-10 calls) → throttle ฝั่งเรียก, สร้างทีละใบ.
import { createHash } from "crypto";
import type { AmazonDayRow } from "./amazon-parse";

const BASE =
  process.env.TRCLOUD_BASE ??
  "https://pooil.trcloud.co/application/api-connector2/end-point";
const COMPANY_ID = process.env.TRCLOUD_JPS_COMPANY_ID ?? "";
const PASSKEY = process.env.TRCLOUD_JPS_PASSKEY ?? "";
const ENCRYPT_HEAD = process.env.TRCLOUD_JPS_ENCRYPT_HEAD ?? "";

export function amazonTrcloudConfigured(): boolean {
  return Boolean(COMPANY_ID && PASSKEY && ENCRYPT_HEAD);
}

// ── config ต่อสาขา (validated จากใบจริง) ── key = pos store code ──────────────
export type AmazonBranchCfg = {
  storeCode: string;
  label: string;
  type: string; // ชื่อสูตรบัญชี TRCloud
  project: string;
  department: string;
  contactId: string;
  customerName: string;
  productId: string;
  productName: string;
  unit: string;
};

export const AMAZON_BRANCHES: Record<string, AmazonBranchCfg> = {
  // สาขา ชุมชนหัวทะเล (pilot) — validated vs IV 1048243 / 1048478
  "5157": {
    storeCode: "5157",
    label: "ชุมชนหัวทะเล",
    type: "AMAZON ชุมชนหัวทะเล[IV]",
    project: "ANAZON-002 สาขา ชุมชนหัวทะเล", // สะกด ANAZON ตามที่ TRCloud เก็บจริง
    department: "JPS_00005",
    contactId: "66075",
    customerName: "ลูกค้า ร้านกาเเฟอเมซอนชุมชนหัวทะเล",
    productId: "P-00005",
    productName: "กาแฟ CAFE AMAZON",
    unit: "วัน",
  },
};

export function branchByStoreCode(code: string | null): AmazonBranchCfg | null {
  if (!code) return null;
  return AMAZON_BRANCHES[code] ?? null;
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
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`TRCloud ${path} HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`TRCloud ${path} non-JSON: ${text.slice(0, 160)}`);
  }
}

function amount(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number.parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// ── Goal 2: ดึง IV ของสาขา Amazon มาตรวจความครบ ─────────────────────────────
export type AmazonIv = {
  ivId: string;
  ivNo: string;
  date: string; // YYYY-MM-DD
  gross: number;
  status: string;
};

/** ดึง IV ของสาขา (filter ด้วย project) ในช่วงวัน → เช็คว่าวันไหนคีย์แล้ว */
export async function fetchAmazonIvs(
  cfg: AmazonBranchCfg,
  periodStart: string,
  periodEnd: string,
): Promise<{ ivs: AmazonIv[]; error?: string }> {
  if (!amazonTrcloudConfigured())
    return { ivs: [], error: "TRCloud ยังไม่ได้ตั้งค่า (TRCLOUD_JPS_*)" };
  try {
    const data = await trcloudPost("iv/search.php", {
      project: cfg.project,
      "date-from": periodStart,
      "date-to": periodEnd,
      limit: 500,
    });
    const list = (
      Array.isArray(data.data)
        ? data.data
        : Array.isArray(data.result)
          ? data.result
          : Array.isArray(data.list)
            ? data.list
            : []
    ) as Array<Record<string, unknown>>;
    const ivs: AmazonIv[] = list.map((iv) => ({
      ivId: String(iv.invoice_id ?? iv.id ?? ""),
      ivNo: String(iv.invoice_number ?? ""),
      date: String(iv.issue_date ?? "").slice(0, 10),
      gross: amount(iv.grand_total ?? iv.total),
      status: String(iv.status ?? ""),
    }));
    return { ivs };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "TRCloud error";
    return {
      ivs: [],
      error: /429/.test(msg)
        ? "TRCloud ติด rate-limit (เรียกถี่เกินไป) — ลองใหม่ใน 1–2 นาที"
        : msg,
    };
  }
}

// ── Goal 1: สร้าง IV รายวัน ──────────────────────────────────────────────────
export type CreateIvResult =
  | { ok: true; ivId: string; ivNo: string; duplicate?: boolean }
  | { ok: false; error: string };

function isSuccess(d: Record<string, unknown>): boolean {
  const s = d.success;
  if (s === 1 || s === "1" || s === true) return true;
  if (typeof d.HTTP === "string" && d.HTTP.startsWith("200") && (d.id || d.doc))
    return true;
  return false;
}

/**
 * สร้าง IV 1 วัน. มี dedup-guard: search ก่อนว่ามี IV ของสาขานี้ในวันนั้นแล้วหรือยัง.
 * @param dayRow แถวรายวันจาก parseAmazonPos (ต้อง balanced)
 * @param opts.force ⚠️ ข้าม dedup → สร้างใบใหม่แม้มีอยู่แล้ว (ได้ใบซ้ำจริง — สำหรับทดสอบ super_admin เท่านั้น)
 */
export async function createAmazonIv(
  cfg: AmazonBranchCfg,
  dayRow: AmazonDayRow,
  opts?: { force?: boolean },
): Promise<CreateIvResult> {
  if (!amazonTrcloudConfigured()) return { ok: false, error: "TRCloud ยังไม่ได้ตั้งค่า" };
  if (!dayRow.balanced)
    return { ok: false, error: dayRow.blockReason ?? "ยอดไม่บาลานซ์ — ยังคีย์ไม่ได้" };

  // checksum guard (กันใบผิดยอด): Σc-vars ต้อง = total+vat
  const sumC = Object.values(dayRow.cvars).reduce((a, b) => a + b, 0);
  if (Math.abs(sumC - (dayRow.total + dayRow.vat)) > 1)
    return {
      ok: false,
      error: `checksum ไม่ผ่าน: Σช่องทาง ${sumC} ≠ total+vat ${dayRow.total + dayRow.vat}`,
    };

  try {
    // ── dedup: มี IV ของสาขานี้วันนี้แล้วหรือยัง (ข้ามถ้า force) ──
    if (!opts?.force) {
      const dup = await trcloudPost("iv/search.php", {
        project: cfg.project,
        "date-from": dayRow.date,
        "date-to": dayRow.date,
        limit: 50,
      });
      const dupList = (
        Array.isArray(dup.data) ? dup.data : Array.isArray(dup.result) ? dup.result : []
      ) as Array<Record<string, unknown>>;
      const existing = dupList.find(
        (iv) => String(iv.issue_date ?? "").slice(0, 10) === dayRow.date,
      );
      if (existing)
        return {
          ok: true,
          ivId: String(existing.invoice_id ?? existing.id ?? ""),
          ivNo: String(existing.invoice_number ?? ""),
          duplicate: true,
        };
    }

    // ── build payload (recipe ที่พิสูจน์แล้ว) ──
    const cvarFields: Record<string, string> = {};
    for (const [k, v] of Object.entries(dayRow.cvars)) cvarFields[k] = String(v);

    const product = [
      {
        product_id: cfg.productId,
        product: cfg.productName,
        price: String(dayRow.total), // ก่อน VAT (tax_option=ex)
        quantity: "1",
        vat: String(dayRow.vat), // จำนวนเงิน VAT
        unit: cfg.unit,
      },
    ];
    const payload: Record<string, unknown> = {
      issue_date: dayRow.date,
      due_date: dayRow.date,
      tax_date: dayRow.date,
      company_format: "JPS_IV",
      document_number: "",
      payment_term: "0",
      tax_option: "ex",
      type: cfg.type,
      department: cfg.department,
      project: cfg.project,
      tax_report: "1",
      approve_status: "yes",
      invoice_note: `CashHub auto · ${cfg.label} · ${dayRow.date}`,
      ...cvarFields,
      customer: {
        contact_id: cfg.contactId,
        add_contact: "0",
        group_code: "C",
        code_number: "",
        name: cfg.customerName,
        organization: cfg.customerName,
        branch: "",
        address: "",
        email: "",
        telephone: "",
        tax_id: "",
        contact_type: "normal",
      },
      product,
      data: product, // TRCloud validation ต้องมี key data (mirror product)
    };

    const res = await trcloudPost("iv/create.php", payload);
    if (!isSuccess(res)) {
      const msg =
        (typeof res.message === "string" && res.message) ||
        (typeof res.HTTP === "string" && res.HTTP) ||
        "TRCloud ปฏิเสธ (success:0)";
      return { ok: false, error: String(msg).slice(0, 200) };
    }
    return {
      ok: true,
      ivId: String(res.id ?? res.doc ?? ""),
      ivNo: String(res.document_number ?? res.last ?? ""),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "TRCloud error";
    return {
      ok: false,
      error: /429/.test(msg) ? "TRCloud ติด rate-limit — ลองใหม่ใน 1–2 นาที" : msg,
    };
  }
}
