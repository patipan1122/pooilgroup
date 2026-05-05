// Telegram webhook handler — receives callback queries from inline buttons.
// Handles:
//   register:approve:{id} | register:reject:{id}
//   cashhub:approve:{reportId} | cashhub:reject:{reportId}
// Plus text-follow-up for reject reason capture.
//
// Security: validates X-Telegram-Bot-Api-Secret-Token header against TELEGRAM_WEBHOOK_SECRET.

import { NextResponse, type NextRequest } from "next/server";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import {
  answerCallbackQuery,
  editTelegramMessage,
  sendTelegramMessage,
  htmlEscape,
} from "@/lib/telegram/send";
import {
  buildApprovedAcknowledgement,
  buildRejectedAcknowledgement,
} from "@/lib/telegram/messages";
import { formatInTimeZone } from "date-fns-tz";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

const POOILGROUP_ORG_ID = "00000000-0000-0000-0000-000000000001";
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TgMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
}

interface TgCallbackQuery {
  id: string;
  from: TgUser;
  data?: string;
  message?: TgMessage;
}

interface TgUpdate {
  update_id: number;
  callback_query?: TgCallbackQuery;
  message?: TgMessage & { from?: TgUser };
}

export async function POST(req: NextRequest) {
  // Verify secret token
  if (SECRET) {
    const provided = req.headers.get("x-telegram-bot-api-secret-token");
    if (provided !== SECRET) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }

  // Handle callback queries (button taps)
  if (update.callback_query) {
    return handleCallback(update.callback_query);
  }

  // Handle text follow-up (reject reason capture)
  if (update.message?.text && update.message.from) {
    return handleTextMessage(update.message as TgMessage & { from: TgUser });
  }

  // Otherwise just ack
  return NextResponse.json({ ok: true });
}

async function handleCallback(cq: TgCallbackQuery) {
  const data = cq.data ?? "";
  const parts = data.split(":");

  if (parts[0] === "register") {
    const action = parts[1] as "approve" | "reject" | undefined;
    const requestId = parts[2];
    if (!action || !requestId || (action !== "approve" && action !== "reject")) {
      await answerCallbackQuery({
        callbackQueryId: cq.id,
        text: "ข้อมูลไม่ถูกต้อง",
      });
      return NextResponse.json({ ok: true });
    }
    return handleRegisterCallback(cq, action, requestId);
  }

  if (parts[0] === "cashhub") {
    const action = parts[1];
    if (action === "bulkapprove") {
      const orgId = parts[2];
      if (!orgId) {
        await answerCallbackQuery({ callbackQueryId: cq.id });
        return NextResponse.json({ ok: true });
      }
      return handleCashhubBulkApprove(cq, orgId);
    }
    const reportId = parts[2];
    if (!action || !reportId || (action !== "approve" && action !== "reject")) {
      await answerCallbackQuery({ callbackQueryId: cq.id });
      return NextResponse.json({ ok: true });
    }
    return handleCashhubCallback(cq, action, reportId);
  }

  // Unknown callback — silently ack
  await answerCallbackQuery({ callbackQueryId: cq.id });
  return NextResponse.json({ ok: true });
}

