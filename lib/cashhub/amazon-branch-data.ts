// CashHub Café Amazon — data layer ของ "ทะเบียนสาขา" (cashhub_amazon_branch)
// ให้ super_admin เพิ่มสาขาเองได้ ไม่ต้องแก้โค้ด. ทุก query scope org_id เสมอ (adminClient bypass RLS).
//
// สาขามี 2 แหล่ง:
//   1) built-in (AMAZON_BRANCH_LIST ในโค้ด) — ชุมชนหัวทะเล / เทศบาลจักราช — read-only ในหน้าจัดการ
//   2) custom (ตารางนี้) — สาขาที่ CEO เพิ่มเอง — แก้/ลบได้
// loadAmazonBranches = รวม 2 แหล่ง (ใช้จับคู่ไฟล์ POS). listAmazonBranchesForUi = แยกให้หน้าจัดการ.
import type { adminClient } from "@/lib/db/server";
import {
  AMAZON_BRANCH_LIST,
  matchBranchInList,
  type AmazonBranchCfg,
} from "./amazon-trcloud";

type Admin = ReturnType<typeof adminClient>;

const BUILTIN_PROJECTS = new Set(AMAZON_BRANCH_LIST.map((b) => b.project));

export type CustomAmazonBranch = AmazonBranchCfg & {
  id: string;
  isActive: boolean;
};

export type UiAmazonBranch = AmazonBranchCfg & {
  id: string | null; // null = built-in (ฝังในโค้ด แก้ไม่ได้)
  builtin: boolean;
  isActive: boolean;
};

/** ค่าตั้งสาขาที่รับมาจากฟอร์ม (หน้าจัดการสาขา) */
export type AmazonBranchInput = {
  storeCode?: string;
  nameMatch: string;
  aliases?: string[];
  label: string;
  type: string;
  project: string;
  department: string;
  contactId: string;
  groupCode: string;
  codeNumber: string;
  customerName: string;
  productId?: string;
  productName?: string;
  unit?: string;
  isActive?: boolean;
};

function rowToCustom(r: Record<string, unknown>): CustomAmazonBranch {
  return {
    id: String(r.id),
    storeCode: String(r.store_code ?? ""),
    nameMatch: String(r.name_match ?? ""),
    aliases: Array.isArray(r.aliases) ? (r.aliases as unknown[]).map(String) : [],
    label: String(r.label ?? ""),
    type: String(r.type ?? ""),
    project: String(r.project ?? ""),
    department: String(r.department ?? ""),
    contactId: String(r.contact_id ?? ""),
    groupCode: String(r.group_code ?? ""),
    codeNumber: String(r.code_number ?? ""),
    customerName: String(r.customer_name ?? ""),
    productId: String(r.product_id ?? "P-00005"),
    productName: String(r.product_name ?? "กาแฟ CAFE AMAZON"),
    unit: String(r.unit ?? "วัน"),
    isActive: r.is_active !== false,
  };
}

async function loadCustom(admin: Admin, orgId: string): Promise<CustomAmazonBranch[]> {
  const { data } = await admin
    .from("cashhub_amazon_branch")
    .select("*")
    .eq("org_id", orgId);
  return ((data ?? []) as Record<string, unknown>[]).map(rowToCustom);
}

/** รายการสาขาทั้งหมด (built-in + custom ที่ active) — ใช้จับคู่ไฟล์ POS */
export async function loadAmazonBranches(
  admin: Admin,
  orgId: string,
): Promise<AmazonBranchCfg[]> {
  const custom = (await loadCustom(admin, orgId)).filter(
    (c) => c.isActive && !BUILTIN_PROJECTS.has(c.project),
  );
  return [...AMAZON_BRANCH_LIST, ...custom];
}

/** หา config สาขาจากรหัส/ชื่อ (DB + built-in) — async แทน branchByStoreCode เดิม */
export async function findAmazonBranch(
  admin: Admin,
  orgId: string,
  code: string | null,
  label?: string | null,
): Promise<AmazonBranchCfg | null> {
  return matchBranchInList(await loadAmazonBranches(admin, orgId), code, label);
}

/** รายการสาขาสำหรับหน้าจัดการ — built-in (read-only) ก่อน แล้วต่อด้วย custom */
export async function listAmazonBranchesForUi(
  admin: Admin,
  orgId: string,
): Promise<UiAmazonBranch[]> {
  const custom = await loadCustom(admin, orgId);
  const out: UiAmazonBranch[] = AMAZON_BRANCH_LIST.map((b) => ({
    ...b,
    id: null,
    builtin: true,
    isActive: true,
  }));
  for (const c of custom) {
    if (BUILTIN_PROJECTS.has(c.project)) continue; // กันชนกับ built-in
    out.push({ ...c, builtin: false });
  }
  return out;
}

function validate(input: AmazonBranchInput): string | null {
  const req: [keyof AmazonBranchInput, string][] = [
    ["nameMatch", "ชื่อจับคู่ไฟล์ POS"],
    ["label", "ชื่อสาขา"],
    ["type", "สูตรบัญชี TRCloud"],
    ["project", "โครงการ"],
    ["department", "แผนก"],
    ["contactId", "รหัสคู่ค้า (contact)"],
    ["customerName", "ชื่อลูกค้า"],
  ];
  for (const [k, name] of req) {
    if (!String(input[k] ?? "").trim()) return `ขาดข้อมูล: ${name}`;
  }
  if (BUILTIN_PROJECTS.has(input.project.trim()))
    return "สาขานี้มีอยู่แล้วในระบบ (ตั้งค่ามากับระบบ) — ไม่ต้องเพิ่มซ้ำ";
  return null;
}

/** เพิ่ม/แก้สาขา (idempotent บน org+project) */
export async function upsertAmazonBranch(
  admin: Admin,
  orgId: string,
  input: AmazonBranchInput,
  userId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const err = validate(input);
  if (err) return { ok: false, error: err };
  const aliases = (input.aliases ?? [])
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
  const { error } = await admin.from("cashhub_amazon_branch").upsert(
    {
      org_id: orgId,
      store_code: input.storeCode?.trim() || null,
      name_match: input.nameMatch.trim(),
      aliases,
      label: input.label.trim(),
      type: input.type.trim(),
      project: input.project.trim(),
      department: input.department.trim(),
      contact_id: input.contactId.trim(),
      group_code: input.groupCode.trim(),
      code_number: input.codeNumber.trim(),
      customer_name: input.customerName.trim(),
      product_id: input.productId?.trim() || "P-00005",
      product_name: input.productName?.trim() || "กาแฟ CAFE AMAZON",
      unit: input.unit?.trim() || "วัน",
      is_active: input.isActive ?? true,
      created_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,project" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** ลบสาขา (เฉพาะ custom — built-in ไม่มี id ลบไม่ได้) */
export async function deleteAmazonBranch(
  admin: Admin,
  orgId: string,
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!id) return { ok: false, error: "ไม่มีรหัสสาขา" };
  const { error } = await admin
    .from("cashhub_amazon_branch")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
