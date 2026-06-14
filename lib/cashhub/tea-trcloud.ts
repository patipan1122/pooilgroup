// CashHub ร้านชาไข่มุก — ดึง IV รายวันจาก TRCloud (co.45 JPS) มาทำตาราง + (ภายหลัง) เทียบ POS Foodstory.
//
// ต่างจาก Amazon (lib/cashhub/amazon-trcloud.ts): Amazon = "สร้าง" IV จาก POS (push).
// ร้านชาไข่มุก = IV ถูกคีย์ใน TRCloud อยู่แล้ว (1 ใบ/วัน/สาขา) → เราแค่ "ดึงกลับมา" (pull/read).
//
// ⚠️ TRCloud rate-limit หนัก (429 หลัง ~8-10 calls) → ฝั่ง UI ดึงทีละสาขา หน่วงเวลา ~1.8s/สาขา.
// project codes พิสูจน์สดแล้ว (iv/search co.45, เม.ย. 2026) ครบ 8 สาขา — ดู memory cashhub-tea-foodstory-iv-pull.
import { createHash } from "crypto";

const BASE =
  process.env.TRCLOUD_BASE ??
  "https://pooil.trcloud.co/application/api-connector2/end-point";
const COMPANY_ID = process.env.TRCLOUD_JPS_COMPANY_ID ?? "";
const PASSKEY = process.env.TRCLOUD_JPS_PASSKEY ?? "";
const ENCRYPT_HEAD = process.env.TRCLOUD_JPS_ENCRYPT_HEAD ?? "";

export function teaTrcloudConfigured(): boolean {
  return Boolean(COMPANY_ID && PASSKEY && ENCRYPT_HEAD);
}

// ── config ต่อสาขา (project = สตริงเต็มใน TRCloud · validated สดจากใบจริง) ───────
export type TeaBrand = "OWL CHA" | "MR.WOOF" | "SNOW DIP";
export type TeaBranchCfg = {
  code: string; // คีย์ย่อ ใช้เป็น branch_code ใน DB
  label: string; // ชื่อแสดง
  brand: TeaBrand;
  project: string; // ⚠️ สตริง project เต็มใน TRCloud (ใช้ค้น) — บางสาขามี typo ในระบบจริง
};

export const TEA_BRANCHES: TeaBranchCfg[] = [
  { code: "OWLCHA-001", label: "OWL CHA โนนคอย", brand: "OWL CHA", project: "OWLCHA-001-สาขา ปตท.โนนคอย" },
  { code: "OWLCHA-002", label: "OWL CHA ชุมพวง", brand: "OWL CHA", project: "OWLCHA-002-สาขา ปตท.ชุมพวง" },
  // ⚠️ พิมาย: TRCloud เก็บ project ซ้ำคำนำหน้า (OWLCHA-003 ซ้ำ) — ต้องใช้ตามนี้เป๊ะ ไม่งั้นค้นไม่เจอ
  { code: "OWLCHA-003", label: "OWL CHA พิมาย", brand: "OWL CHA", project: "OWLCHA-003OWLCHA-003-สาขา ปตท.พิมาย" },
  { code: "OWLCHA-004", label: "OWL CHA ลำทะเมนชัย", brand: "OWL CHA", project: "OWLCHA-004-สาขา ปตท.ลำทะเมนชัย" },
  { code: "OWLCHA-005", label: "OWL CHA รังกาใหญ่", brand: "OWL CHA", project: "OWLCHA-005-สาขา ปตท.รังกาใหญ่" },
  { code: "MRWOOF-001", label: "MR.WOOF โนนแดง", brand: "MR.WOOF", project: "MRWOOF-001-สาขา ปตท.โนนแดง" },
  // ⚠️ ตลาดแค: TRCloud เก็บจุดซ้ำ (ปตท..) — ใช้ตามนี้เป๊ะ
  { code: "SNOWDIP-002", label: "SNOW DIP ตลาดแค", brand: "SNOW DIP", project: "SNOWDIP-002-สาขา ปตท..ตลาดแค" },
  { code: "SNOWDIP-001", label: "SNOW DIP แคนดง", brand: "SNOW DIP", project: "SNOWDIP-001-สาขา ปตท.แคนดง" },
];

export function teaBranchByCode(code: string | null): TeaBranchCfg | null {
  if (!code) return null;
  return TEA_BRANCHES.find((b) => b.code === code) ?? null;
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
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export type TeaIv = {
  ivId: string;
  ivNo: string;
  date: string; // YYYY-MM-DD
  gross: number; // grand_total (รวม VAT)
  total: number; // ก่อน VAT
  vat: number;
  status: string;
  project: string;
};

/** ดึง IV ของสาขา (filter ด้วย project) ในช่วงวัน */
export async function fetchTeaIvs(
  cfg: TeaBranchCfg,
  periodStart: string,
  periodEnd: string,
): Promise<{ ivs: TeaIv[]; error?: string }> {
  if (!teaTrcloudConfigured())
    return { ivs: [], error: "TRCloud ยังไม่ได้ตั้งค่า (TRCLOUD_JPS_*)" };
  try {
    const data = await trcloudPost("iv/search.php", {
      project: cfg.project,
      "date-from": periodStart,
      "date-to": periodEnd,
      limit: 200,
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
    const ivs: TeaIv[] = list
      .map((iv) => ({
        ivId: String(iv.invoice_id ?? iv.id ?? ""),
        ivNo: String(iv.invoice_number ?? ""),
        date: String(iv.issue_date ?? "").slice(0, 10),
        gross: amount(iv.grand_total ?? iv.total),
        total: amount(iv.total),
        vat: amount(iv.tax),
        status: String(iv.status ?? ""),
        project: String(iv.project ?? cfg.project),
      }))
      // กันใบของ project อื่นหลุดมา + นอกช่วงปี (TRCloud filter ฝั่ง server แล้ว แต่กันไว้)
      .filter(
        (iv) =>
          iv.date >= periodStart &&
          iv.date <= periodEnd &&
          iv.project.trim() === cfg.project.trim(),
      );
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
