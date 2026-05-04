import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { reconcile } from "@/lib/cashhub/reconcile";
import { getBusinessType } from "@/constants/business-types";
import { audit } from "@/lib/audit/log";
import { withDbDefaults } from "@/lib/db/insert";
import { can } from "@/lib/auth/permissions";

const ReportSchema = z.object({
  branchId: z.string().uuid(),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shift: z.enum(["morning", "midday", "evening", "all"]),
  totalSales: z.number().min(0),
  qty1: z.number().nullable().optional(),
  qty1Unit: z.string().nullable().optional(),
  qty2: z.number().nullable().optional(),
  qty2Unit: z.string().nullable().optional(),
  cash: z.number().min(0),
  transfer: z.number().min(0),
  card: z.number().min(0),
  credit: z.number().min(0),
  shortage: z.number().min(0),
  notes: z.string().max(500).nullable().optional(),
  shortageInfo: z
    .object({
      personId: z.string().uuid().nullable(),
      personName: z.string().nullable(),
      isIdentified: z.boolean(),
      note: z.string().nullable(),
    })
    .nullable()
    .optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!can(session.user, "cashhub.create")) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์กรอกรายงาน" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "ข้อมูลไม่ถูกต้อง", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const admin = adminClient();

  // Verify branch + access
  const { data: branch } = await admin
    .from("branches")
    .select("id, org_id, business_type, manager_id")
    .eq("id", data.branchId)
    .eq("org_id", session.user.org_id)
    .eq("is_active", true)
    .maybeSingle();

  if (!branch) {
    return NextResponse.json({ error: "ไม่พบสาขา" }, { status: 404 });
  }

  // Check user_branches link unless admin
  const isAdmin = ["super_admin", "org_admin"].includes(session.user.role);
  if (!isAdmin) {
    const { data: link } = await admin
      .from("user_branches")
      .select("id")
      .eq("user_id", session.user.id)
      .eq("branch_id", data.branchId)
      .eq("is_active", true)
      .maybeSingle();
    if (!link) {
      return NextResponse.json(
        { error: "ไม่มีสิทธิ์กรอกของสาขานี้" },
        { status: 403 },
      );
    }
  }

  // Re-validate reconcile server-side (RULES §4 — never trust client)
  const config = getBusinessType(branch.business_type);
  if (config?.hasReconcile) {
    const result = reconcile(data);
    if (!result.isBalanced) {
      return NextResponse.json(
        { error: "ยอดไม่ตรง", details: result.message },
        { status: 422 },
      );
    }
  }

  // Insert with idempotent UNIQUE(branch_id, report_date, shift)
  const insertPayload = withDbDefaults({
    org_id: branch.org_id,
    branch_id: data.branchId,
    report_date: data.reportDate,
    shift: data.shift,
    total_sales: data.totalSales,
    qty1: data.qty1 ?? null,
    qty1_unit: data.qty1Unit ?? null,
    qty2: data.qty2 ?? null,
    qty2_unit: data.qty2Unit ?? null,
    cash: data.cash,
    transfer: data.transfer,
    card: data.card,
    credit: data.credit,
    shortage: data.shortage,
    notes: data.notes ?? null,
    status: "submitted",
    submitted_by_id: session.user.id,
    submitted_at: new Date().toISOString(),
  });

  const { data: created, error } = await admin
    .from("daily_reports")
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "เคยกรอกรายงานวัน/กะนี้ไปแล้ว" },
        { status: 409 },
      );
    }
    console.error("[POST /cashhub/reports]", error);
    return NextResponse.json({ error: "บันทึกไม่ได้ ลองใหม่อีกครั้ง" }, { status: 500 });
  }

  // Insert cash shortage row if any
  if (data.shortage > 0) {
    const info = data.shortageInfo;
    await admin.from("cash_shortages").insert({
      id: crypto.randomUUID(),
      org_id: branch.org_id,
      report_id: created.id,
      branch_id: branch.id,
      report_date: data.reportDate,
      amount: data.shortage,
      person_id: info?.personId ?? null,
      person_name: info?.personName ?? null,
      is_identified: info?.isIdentified ?? false,
      note: info?.note ?? null,
    });
  }

  // Audit log
  await audit({
    orgId: branch.org_id,
    userId: session.user.id,
    action: "CREATE_REPORT",
    resourceType: "daily_report",
    resourceId: created.id,
    diff: { new: { totalSales: data.totalSales, shift: data.shift } },
  });

  // TODO Day 6: send Telegram message to branch manager
  // TODO Day 7: send LINE Reply confirmation

  return NextResponse.json({ success: true, data: created }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!can(session.user, "cashhub.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");
  const date = searchParams.get("date");
  const status = searchParams.get("status");

  const admin = adminClient();
  let query = admin
    .from("daily_reports")
    .select(
      "id, branch_id, report_date, shift, total_sales, status, submitted_at, approved_at, branches(code, name, business_type)",
    )
    .eq("org_id", session.user.org_id)
    .order("submitted_at", { ascending: false })
    .limit(50);

  if (branchId) query = query.eq("branch_id", branchId);
  if (date) query = query.eq("report_date", date);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data });
}
