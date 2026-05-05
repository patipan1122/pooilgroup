// Pooilgroup ERP — Effective form config (defaults + per-org overrides)
//
// Defaults live in `constants/business-types.ts` (code-level, immutable).
// Admin can tweak certain field properties per-business-type via
// `organizations.settings.formOverrides` JSONB. This module merges the two
// into the "effective" config that gets rendered to staff.
//
// Editable: label, placeholder, hint, required (toggle), hidden (toggle).
// NOT editable (would break DB write path / aggregations):
//   - column mapping
//   - field type
//   - field key
//   - qtyUnit
//   - group
// Custom fields (admin-defined) are out of MVP scope.

import {
  BUSINESS_TYPES,
  type BusinessTypeConfig,
  type BusinessTypeKey,
  type FieldConfig,
} from "@/constants/business-types";

export interface FieldOverride {
  label?: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  hidden?: boolean;
  /** Force numeric-only input (digits + decimal point). Currency/number fields are always numeric. */
  numericOnly?: boolean;
}

export type BusinessTypeOverrides = Partial<Record<string, FieldOverride>>;

export type FormOverridesMap = Partial<
  Record<BusinessTypeKey, BusinessTypeOverrides>
>;

/**
 * Field keys that are critical to data integrity / business invariants.
 * These cannot be hidden or made non-required regardless of overrides.
 *
 * Pattern: every business type has a primary money field — usually
 * `totalSales`. Kiosks (massage_chair / claw_machine) primary capture
 * is `cash` (the operator counts cash as ground truth, totalSales mirrors).
 *
 * Why: if an admin accidentally hides totalSales, every report becomes
 * worthless and aggregations break — recovery requires data backfill.
 * Keep these locked, no UI to override.
 */
export const LOCKED_FIELD_KEYS: Partial<Record<BusinessTypeKey, string[]>> = {
  fuel_station: ["totalSales", "qty1"],
  lpg_station: ["totalSales", "qty1"],
  lpg_retail: ["totalSales", "qty1"],
  bottling_plant: ["totalSales", "qty1"],
  hotel: ["totalSales", "qty1"],
  convenience_store: ["totalSales"],
  ev_station: ["totalSales", "qty1"],
  cafe: ["totalSales", "qty1"],
  cafe_punthai: ["totalSales", "qty1"],
  massage_chair: ["totalSales", "cash", "qty1"],
  claw_machine: ["totalSales", "cash", "qty1"],
  training_center: ["totalSales", "qty1"],
};

export function isFieldLocked(
  businessType: BusinessTypeKey,
  fieldKey: string,
): boolean {
  return LOCKED_FIELD_KEYS[businessType]?.includes(fieldKey) ?? false;
}

function applyFieldOverride(
  businessType: BusinessTypeKey,
  field: FieldConfig,
  override: FieldOverride | undefined,
): FieldConfig | null {
  if (!override) return field;

  const locked = isFieldLocked(businessType, field.key);

  // hidden -> filter out (unless locked)
  if (override.hidden && !locked) return null;

  // Effective numericOnly: explicit override > type default (currency/number=true, text=false)
  const numericDefault = field.type === "currency" || field.type === "number";
  const numericOnly =
    override.numericOnly !== undefined ? override.numericOnly : numericDefault;

  return {
    ...field,
    label: override.label?.trim() || field.label,
    placeholder: override.placeholder?.trim() || field.placeholder,
    hint: override.hint?.trim() ?? field.hint,
    // required can only be relaxed for non-locked fields
    required: locked
      ? field.required
      : override.required !== undefined
        ? override.required
        : field.required,
    numericOnly,
  };
}

/**
 * Build the effective config a given branch should render right now.
 * Reads org-level overrides from `organizations.settings.formOverrides`.
 */
export function getEffectiveBusinessTypeConfig(
  businessType: BusinessTypeKey,
  orgSettings: Record<string, unknown> | null | undefined,
): BusinessTypeConfig | undefined {
  const base = BUSINESS_TYPES[businessType];
  if (!base) return undefined;

  const overridesMap = (orgSettings?.formOverrides as FormOverridesMap) ?? {};
  const typeOverrides = overridesMap[businessType];
  if (!typeOverrides) return base;

  const fields = base.fields
    .map((f) => applyFieldOverride(businessType, f, typeOverrides[f.key]))
    .filter((f): f is FieldConfig => f !== null);

  return { ...base, fields };
}

/**
 * Pull the raw overrides map for the admin editor UI.
 */
export function readFormOverrides(
  orgSettings: Record<string, unknown> | null | undefined,
): FormOverridesMap {
  return (orgSettings?.formOverrides as FormOverridesMap) ?? {};
}

/**
 * Whitelist + sanitize an override payload from the editor before persisting.
 * Drops empty objects and silently ignores attempts to flip locked fields.
 */
export function sanitizeOverridesForType(
  businessType: BusinessTypeKey,
  raw: BusinessTypeOverrides,
): BusinessTypeOverrides {
  const base = BUSINESS_TYPES[businessType];
  if (!base) return {};

  const out: BusinessTypeOverrides = {};
  const validKeys = new Set(base.fields.map((f) => f.key));

  for (const [fieldKey, ov] of Object.entries(raw)) {
    if (!validKeys.has(fieldKey)) continue;
    if (!ov) continue;

    const locked = isFieldLocked(businessType, fieldKey);
    const cleaned: FieldOverride = {};

    if (typeof ov.label === "string" && ov.label.trim().length > 0) {
      cleaned.label = ov.label.trim().slice(0, 80);
    }
    if (typeof ov.placeholder === "string") {
      cleaned.placeholder = ov.placeholder.trim().slice(0, 80);
    }
    if (typeof ov.hint === "string") {
      cleaned.hint = ov.hint.trim().slice(0, 200);
    }
    if (typeof ov.required === "boolean" && !locked) {
      cleaned.required = ov.required;
    }
    if (typeof ov.hidden === "boolean" && !locked) {
      cleaned.hidden = ov.hidden;
    }
    if (typeof ov.numericOnly === "boolean") {
      cleaned.numericOnly = ov.numericOnly;
    }

    if (Object.keys(cleaned).length > 0) out[fieldKey] = cleaned;
  }

  return out;
}
