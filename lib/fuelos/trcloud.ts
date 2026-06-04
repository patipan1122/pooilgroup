import "server-only";
import { createHash } from "node:crypto";
import { PRODUCT_LABELS } from "@/lib/fuelos/pricing";

// TRCloud API connector (PO Oil · company 31) — ออก/ลบ ใบกำกับภาษี [IV]
// auth: securekey = md5(encrypt_head + "t" + unixTime) · creds จาก env (CEO ใส่ใน Vercel · ไม่ commit)
// ดู spec: [[trcloud-api-iv-create-2026-06-03]]
const BASE = process.env.TRCLOUD_BASE ?? "https://pooil.trcloud.co/application/api-connector2/end-point";
const ORIGIN = process.env.TRCLOUD_ORIGIN ?? "https://pooil.trcloud.co";
const COMPANY_ID = process.env.TRCLOUD_COMPANY_ID ?? "";
const PASSKEY = process.env.TRCLOUD_PASSKEY ?? "";
const ENCRYPT_HEAD = process.env.TRCLOUD_ENCRYPT_HEAD ?? "";
const APPROVE_ID = process.env.TRCLOUD_APPROVE_ID ?? "1";
const IV_TYPE = process.env.TRCLOUD_IV_TYPE ?? "Cash[IV]";
const VAT_RATE = 0.07;

export function trcloudConfigured(): boolean {
  return !!(COMPANY_ID && PASSKEY && ENCRYPT_HEAD);
}

function authFields(): Record<string, string | number> {
  const timestamp = Math.floor(Date.now() / 1000);
  const securekey = createHash("md5").update(`${ENCRYPT_HEAD}t${timestamp}`).digest("hex");
  return { company_id: COMPANY_ID, passkey: PASSKEY, timestamp, securekey };
}

type Json = Record<string, unknown>;
function asObj(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
}
function pick(o: Json | null, ...keys: string[]): string | null {
  if (!o) return null;
  for (const k of keys) {
    const v = o[k];
    if (v != null && (typeof v === "string" || typeof v === "number")) return String(v);
  }
  return null;
}

async function post(path: string, payload: Json): Promise<{ ok: boolean; status: number; data: Json | null; raw: string }> {
  const body = new URLSearchParams({ json: JSON.stringify({ ...authFields(), ...payload }) });
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN },
    body: body.toString(),
  });
  const raw = await res.text();
  let data: Json | null = null;
  try { data = asObj(JSON.parse(raw)); } catch { /* non-json response */ }
  return { ok: res.ok, status: res.status, data, raw };
}

export type IVCustomer = {
  name: string; organization?: string | null; branch?: string | null; address?: string | null;
  email?: string | null; telephone?: string | null; taxId?: string | null;
};
export type IVItem = { productType: string; pricePerLiter: number; qtyLiters: number };
export type CreateIVResult =
  | { ok: true; id: string | null; no: string | null; raw: string }
  | { ok: false; error: string; raw?: string };

export async function createOrderIV(input: {
  issueDate: string; dueDate: string; paymentTerm: number; reference?: string; note?: string;
  customer: IVCustomer; items: IVItem[];
}): Promise<CreateIVResult> {
  if (!trcloudConfigured()) return { ok: false, error: "TRCloud ยังไม่ได้ตั้งค่า (env TRCLOUD_*)" };

  // ราคา VAT-in (CEO เลือก) → vat ที่รวมอยู่ = price*qty * 7/107
  const product = input.items.map((it) => {
    const lineIncl = it.pricePerLiter * it.qtyLiters;
    const vat = Math.round((lineIncl * VAT_RATE / (1 + VAT_RATE)) * 100) / 100;
    return {
      product_id: it.productType,
      product: PRODUCT_LABELS[it.productType] ?? it.productType,
      price: String(it.pricePerLiter),
      quantity: String(it.qtyLiters),
      vat: String(vat),
    };
  });
  const c = input.customer;
  const payload: Json = {
    issue_date: input.issueDate, due_date: input.dueDate, company_format: "IV",
    document_number: "", payment_term: String(input.paymentTerm),
    reference: input.reference ?? "", tax_option: "in",
    approve_id: APPROVE_ID, approve_status: "yes", type: IV_TYPE,
    invoice_note: input.note ?? "", tax_report: "1",
    customer: {
      group_code: "C", name: c.name, organization: c.organization ?? "", branch: c.branch ?? "00000",
      address: c.address ?? "", email: c.email ?? "", telephone: c.telephone ?? "",
      tax_id: c.taxId ?? "", contact_type: "normal", contact_id: "0", add_contact: "1",
    },
    product,
  };

  const r = await post("iv/create.php", payload);
  if (!r.ok) return { ok: false, error: `HTTP ${r.status}`, raw: r.raw.slice(0, 600) };
  const d = r.data;
  const inner = asObj(d?.data) ?? asObj(d?.response) ?? d;
  const id = pick(inner, "id", "document_id") ?? pick(d, "id", "document_id");
  const no = pick(inner, "document_number", "no") ?? pick(d, "document_number", "no");
  const statusStr = pick(d, "status", "result");
  const success = statusStr === "success" || d?.success === true || !!id;
  if (!success) {
    return { ok: false, error: pick(d, "message", "error") ?? (r.raw.slice(0, 200) || "สร้าง IV ไม่สำเร็จ"), raw: r.raw.slice(0, 600) };
  }
  return { ok: true, id, no, raw: r.raw.slice(0, 600) };
}

export async function deleteOrderIV(ivId: string): Promise<{ ok: boolean; error?: string }> {
  if (!trcloudConfigured()) return { ok: false, error: "TRCloud ยังไม่ได้ตั้งค่า" };
  const r = await post("iv/delete.php", { id: ivId });
  if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
  const statusStr = pick(r.data, "status", "result");
  const success = statusStr === "success" || r.data?.success === true || (r.ok && !pick(r.data, "error", "message"));
  return success ? { ok: true } : { ok: false, error: pick(r.data, "message", "error") ?? "ลบ IV ไม่สำเร็จ" };
}
