// POST /api/admin/branches/bulk-import
// Bulk insert branches from CSV upload.
// Validates each row, creates branches, attaches to specified company by code.
// Returns summary + per-row results.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { BUSINESS_TYPES as BUSINESS_TYPE_CONFIG } from "@/constants/business-types";

const VALID_BUSINESS_TYPES = Object.keys(BUSINESS_TYPE_CONFIG) as [
  string,
  ...string[],
];

const RowSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  businessType: z.enum(VALID_BUSINESS_TYPES),
  companyCode: z.string().min(1).max(20),
  province: z.string().max(80).optional(),
  region: z.string().max(80).optional(),
  phone: z.string().max(50).optional(),
});

const BodySchema = z.object({
  rows: z.array(RowSchema.passthrough()).min(1).max(200),
});

export async function POST(req: NextRequest) {
  const session = await requireRole("super_admin", "org_admin");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
      { status: 400 },
    );
  }

  const admin = adminClient();
  const orgId = session.user.org_id;
  const now = new Date().toISOString();

  // Pre-fetch companies to map companyCode → company_id
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: companiesData } = await (admin.from as any)("companies")
    .select("id, code")
    .eq("org_id", orgId)
    .eq("is_active", true);
  const companyByCode = new Map<string, string>();
  for (const c of (companiesData ?? []) as Array<{ id: string; code: string }>) {
    companyByCode.set(c.code.toUpperCase(), c.id);
  }

  // Pre-fetch existing branch codes to detect duplicates
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingData } = await (admin.from as any)("branches")
    .select("code")
    .eq("org_id", orgId);
  const existingCodes = new Set<string>(
    ((existingData ?? []) as Array<{ code: string }>).map((b) => b.code.toUpperCase()),
  );

  const results: Array<{
    code: string;
    name: string;
    success: boolean;
    branchId?: string;
    error?: string;
  }> = [];

  for (const row of parsed.data.rows) {
    const code = row.code.toUpperCase().trim();
    const companyCode = row.companyCode.toUpperCase().trim();

    // Validation
    const companyId = companyByCode.get(companyCode);
    if (!companyId) {
      results.push({
        code,
        name: row.name,
        success: false,
        error: `ไม่พบบริษัทรหัส ${companyCode}`,
      });
      continue;
    }

    if (existingCodes.has(code)) {
      results.push({
        code,
        name: row.name,
        success: false,
        error: `รหัสสาขา ${code} ซ้ำ`,
      });
      continue;
    }

    const branchId = crypto.randomUUID();
    const { error: insertErr } = await admin.from("branches").insert({
      id: branchId,
      org_id: orgId,
      company_id: companyId,
      code,
      name: row.name.trim(),
      business_type: row.businessType,
      province: row.province?.trim() || null,
      region: row.region?.trim() || null,
      phone: row.phone?.trim() || null,
      is_active: true,
      updated_at: now,
    });

    if (insertErr) {
      results.push({
        code,
        name: row.name,
        success: false,
        error: insertErr.message,
      });
      continue;
    }

    existingCodes.add(code);
    results.push({ code, name: row.name, success: true, branchId });
  }

  const success = results.filter((r) => r.success).length;
  const failed = results.length - success;

  await audit({
    orgId,
    userId: session.user.id,
    action: "CREATE_BRANCH",
    resourceType: "branches_bulk",
    diff: { new: { total: results.length, success, failed } },
  });

  return NextResponse.json({
    summary: { total: results.length, success, failed },
    results,
  });
}
