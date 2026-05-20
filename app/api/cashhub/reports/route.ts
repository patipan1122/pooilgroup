import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { zUUID } from "@/lib/zod-helpers";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { reconcile } from "@/lib/cashhub/reconcile";
import { getBusinessType } from "@/constants/business-types";
import { audit } from "@/lib/audit/log";
import { getRequestMeta } from "@/lib/audit/request-meta";
import { withDbDefaults } from "@/lib/db/insert";
import { can } from "@/lib/auth/permissions";
import { sendTelegramMessage, sendToAdminChat } from "@/lib/telegram/send";
import { sendNotification } from "@/lib/notifications/send";
import {
  approvalKeyboard,
  buildApprovalMessage,
} from "@/lib/telegram/messages";
import { autoCheck } from "@/lib/cashhub/auto-check";
import { getRequestBaseUrl } from "@/lib/utils/base-url";
import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

const ReportSchema = z.object({
  branchId: zUUID(),
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
  rentalIncome: z.number().min(0).optional(),
  trainingSessions: z.number().int().min(0).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  shortageInfo: z
    .object({
      personId: zUUID().nullable(),
      personName: z.string().nullable(),
      isIdentified: z.boolean(),
      note: z.string().nullable(),
    })
    .nullable()
    .optional(),
  // Custom field values (admin-defined fields beyond built-in spec)
  // Map from custom field key → value (number or string or null)
  extraFields: z
    .record(z.string(), z.union([z.number(), z.string(), z.null()]))
    .optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireSession();
  const meta = getRequestMeta(req);
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
  // เงินเกิน OK · only block when received < sales (under)
  // feedback_overcollect_allowed.md
  const config = getBusinessType(branch.business_type);
  if (config?.hasReconcile) {
    const result = reconcile(data);
    if (!result.isAcceptable) {
      return NextResponse.json(
        { error: "ยอดรับยังขาด", details: result.message },
        { status: 422 },
      );
    }
  }

  // D-020: ถ้ามี shortage > 0 ต้องระบุชื่อพนักงาน · HR จะเอาไปหักเงินเดือนภายนอก
  // Client (shortage-modal.tsx) บังคับ identify อยู่แล้ว · server enforce ซ้ำ
  // กัน POST ตรงด้วย shortageInfo=null
  if (data.shortage > 0) {
    if (
      !data.shortageInfo ||
      !data.shortageInfo.isIdentified ||
      !data.shortageInfo.personName
    ) {
      return NextResponse.json(
        {
          error: "เงินขาดต้องระบุชื่อพนักงานที่รับผิดชอบ (สำหรับฝ่ายบุคคล)",
        },
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
    rental_income: data.rentalIncome ?? 0,
    training_sessions: data.trainingSessions ?? null,
    notes: data.notes ?? null,
    extra_fields: data.extraFields ?? {},
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
      // Idempotency / resubmit branch:
      // 1. Same submitter + rejected → RESUBMIT: UPDATE row with new values, audit RESUBMIT_REPORT
      // 2. Same submitter + submitted/approved/draft → idempotent return (network retry)
      // 3. Different submitter → real conflict 409
      const { data: existing } = await admin
        .from("daily_reports")
        .select(
          "id, status, submitted_by_id, submitted_at, total_sales, cash, transfer, card, credit, shortage, rejected_reason",
        )
        .eq("branch_id", data.branchId)
        .eq("report_date", data.reportDate)
        .eq("shift", data.shift)
        .maybeSingle();

      if (existing && existing.submitted_by_id === session.user.id) {
        // Resubmit path — staff fixes rejected report (CEO 2026-05-20)
        if (existing.status === "rejected") {
          const now = new Date().toISOString();
          const { data: updated, error: updErr } = await admin
            .from("daily_reports")
            .update({
              status: "submitted",
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
              rental_income: data.rentalIncome ?? 0,
              training_sessions: data.trainingSessions ?? null,
              notes: data.notes ?? null,
              extra_fields: data.extraFields ?? {},
              rejected_reason: null,
              submitted_at: now,
              updated_at: now,
              // clear previous approval so flow re-enters approval queue
              approved_by_id: null,
              approved_at: null,
            })
            .eq("id", existing.id)
            .eq("status", "rejected")
            .select("id")
            .single();

          if (updErr || !updated) {
            console.error("[POST /cashhub/reports] resubmit failed", updErr);
            return NextResponse.json(
              { error: "ส่งใหม่ไม่สำเร็จ ลองอีกครั้ง" },
              { status: 500 },
            );
          }

          // Update shortage row (delete old + insert new for simplicity)
          await admin
            .from("cash_shortages")
            .delete()
            .eq("report_id", existing.id);
          if (data.shortage > 0) {
            const info = data.shortageInfo;
            await admin.from("cash_shortages").insert({
              id: crypto.randomUUID(),
              org_id: branch.org_id,
              report_id: existing.id,
              branch_id: branch.id,
              report_date: data.reportDate,
              amount: data.shortage,
              person_id: info?.personId ?? null,
              person_name: info?.personName ?? null,
              is_identified: info?.isIdentified ?? false,
              note: info?.note ?? null,
            });
          }

          await audit({
            orgId: branch.org_id,
            userId: session.user.id,
            action: "RESUBMIT_REPORT",
            resourceType: "daily_report",
            resourceId: existing.id,
            diff: {
              old: {
                status: "rejected",
                total_sales: existing.total_sales,
                cash: existing.cash,
                transfer: existing.transfer,
                card: existing.card,
                credit: existing.credit,
                shortage: existing.shortage,
                rejected_reason: existing.rejected_reason,
              },
              new: {
                status: "submitted",
                total_sales: data.totalSales,
                cash: data.cash,
                transfer: data.transfer,
                card: data.card,
                credit: data.credit,
                shortage: data.shortage,
              },
            },
            ...meta,
          });

          return NextResponse.json(
            { ok: true, resubmitted: true, reportId: existing.id },
            { status: 200 },
          );
        }

        // Idempotent network retry
        return NextResponse.json(
          { ok: true, idempotent: true, report: existing },
          { status: 200 },
        );
      }
      return NextResponse.json(
        { error: "เคยกรอกรายงานวัน/กะนี้ไปแล้ว (อาจมีคนอื่นกรอกพร้อมกัน)" },
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

  // Audit log (financial snapshot for accountant audit trail)
  await audit({
    orgId: branch.org_id,
    userId: session.user.id,
    action: "CREATE_REPORT",
    resourceType: "daily_report",
    resourceId: created.id,
    diff: {
      new: {
        totalSales: data.totalSales,
        cash: data.cash,
        transfer: data.transfer,
        card: data.card,
        credit: data.credit,
        shortage: data.shortage,
        shift: data.shift,
        reportDate: data.reportDate,
      },
    },
    ...meta,
  });

  // In-app notification → branch manager (กัน Telegram bot ล่ม)
  // ถ้าไม่มี manager_id จะ skip · Telegram ยังส่งเป็น fallback
  if (branch.manager_id && branch.manager_id !== session.user.id) {
    try {
      const { data: branchInfo } = await admin
        .from("branches")
        .select("code, name")
        .eq("id", branch.id)
        .maybeSingle();
      await sendNotification({
        orgId: branch.org_id,
        userId: branch.manager_id,
        type: "info",
        module: "cashhub",
        title: `📋 รายงานใหม่รอ approve · ${branchInfo?.code ?? ""}`,
        body: `${session.user.name} ส่งรายงาน ${data.reportDate} · ยอด ${data.totalSales.toLocaleString()} ฿`,
        link: `/cashhub/reports/${created.id}`,
      });
    } catch (err) {
      console.error("[reports] failed to notify branch manager", err);
    }
  }

  // ---- Send Telegram approval card ----
  // Run auto-check to enrich the message
  try {
    const last30 = formatInTimeZone(
      subDays(new Date(), 29),
      TZ,
      "yyyy-MM-dd",
    );
    const today = formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");
    const { data: history } = await admin
      .from("daily_reports")
      .select("total_sales, status")
      .eq("branch_id", branch.id)
      .neq("id", created.id)
      .gte("report_date", last30)
      .lte("report_date", today);
    const history30dTotals = (history ?? [])
      .filter((h) => h.status === "approved")
      .map((h) => Number(h.total_sales || 0));
    const ac = autoCheck({
      totalSales: data.totalSales,
      cash: data.cash,
      transfer: data.transfer,
      card: data.card,
      credit: data.credit,
      shortage: data.shortage,
      submittedAt: created.submitted_at,
      reportDate: data.reportDate,
      hasReconcile: config?.hasReconcile ?? true,
      history30dTotals,
    });

    // Branch metadata for message
    const { data: branchFull } = await admin
      .from("branches")
      .select("code, name, business_type, manager_id, line_group_id")
      .eq("id", branch.id)
      .maybeSingle();
    const messageText = buildApprovalMessage({
      reportId: created.id,
      branchCode: branchFull?.code ?? "—",
      branchName: branchFull?.name ?? "",
      businessType: branchFull?.business_type ?? branch.business_type,
      reportDate: data.reportDate,
      shift: data.shift,
      totalSales: data.totalSales,
      qty1: data.qty1 ?? null,
      qty1Unit: data.qty1Unit ?? null,
      cash: data.cash,
      transfer: data.transfer,
      card: data.card,
      credit: data.credit,
      shortage: data.shortage,
      submittedByName: session.user.name,
      reconcileOk:
        Math.abs(
          data.totalSales -
            (data.cash + data.transfer + data.card + data.credit + data.shortage),
        ) < 0.01,
      autoCheckSummary: ac.summary,
    });
    const baseUrl = getRequestBaseUrl(req);
    // approvalKeyboard already prefixes callback_data with `cashhub:` —
    // do NOT re-prefix here (would produce `cashhub:cashhub:...`).
    const keyboard = approvalKeyboard(created.id, baseUrl);

    // Try branch manager DM first
    let sent: { messageId: number; chatId: string | number } | null = null;
    if (branchFull?.manager_id) {
      const { data: manager } = await admin
        .from("users")
        .select("telegram_chat_id")
        .eq("id", branchFull.manager_id)
        .maybeSingle();
      if (manager?.telegram_chat_id) {
        sent = await sendTelegramMessage({
          chatId: manager.telegram_chat_id,
          text: messageText,
          parseMode: "HTML",
          inlineKeyboard: keyboard,
        });
      }
    }
    // Fallback to admin chat
    if (!sent) {
      sent = await sendToAdminChat({
        text: messageText,
        parseMode: "HTML",
        inlineKeyboard: keyboard,
      });
    }
    if (sent) {
      await admin
        .from("daily_reports")
        .update({
          telegram_message_id: sent.messageId.toString(),
          telegram_chat_id: sent.chatId.toString(),
        })
        .eq("id", created.id);
    }
  } catch (err) {
    console.error("[reports] telegram send failed", err);
    // Non-fatal — report still saved
  }

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
