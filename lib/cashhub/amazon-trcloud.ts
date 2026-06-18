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
  storeCode: string; // POS store code (ว่างได้ถ้ายังไม่รู้ — match ด้วยชื่อแทน)
  nameMatch: string; // คำในชื่อสาขา (POS label) ที่ใช้จับคู่ config นี้
  aliases?: string[]; // ชื่อเรียกอื่นของสาขาเดียวกัน (POS เรียกต่างจาก TRCloud เช่น "ตลาดจักราช" = "เทศบาลจักราช")
  label: string;
  type: string; // ชื่อสูตรบัญชี TRCloud
  project: string;
  department: string;
  contactId: string;
  groupCode: string; // กลุ่มคู่ค้า (รหัสคู่ค้า = groupCode + codeNumber เช่น C + 2601120001)
  codeNumber: string; // เลขรหัสคู่ค้าของ contact (ขาด → รหัสเหลือแค่ "C")
  customerName: string;
  productId: string;
  productName: string;
  unit: string;
};

// สาขา Amazon ที่ probe จาก TRCloud จริง (co.45) — เพิ่มสาขาใหม่ = เติม entry ที่นี่
export const AMAZON_BRANCH_LIST: AmazonBranchCfg[] = [
  // สาขา ชุมชนหัวทะเล (pilot) — validated vs IV 1048243 / 1048478 / 1042528
  {
    storeCode: "5157",
    nameMatch: "ชุมชนหัวทะเล",
    label: "ชุมชนหัวทะเล",
    type: "AMAZON ชุมชนหัวทะเล[IV]",
    project: "ANAZON-002 สาขา ชุมชนหัวทะเล", // สะกด ANAZON ตามที่ TRCloud เก็บจริง
    department: "JPS_00005",
    contactId: "66075",
    groupCode: "C",
    codeNumber: "2601120001", // รหัสคู่ค้า C2601120001 (จากใบจริง 1042528 head.title)
    customerName: "ลูกค้า ร้านกาเเฟอเมซอนชุมชนหัวทะเล",
    productId: "P-00005",
    productName: "กาแฟ CAFE AMAZON",
    unit: "วัน",
  },
  // สาขา เทศบาลจักราช — probe จาก IV จริง (1048158 head.title=Ama-2504220001, contact 36134)
  // ⚠️ store_code ยังไม่ทราบ (รอไฟล์ POS สาขานี้) → จับคู่ด้วยชื่อ "เทศบาลจักราช" ไปก่อน
  {
    storeCode: "",
    nameMatch: "เทศบาลจักราช",
    // POS เรียกสาขานี้ว่า "ตลาดจักราช" แต่ TRCloud เก็บ contact เป็น "เทศบาลจักราช"
    // (ยืนยันจากใบจริง 1048560: branch="สาขาตลาดจักราช") — ร้านเดียวกัน
    aliases: ["ตลาดจักราช", "สาขาตลาดจักราช"],
    label: "เทศบาลจักราช (ตลาดจักราช)",
    type: "AMAZON เทศบาลจักราช[IV]",
    project: "AMAZON-001-สาขาเทศบาลจักราช",
    department: "JPS_00001",
    contactId: "36134",
    groupCode: "Ama-",
    codeNumber: "2504220001", // รหัสคู่ค้า Ama-2504220001
    customerName: "ร้านกาแฟ CAFE AMAZON (คาเฟ่อเมซอน) เทศบาลจักราช",
    productId: "P-00005",
    productName: "กาแฟ CAFE AMAZON",
    unit: "วัน",
  },
];

/** หา config สาขาจากรายการที่ให้มา — ลอง store_code ก่อน แล้วค่อย match ด้วยชื่อ + ชื่อเรียกอื่น (POS label).
 *  ใช้ร่วมกันทั้งรายการฝังในโค้ด (built-in) และรายการจาก DB (สาขาที่ CEO เพิ่มเอง). */
export function matchBranchInList(
  list: AmazonBranchCfg[],
  code: string | null,
  label?: string | null,
): AmazonBranchCfg | null {
  if (code) {
    const byCode = list.find((b) => b.storeCode && b.storeCode === code);
    if (byCode) return byCode;
  }
  if (label) {
    const byName = list.find(
      (b) =>
        label.includes(b.nameMatch) ||
        (b.aliases?.some((a) => a && label.includes(a)) ?? false),
    );
    if (byName) return byName;
  }
  return null;
}

