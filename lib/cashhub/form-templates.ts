// Form Templates · Free mode (Option B)
// ────────────────────────────────────────────────────────────────────
// แต่ละ org สามารถมีหลาย template ต่อ business_type ได้
//   v1 = default (auto-seeded จาก built-in spec)
//   v2, v3+ = custom variants ที่ admin สร้างเอง
// แต่ละสาขาเลือกใช้ template ใด ผ่าน branches.form_template_id (null = ใช้ default)
//
// admin override ของฟิลด์ built-in อยู่ใน `overrides`
// ฟิลด์ที่ admin เพิ่มเองอยู่ใน `custom_fields` (เช่น PromptPay, e-wallet ใหม่)
// ค่าของฟิลด์ custom เก็บใน `daily_reports.extra_fields` (jsonb)
//
// TYPE DEBT: every Supabase call below uses `(admin.from as any)("form_templates")`.
// Reason: form_templates was added after the Supabase types were last generated;
// the generated `Database` type doesn't know about this table → strict TS errors
// without the cast. Permanent fix = `npx supabase gen types typescript` against
// the production schema and replace the local `Database` interface in lib/db/.
// For now `as any` is intentional and contained to this file.

import { adminClient } from "@/lib/db/server";
import {
  BUSINESS_TYPES,
  type BusinessTypeConfig,
  type BusinessTypeKey,
  type FieldConfig,
} from "@/constants/business-types";
import type { BusinessTypeOverrides } from "./form-config";
import { isFieldLocked } from "./form-config";
import type { CustomField, FormTemplate } from "./form-templates-types";

// Re-export for convenience (server-side callers can pull both from this file)
export type { CustomField, FormTemplate } from "./form-templates-types";
export { generateCustomFieldKey } from "./form-templates-types";

/* ============================================================
   Read
   ============================================================ */

export async function listTemplates(
  orgId: string,
  businessType: BusinessTypeKey,
): Promise<FormTemplate[]> {
  const admin = adminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin.from as any)("form_templates")
    .select("*")
    .eq("org_id", orgId)
    .eq("business_type", businessType)
    .eq("is_active", true)
    .order("version", { ascending: true });
  return ((data ?? []) as FormTemplate[]).map(normalizeTemplate);
}

export async function getTemplate(
  orgId: string,
  templateId: string,
): Promise<FormTemplate | null> {
  const admin = adminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin.from as any)("form_templates")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", templateId)
    .maybeSingle();
  return data ? normalizeTemplate(data as FormTemplate) : null;
}

export async function getDefaultTemplate(
  orgId: string,
  businessType: BusinessTypeKey,
): Promise<FormTemplate | null> {
  const admin = adminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin.from as any)("form_templates")
    .select("*")
    .eq("org_id", orgId)
    .eq("business_type", businessType)
    .eq("is_default", true)
    .eq("is_active", true)
    .maybeSingle();
  return data ? normalizeTemplate(data as FormTemplate) : null;
}

/**
 * Ensure a default template exists for (org, businessType).
 * Auto-seeds v1 from built-in spec on first load.
 * Race-safe: if 2 concurrent calls both pass the existence check, one INSERT
 * wins and the other hits the UNIQUE(org_id, business_type, version) constraint.
 * We catch unique-violation, re-read, return the winner's row.
 */
export async function ensureDefaultTemplate(
  orgId: string,
  businessType: BusinessTypeKey,
  createdBy?: string | null,
): Promise<FormTemplate> {
  const existing = await getDefaultTemplate(orgId, businessType);
  if (existing) return existing;

  const admin = adminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.from as any)("form_templates")
    .insert({
      org_id: orgId,
      business_type: businessType,
      name: "ค่าเริ่มต้น",
      version: 1,
      is_default: true,
      overrides: {},
      custom_fields: [],
      created_by: createdBy ?? null,
    })
    .select("*")
    .single();

  // Postgres unique violation = "23505" — race lost · re-read winner's row
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      const winner = await getDefaultTemplate(orgId, businessType);
      if (winner) return winner;
    }
    throw new Error(error.message);
  }
  return normalizeTemplate(data as FormTemplate);
}

/* ============================================================
   Mutations (super_admin/org_admin only — caller must check)
   ============================================================ */

