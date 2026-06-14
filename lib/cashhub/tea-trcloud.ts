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

function isSuccess(res: Record<string, unknown>): boolean {
  return res.success === 1 || res.success === "1" || Boolean(res.id ?? res.doc);
}

/**
 * คืน "ลิงก์เปิดใบ IV" ใน TRCloud (field link จาก iv/read — มี signature ต่อใบ).
 * เรียกตอนผู้ใช้กดเปิด (on-demand) — iv/search ไม่คืน link.
 */
export async function getTeaIvLink(ivId: string): Promise<{ url?: string; error?: string }> {
  if (!ivId) return { error: "ไม่มีเลข IV" };
  try {
    const res = await trcloudPost("iv/read.php", { id: ivId });
    const url = typeof res.link === "string" ? res.link : "";
    return url ? { url } : { error: "ไม่พบลิงก์ของใบนี้" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "TRCloud error";
    return { error: /429/.test(msg) ? "TRCloud ขอบ่อยเกินไป ลองใหม่" : msg };
  }
}

export type CreateTeaIvResult = {
  ok: boolean;
  ivId?: string;
  ivNo?: string;
  duplicate?: boolean; // มีใบของวันนี้อยู่แล้ว (ไม่สร้างซ้ำ)
  error?: string;
};

/**
 * สร้าง IV ร้านชา 1 วันเข้า TRCloud — **คัดลอกจากใบจริงของสาขานั้น** (ลูกค้า/สินค้า/รหัสคู่ค้า)
 *   เปลี่ยนแค่ วันที่ + c-var (c1=เงินสด, c2=ที่เหลือ) + ยอดรวม → ได้ใบเหมือนที่คนคีย์เป๊ะ.
 *   recipe พิสูจน์สด (create→read→match→delete IV 1048562): สูตร 1 (ร้านชา) · ไม่มี VAT · product P-00001.
 * ⚠️ กันใบซ้ำ: ถ้ามี IV ของสาขานี้วันนี้แล้ว → ไม่สร้าง (คืน duplicate). สร้างเฉพาะวันที่ยังไม่มี IV.
 */
export async function createTeaIv(
  cfg: TeaBranchCfg,
  date: string,
  c1: number, // เงินสด
  c2: number, // ที่เหลือ (QR/โอน/อื่น ๆ) — Σ = total
): Promise<CreateTeaIvResult> {
  if (!teaTrcloudConfigured()) return { ok: false, error: "TRCloud ยังไม่ได้ตั้งค่า" };
  const total = Math.round((c1 + c2) * 100) / 100;
  if (total <= 0) return { ok: false, error: "ยอดเป็น 0 — สร้างไม่ได้" };
  try {
    // ── 1) กันใบซ้ำ: มี IV ของวันนี้แล้วไหม ──
    const dup = await trcloudPost("iv/search.php", {
      project: cfg.project,
      "date-from": date,
      "date-to": date,
      limit: 5,
    });
    const dupList = (
      Array.isArray(dup.data) ? dup.data : Array.isArray(dup.result) ? dup.result : Array.isArray(dup.list) ? dup.list : []
    ) as Array<Record<string, unknown>>;
    const existing = dupList.find((iv) => String(iv.issue_date ?? "").slice(0, 10) === date);
    if (existing)
      return {
        ok: true,
        duplicate: true,
        ivId: String(existing.invoice_id ?? existing.id ?? ""),
        ivNo: String(existing.invoice_number ?? ""),
      };

    // ── 2) หา "ใบอ้างอิง" ของสาขานี้ (วันไหนก็ได้) เพื่อก๊อปลูกค้า/สินค้า/รหัสคู่ค้า ──
    const ref = await trcloudPost("iv/search.php", { project: cfg.project, limit: 1 });
    const refList = (
      Array.isArray(ref.data) ? ref.data : Array.isArray(ref.result) ? ref.result : Array.isArray(ref.list) ? ref.list : []
    ) as Array<Record<string, unknown>>;
    const refIv = refList[0];
    if (!refIv) return { ok: false, error: "ยังไม่มีใบ IV เดิมของสาขานี้ให้ใช้เป็นต้นแบบ" };

    const readRes = await trcloudPost("iv/read.php", { id: String(refIv.invoice_id ?? refIv.id ?? "") });
    const head = (readRes.head ?? {}) as Record<string, unknown>;
    const bodyRaw = readRes.body;
    const lines = (Array.isArray(bodyRaw) ? bodyRaw : bodyRaw && typeof bodyRaw === "object" ? Object.values(bodyRaw) : []) as Array<Record<string, unknown>>;
    const refLine = lines[0] ?? {};

    const title = String(head.title ?? refIv.title ?? "");
    const m = title.match(/^(\D+)(\d+)$/); // รหัสคู่ค้า = group_code + code_number
    const groupCode = m ? m[1] : "";
    const codeNumber = m ? m[2] : "";
    const contactId = String(head.contact_id ?? refIv.contact_id ?? "");
    const custName = String(head.name ?? refIv.name ?? "");
    const productId = String(refLine.product_id ?? "P-00001");
    const productName = String(refLine.product ?? "ชานมไข่มุก");
    const unit = String(refLine.unit ?? "วัน");
    const docType = String(head.type ?? refIv.type ?? "สูตร 1 (่ร้านชา)");
    const department = String(head.department ?? "PATIPAN");

    if (!contactId || !groupCode || !codeNumber)
      return { ok: false, error: "อ่านข้อมูลลูกค้าจากใบต้นแบบไม่ครบ (รหัสคู่ค้า)" };

    // ── 3) สร้างใบใหม่ (recipe พิสูจน์แล้ว) ──
    const totStr = String(total);
    const product = [
      { product_id: productId, product: productName, price: totStr, quantity: "1", vat: "0", before_vat: totStr, total: totStr, unit },
    ];
    const cvars: Record<string, string> = { c1: String(c1) };
    if (c2 > 0) cvars.c2 = String(c2);
    const payload: Record<string, unknown> = {
      issue_date: date,
      due_date: date,
      tax_date: date,
      company_format: "JPS_IV",
      document_number: "",
      payment_term: "0",
      tax_option: "ex",
      tax_report: "no",
      type: docType,
      department,
      project: cfg.project,
      calculation: "1",
      approve_status: "yes",
      invoice_note: `CashHub auto · ${cfg.label} · ${date}`,
      ...cvars,
      grand_total: totStr,
      total: totStr,
      customer: {
        contact_id: contactId,
        add_contact: "0",
        group_code: groupCode,
        code_number: codeNumber,
        name: custName,
        organization: custName,
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
      const msg = (typeof res.message === "string" && res.message) || (typeof res.HTTP === "string" && res.HTTP) || "TRCloud ปฏิเสธ (success:0)";
      return { ok: false, error: String(msg).slice(0, 200) };
    }
    return {
      ok: true,
      ivId: String(res.id ?? res.doc ?? ""),
      ivNo: String(res.document_number ?? res.last ?? ""),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "TRCloud error";
    return { ok: false, error: /429/.test(msg) ? "TRCloud ติด rate-limit — ลองใหม่ใน 1–2 นาที" : msg };
  }
}

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