/** หา config สาขาจากรายการ built-in (ฝังในโค้ด) — fallback เมื่อยังไม่มีใน DB */
export function branchByStoreCode(
  code: string | null,
  label?: string | null,
): AmazonBranchCfg | null {
  return matchBranchInList(AMAZON_BRANCH_LIST, code, label);
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
  channels: Record<string, number>; // ไส้ในรายช่องทาง จาก special_note (c1..c40) → ยอด
  preVat: number; // ยอดก่อน VAT ในใบ (head.total) → vat = gross − preVat
};

/** parse special_note (JSON {"c1":"4354","u1":"",...}) → c-var map (ข้าม u*, ช่องว่าง) */
export function parseIvChannels(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof raw !== "string" || !raw) return out;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return out;
  }
  for (const [k, v] of Object.entries(o)) {
    if (!/^c\d+$/.test(k)) continue; // เอาเฉพาะ c1..c40 (ข้าม u1..u40 = หน่วย)
    if (v == null || v === "") continue;
    const n = Number.parseFloat(String(v).replace(/,/g, ""));
    if (Number.isFinite(n) && n !== 0) out[k] = n;
  }
  return out;
}

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
      // ไส้ในรายช่องทาง — มากับ response เดิม (special_note) ไม่ต้องเรียกเพิ่ม
      channels: parseIvChannels(iv.special_note),
      preVat: amount(iv.total), // head.total = ยอดก่อน VAT (tax_option=ex)
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

// ── เพิ่มสาขาใหม่: ค้นใบกำกับเก่าใน TRCloud ด้วยชื่อสาขา → ดึงค่าตั้งบัญชีมาเติมให้ ──
//
// CEO ไม่ต้องรู้รหัสบัญชี/โครงการ/คู่ค้า — ระบบดึงจากใบจริงที่นักบัญชีคีย์ไว้แล้ว (กันตั้งค่าผิด = ลงบัญชีผิดร้าน).
// validated: iv/search.php คืน head ครบ (type/project/department/contact_id/title/name/branch).
export type ProbedBranch = {
  type: string; // สูตรบัญชี เช่น "AMAZON เทศบาลจักราช[IV]"
  project: string;
  department: string;
  contactId: string;
  groupCode: string; // แยกจาก title (รหัสคู่ค้า) — ส่วนตัวอักษรนำหน้า
  codeNumber: string; // ส่วนตัวเลข
  customerName: string; // จาก name
  branchField: string; // ช่อง branch ใน TRCloud (มักตรงกับชื่อใน POS)
  suggestedNameMatch: string; // คำที่น่าจะใช้จับคู่ชื่อในไฟล์ POS
  lastIvNo: string;
  lastIvDate: string;
  ivCount: number;
};

/** แยกรหัสคู่ค้า (title) เป็น groupCode (อักษรนำ) + codeNumber (ตัวเลขท้าย) เช่น "Ama-2504220001" → "Ama-" + "2504220001" */
export function splitPartnerCode(title: string): { groupCode: string; codeNumber: string } {
  const m = String(title ?? "").trim().match(/^(\D+?)(\d+)$/);
  if (m) return { groupCode: m[1], codeNumber: m[2] };
  return { groupCode: title ?? "", codeNumber: "" };
}

/** เดาคำจับคู่ชื่อสาขา (POS label) จากชื่อ TRCloud — ใช้ token ท้ายของ branch/contact name เป็นตัวตั้ง */
function suggestNameMatch(branchField: string, name: string): string {
  const fromBranch = String(branchField ?? "").replace(/^สาขา\s*/, "").trim();
  if (fromBranch) return fromBranch;
  // ดึงคำท้ายของชื่อ contact (มักเป็นชื่อสาขา) เป็น fallback
  const tokens = String(name ?? "").split(/[\s)(]+/).filter(Boolean);
  return tokens[tokens.length - 1] ?? "";
}