async function handleCashhubCallback(
  cq: TgCallbackQuery,
  action: "approve" | "reject",
  reportId: string,
) {
  const admin = adminClient();
  const fromId = cq.from.id.toString();

  const { data: tgUser } = await admin
    .from("users")
    .select("id, org_id, name, role")
    .eq("telegram_user_id", fromId)
    .eq("is_active", true)
    .maybeSingle();
  if (!tgUser) {
    await answerCallbackQuery({
      callbackQueryId: cq.id,
      text: "บัญชีนี้ยังไม่ผูกระบบ — ติดต่อ Admin",
      showAlert: true,
    });
    return NextResponse.json({ ok: true });
  }

  const { data: report } = await admin
    .from("daily_reports")
    .select(
      "id, org_id, branch_id, status, total_sales, report_date, branches(code)",
    )
    .eq("id", reportId)
    .eq("org_id", tgUser.org_id)
    .maybeSingle();
  if (!report) {
    await answerCallbackQuery({
      callbackQueryId: cq.id,
      text: "ไม่พบรายงาน",
      showAlert: true,
    });
    return NextResponse.json({ ok: true });
  }
  if (report.status !== "submitted") {
    await answerCallbackQuery({
      callbackQueryId: cq.id,
      text: `รายงานนี้ ${report.status === "approved" ? "อนุมัติ" : "ปฏิเสธ"}แล้ว`,
    });
    return NextResponse.json({ ok: true });
  }

  const allowedRoles = [
    "super_admin",
    "admin",
    "org_admin",
    "branch_manager",
    "area_manager",
  ];
  if (!allowedRoles.includes(tgUser.role)) {
    await answerCallbackQuery({
      callbackQueryId: cq.id,
      text: "ไม่มีสิทธิ์อนุมัติ",
      showAlert: true,
    });
    return NextResponse.json({ ok: true });
  }

  const branchRel = Array.isArray(report.branches)
    ? report.branches[0]
    : report.branches;
  const branchCode = (branchRel as { code?: string } | null)?.code ?? "—";

  if (action === "approve") {
    const now = new Date().toISOString();
    await admin
      .from("daily_reports")
      .update({
        status: "approved",
        approved_by_id: tgUser.id,
        approved_at: now,
        updated_at: now,
      })
      .eq("id", reportId);
    await audit({
      orgId: tgUser.org_id,
      userId: tgUser.id,
      action: "APPROVE_REPORT",
      resourceType: "daily_report",
      resourceId: reportId,
      diff: { new: { status: "approved", via: "telegram" } },
    });
    if (cq.message) {
      await editTelegramMessage({
        chatId: cq.message.chat.id,
        messageId: cq.message.message_id,
        text: buildApprovedAcknowledgement({
          branchCode,
          approvedByName: tgUser.name,
          reportDate: report.report_date as string,
          totalSales: Number(report.total_sales || 0),
          approvedAtTH: formatInTimeZone(now, TZ, "HH:mm"),
        }),
        parseMode: "HTML",
      });
    }
    await answerCallbackQuery({
      callbackQueryId: cq.id,
      text: "✅ อนุมัติแล้ว",
    });
    return NextResponse.json({ ok: true });
  }

  // reject — store pending state, ask for reason
  await admin.from("audit_logs").insert({
    id: crypto.randomUUID(),
    org_id: tgUser.org_id,
    user_id: tgUser.id,
    action: "PERMISSION_DENIED",
    resource_type: "tg_pending_reject",
    resource_id: reportId,
    diff: {
      new: {
        reportId,
        chatId: cq.message?.chat.id,
        messageId: cq.message?.message_id,
        branchCode,
        reportDate: report.report_date,
      },
    },
  });
  await answerCallbackQuery({
    callbackQueryId: cq.id,
    text: "พิมพ์เหตุผลกลับมาในแชท",
  });
  if (cq.message) {
    await sendTelegramMessage({
      chatId: cq.message.chat.id,
      text: `📝 พิมพ์เหตุผลที่ปฏิเสธรายงาน <b>${htmlEscape(branchCode)}</b>\n(พิมพ์ตอบในแชทนี้ได้เลย)`,
      parseMode: "HTML",
    });
  }
  return NextResponse.json({ ok: true });
}

async function handleCashhubBulkApprove(
  cq: TgCallbackQuery,
  orgId: string,
) {
  const admin = adminClient();
  const { data: tgUser } = await admin
    .from("users")
    .select("id, org_id, name, role")
    .eq("telegram_user_id", cq.from.id.toString())
    .eq("is_active", true)
    .maybeSingle();
  if (!tgUser || tgUser.org_id !== orgId) {
    await answerCallbackQuery({
      callbackQueryId: cq.id,
      text: "ไม่มีสิทธิ์",
      showAlert: true,
    });
    return NextResponse.json({ ok: true });
  }
  const allowed = ["super_admin", "admin", "org_admin"];
  if (!allowed.includes(tgUser.role)) {
    await answerCallbackQuery({
      callbackQueryId: cq.id,
      text: "Bulk approve ได้เฉพาะ Admin",
      showAlert: true,
    });
    return NextResponse.json({ ok: true });
  }
  const { data: pending } = await admin
    .from("daily_reports")
    .select("id, branch_id, telegram_message_id, telegram_chat_id")
    .eq("org_id", orgId)
    .eq("status", "submitted");
  if (!pending || pending.length === 0) {
    await answerCallbackQuery({
      callbackQueryId: cq.id,
      text: "ไม่มีรายการรออนุมัติ",
    });
    return NextResponse.json({ ok: true });
  }
  const now = new Date().toISOString();
  await admin
    .from("daily_reports")
    .update({
      status: "approved",
      approved_by_id: tgUser.id,
      approved_at: now,
      updated_at: now,
    })
    .in(
      "id",
      pending.map((r) => r.id),
    );
  for (const r of pending) {
    await audit({
      orgId,
      userId: tgUser.id,
      action: "APPROVE_REPORT",
      resourceType: "daily_report",
      resourceId: r.id as string,
      diff: { new: { status: "approved", via: "telegram_bulk" } },
    });
  }
  await answerCallbackQuery({
    callbackQueryId: cq.id,
    text: `✅ อนุมัติ ${pending.length} รายการ`,
  });
  if (cq.message) {
    await editTelegramMessage({
      chatId: cq.message.chat.id,
      messageId: cq.message.message_id,
      text: `✅ <b>อนุมัติทั้งหมด ${pending.length} รายการ</b>\nโดย ${htmlEscape(tgUser.name)}\n${formatInTimeZone(now, TZ, "HH:mm")}`,
      parseMode: "HTML",
    });
  }
  return NextResponse.json({ ok: true });
}

