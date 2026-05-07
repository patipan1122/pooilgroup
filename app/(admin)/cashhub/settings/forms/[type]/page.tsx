// /cashhub/settings/forms/[type] — per-business-type form editor
//
// Server entry: validate type, load templates (auto-seed default), render client editor.
// Supports ?v=<templateId> for picking which version to edit.

import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { BUSINESS_TYPES, type BusinessTypeKey } from "@/constants/business-types";
import { LOCKED_FIELD_KEYS } from "@/lib/cashhub/form-config";
import {
  ensureDefaultTemplate,
  listTemplates,
} from "@/lib/cashhub/form-templates";
import { FormEditor } from "./form-editor";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ type: string }>;
  searchParams: Promise<{ v?: string }>;
}

export default async function FormEditorPage({ params, searchParams }: Props) {
  const session = await requireRole("super_admin", "org_admin");
  const { type } = await params;
  const { v: requestedVersionId } = await searchParams;

  const base = BUSINESS_TYPES[type as BusinessTypeKey];
  if (!base) notFound();
  const businessType = type as BusinessTypeKey;

  // Auto-seed v1 default template if none exists
  await ensureDefaultTemplate(
    session.user.org_id,
    businessType,
    session.user.id,
  );

  const templates = await listTemplates(session.user.org_id, businessType);
  const activeTemplate =
    templates.find((t) => t.id === requestedVersionId) ??
    templates.find((t) => t.is_default) ??
    templates[0];

  if (!activeTemplate) notFound();

  const admin = adminClient();
  const { count: branchCount } = await admin
    .from("branches")
    .select("id", { count: "exact", head: true })
    .eq("org_id", session.user.org_id)
    .eq("business_type", businessType)
    .eq("is_active", true);

  // Load all branches of this business type (สำหรับ assignment panel)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: branchesData } = await (admin.from as any)("branches")
    .select("id, code, name, province, form_template_id")
    .eq("org_id", session.user.org_id)
    .eq("business_type", businessType)
    .eq("is_active", true)
    .order("code");
  const branches = (branchesData ?? []) as Array<{
    id: string;
    code: string;
    name: string;
    province: string | null;
    form_template_id: string | null;
  }>;

  const activeTemplateBranchCount = branches.filter(
    (b) => b.form_template_id === activeTemplate.id,
  ).length;

  return (
    <FormEditor
      businessType={businessType}
      label={base.label}
      emoji={base.emoji}
      defaults={base}
      lockedFieldKeys={LOCKED_FIELD_KEYS[businessType] ?? []}
      branchCount={branchCount ?? 0}
      templates={templates}
      activeTemplate={activeTemplate}
      activeTemplateBranchCount={activeTemplateBranchCount}
      branches={branches}
    />
  );
}