export async function createTemplate(
  orgId: string,
  businessType: BusinessTypeKey,
  name: string,
  cloneFromId?: string,
  createdBy?: string | null,
): Promise<FormTemplate> {
  const admin = adminClient();

  // Find next version number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (admin.from as any)("form_templates")
    .select("version")
    .eq("org_id", orgId)
    .eq("business_type", businessType)
    .order("version", { ascending: false })
    .limit(1);
  const nextVersion =
    existing && existing.length > 0
      ? Number((existing[0] as { version: number }).version) + 1
      : 1;

  let overrides: BusinessTypeOverrides = {};
  let customFields: CustomField[] = [];
  if (cloneFromId) {
    const src = await getTemplate(orgId, cloneFromId);
    if (src) {
      overrides = JSON.parse(JSON.stringify(src.overrides));
      customFields = JSON.parse(JSON.stringify(src.custom_fields));
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.from as any)("form_templates")
    .insert({
      org_id: orgId,
      business_type: businessType,
      name: name.trim().slice(0, 80) || `เวอร์ชั่น ${nextVersion}`,
      version: nextVersion,
      is_default: false,
      overrides,
      custom_fields: customFields,
      created_by: createdBy ?? null,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return normalizeTemplate(data as FormTemplate);
}

export interface UpdateTemplatePatch {
  name?: string;
  overrides?: BusinessTypeOverrides;
  custom_fields?: CustomField[];
}

export async function updateTemplate(
  orgId: string,
  templateId: string,
  patch: UpdateTemplatePatch,
): Promise<FormTemplate> {
  const admin = adminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const upd: Record<string, any> = {};
  if (patch.name !== undefined) upd.name = patch.name.trim().slice(0, 80);
  if (patch.overrides !== undefined) upd.overrides = patch.overrides;
  if (patch.custom_fields !== undefined) {
    upd.custom_fields = sanitizeCustomFields(patch.custom_fields);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.from as any)("form_templates")
    .update(upd)
    .eq("org_id", orgId)
    .eq("id", templateId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return normalizeTemplate(data as FormTemplate);
}

export async function deleteTemplate(
  orgId: string,
  templateId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const admin = adminClient();

  const tpl = await getTemplate(orgId, templateId);
  if (!tpl) return { ok: false, reason: "ไม่พบ template" };
  if (tpl.is_default) {
    return { ok: false, reason: "ลบ default version ไม่ได้" };
  }

  // Check no branches use this template
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (admin.from as any)("branches")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("form_template_id", templateId);
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      reason: `มี ${count} สาขาใช้ template นี้อยู่ — ย้ายสาขาก่อน`,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from as any)("form_templates")
    .update({ is_active: false })
    .eq("org_id", orgId)
    .eq("id", templateId);
  return { ok: true };
}

/* ============================================================
   Compose effective config (built-in + overrides + custom fields)
   ============================================================ */

/**
 * Apply a template to the built-in business type spec → final FieldConfig[].
 * Built-in fields can be overridden (label/hint/required/hidden/numericOnly).
 * Custom fields are appended in their group, sorted by sortOrder.
 */
export function composeFieldsFromTemplate(
  template: FormTemplate | null | undefined,
): BusinessTypeConfig | undefined {
  if (!template) return undefined;
  const base = BUSINESS_TYPES[template.business_type];
  if (!base) return undefined;

  // 1. Built-in fields with overrides
  const builtIn: FieldConfig[] = [];
  for (const f of base.fields) {
    const ov = template.overrides[f.key];
    const locked = isFieldLocked(template.business_type, f.key);
    const numericDefault = f.type === "currency" || f.type === "number";

    if (ov?.hidden && !locked) continue;

    builtIn.push({
      ...f,
      label: ov?.label?.trim() || f.label,
      placeholder: ov?.placeholder?.trim() || f.placeholder,
      hint: ov?.hint?.trim() ?? f.hint,
      required:
        locked
          ? f.required
          : ov?.required !== undefined
            ? ov.required
            : f.required,
      numericOnly:
        ov?.numericOnly !== undefined ? ov.numericOnly : numericDefault,
    });
  }

  // 2. Custom fields → append (cast to FieldConfig — column is irrelevant for custom)
  const customAsField: FieldConfig[] = template.custom_fields.map((cf) => ({
    key: cf.key,
    label: cf.label,
    placeholder: cf.placeholder,
    type: cf.type,
    unit: cf.unit,
    group: cf.group,
    required: cf.required,
    hint: cf.hint,
    numericOnly:
      cf.numericOnly !== undefined
        ? cf.numericOnly
        : cf.type === "currency" || cf.type === "number",
    // Custom fields don't map to a daily_reports column — value goes into extra_fields jsonb
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    column: "_custom" as any,
  }));

  // Sort custom fields by sortOrder, then merge — keep built-in order, append custom in groups
  const customSorted = [...customAsField].sort((a, b) => {
    const sa =
      template.custom_fields.find((cf) => cf.key === a.key)?.sortOrder ?? 0;
    const sb =
      template.custom_fields.find((cf) => cf.key === b.key)?.sortOrder ?? 0;
    return sa - sb;
  });

  return {
    ...base,
    fields: [...builtIn, ...customSorted],
  };
}

/* ============================================================
   Helpers
   ============================================================ */

function normalizeTemplate(t: FormTemplate): FormTemplate {
  // Defensive — ensure JSONB cols default to empty containers
  return {
    ...t,
    overrides: t.overrides ?? {},
    custom_fields: Array.isArray(t.custom_fields) ? t.custom_fields : [],
  };
}

function sanitizeCustomFields(input: CustomField[]): CustomField[] {
  const seen = new Set<string>();
  const out: CustomField[] = [];
  for (const cf of input) {
    if (!cf.key || typeof cf.key !== "string") continue;
    if (seen.has(cf.key)) continue;
    seen.add(cf.key);

    out.push({
      key: cf.key.trim().slice(0, 60),
      label: (cf.label ?? "").trim().slice(0, 80) || cf.key,
      type:
        cf.type === "currency" || cf.type === "number" || cf.type === "text"
          ? cf.type
          : "currency",
      group: cf.group ?? "custom",
      required: !!cf.required,
      hint: cf.hint?.trim().slice(0, 200) || undefined,
      placeholder: (cf.placeholder ?? "").trim().slice(0, 80) || "0",
      unit: cf.unit?.trim().slice(0, 16) || undefined,
      numericOnly:
        cf.numericOnly !== undefined ? !!cf.numericOnly : undefined,
      isPaymentChannel: !!cf.isPaymentChannel,
      sortOrder: Number.isFinite(cf.sortOrder) ? Number(cf.sortOrder) : 0,
    });
  }
  return out;
}