async function handleTextMessage(
  msg: TgMessage & { from: TgUser },
) {
  const text = msg.text?.trim() ?? "";
  const fromId = msg.from.id.toString();
  const admin = adminClient();

  const { data: tgUser } = await admin
    .from("users")
    .select("id, org_id, name")
    .eq("telegram_user_id", fromId)
    .eq("is_active", true)
    .maybeSingle();
  if (!tgUser) return NextResponse.json({ ok: true });

  // Look for pending cashhub reject (within 10 min)
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: pendingRows } = await admin
    .from("audit_logs")
    .select("id, resource_id, diff, created_at")
    .eq("user_id", tgUser.id)
    .eq("resource_type", "tg_pending_reject")
    .gte("created_at", tenMinAgo)
    .order("created_at", { ascending: false })
    .limit(1);
  const pending = pendingRows?.[0];

  if (pending && text && !text.startsWith("/")) {
    const reportId = pending.resource_id as string;
    const diff = pending.diff as
      | { new?: { chatId?: number; messageId?: number; branchCode?: string; reportDate?: string } }
      | null;
    const now = new Date().toISOString();

    const { data: report } = await admin
      .from("daily_reports")
      .select("status, branch_id")
      .eq("id", reportId)
      .maybeSingle();
    if (!report || report.status !== "submitted") {
      await sendTelegramMessage({
        chatId: msg.chat.id,
        text: "รายงานนี้ไม่อยู่ในสถานะรออนุมัติแล้ว",
      });
      return NextResponse.json({ ok: true });
    }

    await admin
      .from("daily_reports")
      .update({
        status: "rejected",
        rejected_reason: text,
        updated_at: now,
      })
      .eq("id", reportId);
    await audit({
      orgId: tgUser.org_id,
      userId: tgUser.id,
      action: "REJECT_REPORT",
      resourceType: "daily_report",
      resourceId: reportId,
      diff: { new: { status: "rejected", reason: text, via: "telegram" } },
    });

    // Mark the pending audit row as resolved by inserting a follow-up (we never delete audit)
    await audit({
      orgId: tgUser.org_id,
      userId: tgUser.id,
      action: "REJECT_REPORT",
      resourceType: "tg_pending_reject_resolved",
      resourceId: reportId,
      diff: { new: { resolved: true } },
    });

    const chatId = diff?.new?.chatId ?? msg.chat.id;
    const messageId = diff?.new?.messageId;
    if (messageId) {
      await editTelegramMessage({
        chatId,
        messageId,
        text: buildRejectedAcknowledgement({
          branchCode: diff?.new?.branchCode ?? "—",
          rejectedByName: tgUser.name,
          reportDate: diff?.new?.reportDate ?? "—",
          reason: text,
          rejectedAtTH: formatInTimeZone(now, TZ, "HH:mm"),
        }),
        parseMode: "HTML",
      });
    }
    await sendTelegramMessage({
      chatId: msg.chat.id,
      text: `❌ ปฏิเสธรายงาน ${htmlEscape(diff?.new?.branchCode ?? "—")} เรียบร้อย`,
      parseMode: "HTML",
    });
    return NextResponse.json({ ok: true });
  }

  if (text.startsWith("/start")) {
    await sendTelegramMessage({
      chatId: msg.chat.id,
      text: `สวัสดี ${tgUser.name} 👋\nบัญชีนี้ผูกกับ Pooilgroup แล้ว — รอรับแจ้งเตือนรายงานได้เลย`,
    });
  }
  return NextResponse.json({ ok: true });
}

