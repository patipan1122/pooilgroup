// GET /api/admin/branches/export
// Download all branches as CSV (for accounting / audit / admin records).

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";

function quote(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET() {
  const session = await requireRole("super_admin", "org_admin");
  const admin = adminClient();
  const orgId = session.user.org_id;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: branches } = await (admin.from as any)("branches")
    .select(
      "id, code, name, business_type, company_id, province, region, address, phone, line_group_id, is_active, created_at",
    )
    .eq("org_id", orgId)
    .order("code");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: companies } = await (admin.from as any)("companies")
    .select("id, code, name")
    .eq("org_id", orgId);

  const companyById = new Map<string, { code: string; name: string }>();
  for (const c of (companies ?? []) as Array<{ id: string; code: string; name: string }>) {
    companyById.set(c.id, { code: c.code, name: c.name });
  }

  const headers = [
    "code",
    "name",
    "businessType",
    "companyCode",
    "companyName",
    "province",
    "region",
    "address",
    "phone",
    "lineGroupId",
    "status",
  ];

  const lines: string[] = [headers.join(",")];
  for (const b of (branches ?? []) as Array<{
    code: string;
    name: string;
    business_type: string;
    company_id: string | null;
    province: string | null;
    region: string | null;
    address: string | null;
    phone: string | null;
    line_group_id: string | null;
    is_active: boolean;
  }>) {
    const company = b.company_id ? companyById.get(b.company_id) : null;
    lines.push(
      [
        quote(b.code),
        quote(b.name),
        quote(b.business_type),
        quote(company?.code),
        quote(company?.name),
        quote(b.province),
        quote(b.region),
        quote(b.address),
        quote(b.phone),
        quote(b.line_group_id),
        quote(b.is_active ? "active" : "inactive"),
      ].join(","),
    );
  }

  const body = "﻿" + lines.join("\n");

  await audit({
    orgId,
    userId: session.user.id,
    action: "EXPORT_DATA",
    resourceType: "branches",
    diff: { new: { count: lines.length - 1, format: "csv" } },
  });

  const filename = `pooilgroup-branches-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
