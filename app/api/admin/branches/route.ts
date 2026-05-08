// Branch CRUD — admin scope.
// POST /api/admin/branches  : create new branch

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";

import { BUSINESS_TYPES as BUSINESS_TYPE_CONFIG } from "@/constants/business-types";

const BUSINESS_TYPES = Object.keys(BUSINESS_TYPE_CONFIG) as [
  string,
  ...string[],
];

const CreateSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[A-Z0-9-]+$/i, "ใช้ได้เฉพาะ A-Z, 0-9, -"),
  name: z.string().min(1).max(120),
  // companyId required: branches.company_id is NOT NULL in schema
  // (Pooil Oil / JP Sync / etc. — picked from org's Companies)
  companyId: z.string().uuid("เลือกนิติบุคคลก่อน"),
  businessType: z.enum(BUSINESS_TYPES),
  province: z.string().max(50).optional().or(z.literal("")),
  region: z.string().max(50).optional().or(z.literal("")),
  address: z.string().max(500).optional().or(z.literal("")),
  phone: z.string().max(50).optional().or(z.literal("")),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  managerId: z.string().uuid().nullable().optional(),
  lineGroupId: z.string().max(120).optional().or(z.literal("")),
  reportDeadline: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "เวลาต้องเป็น HH:mm")
    .optional()
    .default("21:00"),
});

export async function POST(req: NextRequest) {
  const session = await requireRole("super_admin", "org_admin", "admin");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const admin = adminClient();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Verify companyId belongs to this org (cross-org guard).
  const { data: company } = await admin
    .from("companies")
    .select("id")
    .eq("id", data.companyId)
    .eq("org_id", session.user.org_id)
    .eq("is_active", true)
    .maybeSingle();
  if (!company) {
    return NextResponse.json(
      { error: "ไม่พบนิติบุคคลที่เลือก หรือไม่ได้อยู่ในบริษัทเดียวกัน" },
      { status: 400 },
    );
  }

  // Verify managerId (if provided) belongs to same org.
  if (data.managerId) {
    const { data: mgr } = await admin
      .from("users")
      .select("id")
      .eq("id", data.managerId)
      .eq("org_id", session.user.org_id)
      .eq("is_active", true)
      .maybeSingle();
    if (!mgr) {
      return NextResponse.json(
        { error: "ผู้จัดการที่เลือกไม่อยู่ในบริษัท" },
        { status: 400 },
      );
    }
  }

  const { error } = await admin.from("branches").insert({
    id,
    org_id: session.user.org_id,
    company_id: data.companyId,
    code: data.code.toUpperCase(),
    name: data.name,
    business_type: data.businessType,
    province: data.province || null,
    region: data.region || null,
    address: data.address || null,
    phone: data.phone || null,
    lat: data.lat ?? null,
    lng: data.lng ?? null,
    manager_id: data.managerId ?? null,
    line_group_id: data.lineGroupId || null,
    report_deadline: data.reportDeadline ?? "21:00",
    is_active: true,
    updated_at: now,
  });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: `รหัสสาขา "${data.code}" มีอยู่แล้ว` },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "CREATE_BRANCH",
    resourceType: "branch",
    resourceId: id,
    diff: { new: { code: data.code, name: data.name, businessType: data.businessType } },
  });

  return NextResponse.json({ success: true, id });
}