/** ค้นสาขา Amazon ใน TRCloud ด้วยคำค้น (ชื่อสาขา) → คืนค่าตั้งบัญชีของแต่ละโครงการที่เจอ */
export async function probeAmazonBranches(
  keyword: string,
): Promise<{ branches: ProbedBranch[]; error?: string }> {
  if (!amazonTrcloudConfigured())
    return { branches: [], error: "TRCloud ยังไม่ได้ตั้งค่า (TRCLOUD_JPS_*)" };
  const kw = keyword.trim();
  if (kw.length < 2)
    return { branches: [], error: "พิมพ์ชื่อสาขาอย่างน้อย 2 ตัวอักษร" };
  try {
    const data = await trcloudPost("iv/search.php", {
      keyword: kw,
      "date-from": "2024-01-01",
      "date-to": "2035-12-31",
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

    // เก็บเฉพาะใบที่เป็น Amazon (กันใบร้านอื่นที่ชื่อพ้องคำค้น เช่น "จักราช")
    const isAmazon = (r: Record<string, unknown>) =>
      /amazon|anazon|อเมซอน|กาแฟ/i.test(
        `${r.type ?? ""} ${r.project ?? ""} ${r.name ?? ""} ${r.organization ?? ""}`,
      );

    // จัดกลุ่มตามโครงการ (1 สาขา = 1 โครงการ) เก็บใบล่าสุดไว้เป็นตัวแทน
    const byProject = new Map<string, { rep: Record<string, unknown>; count: number }>();
    for (const r of list) {
      if (!isAmazon(r)) continue;
      const project = String(r.project ?? "").trim();
      if (!project) continue;
      const cur = byProject.get(project);
      const date = String(r.issue_date ?? "").slice(0, 10);
      if (!cur) {
        byProject.set(project, { rep: r, count: 1 });
      } else {
        cur.count += 1;
        if (date > String(cur.rep.issue_date ?? "").slice(0, 10)) cur.rep = r;
      }
    }

    const branches: ProbedBranch[] = [...byProject.values()].map(({ rep, count }) => {
      const title = String(rep.title ?? "");
      const { groupCode, codeNumber } = splitPartnerCode(title);
      const branchField = String(rep.branch ?? "");
      const name = String(rep.name ?? rep.organization ?? "");
      return {
        type: String(rep.type ?? ""),
        project: String(rep.project ?? ""),
        department: String(rep.department ?? ""),
        contactId: String(rep.contact_id ?? ""),
        groupCode,
        codeNumber,
        customerName: name,
        branchField,
        suggestedNameMatch: suggestNameMatch(branchField, name),
        lastIvNo: String(rep.invoice_number ?? ""),
        lastIvDate: String(rep.issue_date ?? "").slice(0, 10),
        ivCount: count,
      };
    });

    if (branches.length === 0)
      return {
        branches: [],
        error: `ไม่พบสาขา Amazon ที่ชื่อตรงกับ "${kw}" ใน TRCloud — ลองพิมพ์ชื่อใกล้เคียง หรือตรวจว่ามีใบกำกับของสาขานี้ใน TRCloud แล้ว`,
      };
    return { branches };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "TRCloud error";
    return {
      branches: [],
      error: /429/.test(msg)
        ? "TRCloud ติด rate-limit — ลองใหม่ใน 1–2 นาที"
        : msg,
    };
  }
}

// ── Goal 1: สร้าง IV รายวัน ──────────────────────────────────────────────────
export type CreateIvResult =
  | { ok: true; ivId: string; ivNo: string; duplicate?: boolean; ivGross?: number }
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
  // ปกติต้องบาลานซ์ก่อนถึงคีย์ได้ · force (super_admin ฝืน) ข้ามด่านนี้
  if (!opts?.force && !dayRow.balanced)
    return { ok: false, error: dayRow.blockReason ?? "ยอดไม่บาลานซ์ — ยังคีย์ไม่ได้" };

  // checksum guard — เช็กเสมอ แม้ force: Σc-vars ต้อง = total+vat
  // (ถ้าช่องทางบวกไม่ครบ IV จะ Dr≠Cr = ใบเสียที่ TRCloud ไม่รับ/บัญชีเพี้ยน → กันไว้ ต้องเพิ่ม mapping ก่อน)
  const sumC = Object.values(dayRow.cvars).reduce((a, b) => a + b, 0);
  if (Math.abs(sumC - (dayRow.total + dayRow.vat)) > 1)
    return {
      ok: false,
      error: `ส่งไม่ได้: ยอดแยกช่องทางไม่ครบ (Σช่องทาง ${sumC.toLocaleString()} ≠ ยอดรวม ${(dayRow.total + dayRow.vat).toLocaleString()}) — มีช่องทางที่ระบบยังไม่รู้จัก · ต้องเพิ่มก่อนถึงส่งได้`,
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
          // ยอดจริงของใบที่มีอยู่ (อาจคีย์มือต่างจาก POS) → ใช้เทียบ match จริง ไม่เหมา match
          ivGross: amount(existing.grand_total ?? existing.total),
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
        group_code: cfg.groupCode,
        code_number: cfg.codeNumber, // รหัสคู่ค้าเต็ม (กันรหัสเหลือแค่ "C")
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