async function handleRegisterCallback(
  cq: TgCallbackQuery,
  action: "approve" | "reject",
  requestId: string,
) {
  const admin = adminClient();
  const reviewerName = [cq.from.first_name, cq.from.last_name]
    .filter(Boolean)
    .join(" ") || cq.from.username || `tg:${cq.from.id}`;

  // Fetch the request
  const { data: request } = await admin
    .from("register_requests")
    .select(
      "id, name, phone, email, branch_id, requested_role, notes, status, org_id",
    )
    .eq("id", requestId)
    .maybeSingle();

  if (!request) {
    await answerCallbackQuery({
      callbackQueryId: cq.id,
      text: "ไม่พบคำขอนี้",
      showAlert: true,
    });
    return NextResponse.json({ ok: true });
  }

  if (request.status !== "pending") {
    await answerCallbackQuery({
      callbackQueryId: cq.id,
      text: `คำขอนี้ ${request.status === "approved" ? "อนุมัติ" : "ปฏิเสธ"}แล้ว`,
      showAlert: true,
    });
    return NextResponse.json({ ok: true });
  }

  // Extract employee_code from notes (format: "[EMP: XXX] ...")
  const empMatch = (request.notes ?? "").match(/^\[EMP:\s*([^\]]+)\]/);
  const employeeCode = empMatch ? empMatch[1].trim() : null;

  if (action === "reject") {
    await admin
      .from("register_requests")
      .update({
        status: "rejected",
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", requestId);

    await audit({
      orgId: POOILGROUP_ORG_ID,
      userId: null,
      action: "REJECT_USER_REQUEST",
      resourceType: "register_request",
      resourceId: requestId,
      diff: { new: { reviewer: reviewerName, via: "telegram" } },
    });

    if (cq.message) {
      const newText = renderResolvedMessage(
        request.name,
        request.phone,
        employeeCode,
        request.requested_role,
        "rejected",
        reviewerName,
      );
      await editTelegramMessage({
        chatId: cq.message.chat.id,
        messageId: cq.message.message_id,
        text: newText,
      });
    }

    await answerCallbackQuery({
      callbackQueryId: cq.id,
      text: "ปฏิเสธแล้ว",
    });
    return NextResponse.json({ ok: true });
  }

  // approve flow — does NOT auto-create user. Marks request approved + notifies admin to finalize via web.
  // (Auto-creating Supabase Auth user requires email + password, which user hasn't provided.)
  // Admin clicks "ดูในเว็บ" then completes onboarding from /users/requests.
  await admin
    .from("register_requests")
    .update({
      status: "approved",
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  await audit({
    orgId: POOILGROUP_ORG_ID,
    userId: null,
    action: "APPROVE_USER_REQUEST",
    resourceType: "register_request",
    resourceId: requestId,
    diff: {
      new: {
        reviewer: reviewerName,
        via: "telegram",
        employee_code: employeeCode,
      },
    },
  });

  if (cq.message) {
    const newText = renderResolvedMessage(
      request.name,
      request.phone,
      employeeCode,
      request.requested_role,
      "approved",
      reviewerName,
    );
    await editTelegramMessage({
      chatId: cq.message.chat.id,
      messageId: cq.message.message_id,
      text: newText,
    });
  }

  await answerCallbackQuery({
    callbackQueryId: cq.id,
    text: "อนุมัติแล้ว · ตั้งบัญชีต่อในเว็บ",
  });

  return NextResponse.json({ ok: true });
}

function renderResolvedMessage(
  name: string,
  phone: string,
  employeeCode: string | null,
  role: string,
  status: "approved" | "rejected",
  reviewer: string,
): string {
  const icon = status === "approved" ? "✅" : "❌";
  const statusLabel = status === "approved" ? "อนุมัติแล้ว" : "ปฏิเสธแล้ว";
  const time = new Date().toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    dateStyle: "short",
    timeStyle: "short",
  });
  return [
    `${icon} <b>${statusLabel}</b>`,
    ``,
    `👤 ${htmlEscape(name)}`,
    `📞 ${htmlEscape(phone)}`,
    employeeCode ? `🪪 <code>${htmlEscape(employeeCode)}</code>` : "",
    `🎭 ${htmlEscape(role)}`,
    ``,
    `<i>โดย ${htmlEscape(reviewer)} · ${htmlEscape(time)}</i>`,
  ]
    .filter(Boolean)
    .join("\n");
}

// GET handler for Telegram webhook ping/health
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "Pooilgroup Telegram webhook",
    handlers: ["register:approve", "register:reject"],
  });
}
