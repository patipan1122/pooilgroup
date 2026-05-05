// Shared types + pure helpers for Form Templates (Free mode)
// Safe to import from BOTH client and server. No DB / Supabase imports.

import type {
  BusinessTypeKey,
  FieldGroup,
  FieldType,
} from "@/constants/business-types";
import type { BusinessTypeOverrides } from "./form-config";

export interface CustomField {
  /** Stable identifier — auto-generated from label + random suffix */
  key: string;
  label: string;
  type: FieldType;
  group: FieldGroup;
  required: boolean;
  hint?: string;
  placeholder: string;
  unit?: string;
  numericOnly?: boolean;
  /** When true, value sums into "received" total for reconcile */
  isPaymentChannel?: boolean;
  sortOrder: number;
}

export interface FormTemplate {
  id: string;
  org_id: string;
  business_type: BusinessTypeKey;
  name: string;
  version: number;
  is_default: boolean;
  overrides: BusinessTypeOverrides;
  custom_fields: CustomField[];
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Generate a stable key from a Thai/English label.
 * Format: cf_<random8>_<short_slug>
 */
export function generateCustomFieldKey(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  const rand = Math.random().toString(36).slice(2, 10);
  return slug ? `cf_${rand}_${slug}` : `cf_${rand}`;
}
