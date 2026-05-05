// Telegram webhook handler — receives callback queries from inline buttons.
// Currently handles: register:approve:{id}, register:reject:{id}
// Future: cashhub:approve:{reportId}, cashhub:reject:{reportId}
//
// Security: validates X-Telegram-Bot-Api-Secret-Token header against TELEGRAM_WEBHOOK_SECRET.
// Idempotency: actions guarded by current status check (no double-approve).

import { NextResponse, type NextRequest } from "next/server";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import {
  answerCallbackQuery,
  editTelegramMessage,
  htmlEscape,
} from "@/lib/telegram/send";

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

  // Unknown callback — silently ack
  await answerCallbackQuery({ callbackQueryId: cq.id });
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
