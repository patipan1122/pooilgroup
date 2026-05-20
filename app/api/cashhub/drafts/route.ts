// Server-side draft autosave for CashHub report form.
// 2026-05-20: ย้ายจาก localStorage → DB (Branch Manager audit).
//
// GET    ?branchId=&date=&shift=         → load draft for (user, branch, date, shift)
// PUT    body: { branchId, date, shift, values } → upsert draft
// DELETE ?branchId=&date=&shift=         → remove draft (call หลัง submit สำเร็จ)

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { requireSession } from "@/lib/auth/session";
import { serverClient } from "@/lib/db/server";

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

const PutSchema = z.object({
  branchId: zUUID(),
  date: DateString,
  shift: z.string().min(1).max(32),
  values: z.record(z.string(), z.unknown()),
});

const QuerySchema = z.object({
  branchId: zUUID(),
  date: DateString,
  shift: z.string().min(1).max(32),
});

export async function GET(req: NextRequest) {
  const session = await requireSession();
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    branchId: url.searchParams.get("branchId"),
    date: url.searchParams.get("date"),
    shift: url.searchParams.get("shift"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const { branchId, date, shift } = parsed.data;

  const supabase = await serverClient();
  const { data } = await supabase
    .from("report_drafts")
    .select("form_values, updated_at")
    .eq("user_id", session.user.id)
    .eq("branch_id", branchId)
    .eq("org_id", session.user.org_id)
    .eq("report_date", date)
    .eq("shift", shift)
    .maybeSingle();

  return NextResponse.json({
    values: data?.form_values ?? null,
    updatedAt: data?.updated_at ?? null,
  });
}

export async function PUT(req: NextRequest) {
  const session = await requireSession();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const { branchId, date, shift, values } = parsed.data;

  const supabase = await serverClient();
  // Verify branch belongs to user's org (defense in depth — RLS will block anyway)
  const { data: branch } = await supabase
    .from("branches")
    .select("id")
    .eq("id", branchId)
    .eq("org_id", session.user.org_id)
    .maybeSingle();
  if (!branch) {
    return NextResponse.json({ error: "ไม่พบสาขา" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("report_drafts")
    .upsert(
      {
        org_id: session.user.org_id,
        user_id: session.user.id,
        branch_id: branchId,
        report_date: date,
        shift,
        form_values: values,
        updated_at: now,
      },
      { onConflict: "user_id,branch_id,report_date,shift" },
    );

  if (error) {
    console.error("[PUT /cashhub/drafts]", error);
    return NextResponse.json({ error: "บันทึก draft ไม่สำเร็จ" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await requireSession();
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    branchId: url.searchParams.get("branchId"),
    date: url.searchParams.get("date"),
    shift: url.searchParams.get("shift"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const { branchId, date, shift } = parsed.data;

  const supabase = await serverClient();
  await supabase
    .from("report_drafts")
    .delete()
    .eq("user_id", session.user.id)
    .eq("branch_id", branchId)
    .eq("org_id", session.user.org_id)
    .eq("report_date", date)
    .eq("shift", shift);

  return NextResponse.json({ ok: true });
}
