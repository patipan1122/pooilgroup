// Public endpoint — anyone can submit a "want to join" request.
// Hardcoded to Pooilgroup org (single-tenant deployment).
// Sends Telegram notification to admin chat with [Approve] [Reject] inline buttons.
// Admin reviews queue at /users/requests for context.
//
// Rate-limit: 3 requests per phone in last 7 days.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { sendNotificationToMany, getOrgAdminIds } from "@/lib/notifications/send";
import { sendToAdminChat, htmlEscape } from "@/lib/telegram/send";

const POOILGROUP_ORG_ID = "00000000-0000-0000-0000-000000000001";

const Schema = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().regex(/^[0-9-+\s]{9,20}$/, "เบอร์โทรไม่ถูกต้อง"),
  email: z.string().email().optional().or(z.literal("")),
  employeeCode: z
    .string()
    .min(2, "กรุณากรอกรหัสพนักงาน")
    .max(50)
    .regex(/^[A-Za-z0-9-]+$/, "รหัสพนักงานใช้ได้เฉพาะตัวอักษร ตัวเลข และขีด"),
  branchId: z.string().uuid().nullable().optional(),
  requestedRole: z.enum([
    "staff",
    "branch_manager",
    "area_manager",
    "driver",
    "viewer",
  ]),
  notes: z.string().max(500).optional().or(z.literal("")),
});

const ROLE_LABEL: Record<string, string> = {
  staff: "พนักงาน",
  branch_manager: "ผู้จัดการสาขา",
  area_manager: "ผู้จัดการเขต",
  driver: "คนขับ",
  viewer: "ผู้ดู (Read-only)",
};

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const admin = adminClient();

  const ipAddress =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null;

  // Rate limit: 3 requests per phone in last 7 days
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await admin
    .from("register_requests")
    .select("id", { count: "exact", head: true })
    .eq("phone", data.phone)
    .gte("created_at", since);

  if ((recentCount ?? 0) >= 3) {
    return NextResponse.json(
      { error: "ส่งคำขอเกินกำหนด — กรุณาติดต่อ Admin โดยตรง" },
      { status: 429 },
    );
  }

  // Block: employee_code already used by an active user
  const { data: existingUser } = await admin
    .from("users")
    .select("id, name")
    .eq("org_id", POOILGROUP_ORG_ID)
    .eq("employee_code", data.employeeCode)
    .eq("is_active", true)
    .maybeSingle();

  if (existingUser) {
    return NextResponse.json(
      {
        error: `รหัสพนักงาน ${data.employeeCode} ถูกใช้งานแล้ว — ติดต่อ Admin ถ้าคิดว่าผิดพลาด`,
      },
      { status: 409 },
    );
  }

  // Lookup branch info for display in Telegram message
  let branchInfo: { code: string; name: string } | null = null;
  if (data.branchId) {
    const { data: b } = await admin
      .from("branches")
      .select("code, name")
      .eq("id", data.branchId)
      .maybeSingle();
    branchInfo = b ?? null;
  }

  const id = crypto.randomUUID();
  const { error } = await admin.from("register_requests").insert({
    id,
    org_id: POOILGROUP_ORG_ID,
    name: data.name,
    phone: data.phone.trim(),
    email: data.email || null,
    branch_id: data.branchId ?? null,
    requested_role: data.requestedRole,
    notes: data.employeeCode
      ? `[EMP: ${data.employeeCode}] ${data.notes || ""}`.trim()
      : data.notes || null,
    status: "pending",
    ip_address: ipAddress,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await audit({
    orgId: POOILGROUP_ORG_ID,
    userId: null,
    action: "CREATE_USER",
    resourceType: "register_request",
    resourceId: id,
    diff: {
      new: {
        name: data.name,
        phone: data.phone,
        employee_code: data.employeeCode,
        role: data.requestedRole,
      },
    },
    ipAddress: ipAddress ?? undefined,
  });

  // In-app notification to all org admins
  const adminIds = await getOrgAdminIds(POOILGROUP_ORG_ID);
  if (adminIds.length > 0) {
    await sendNotificationToMany(adminIds, {
      orgId: POOILGROUP_ORG_ID,
      type: "info",
      module: "core",
      title: `📥 คำขอเข้าใช้งานใหม่ — ${data.name}`,
      body: `${data.phone} · รหัส ${data.employeeCode} · ${ROLE_LABEL[data.requestedRole] ?? data.requestedRole}${branchInfo ? ` · ${branchInfo.code}` : ""}`,
      link: "/users/requests",
    });
  }

  // Telegram notification with inline approve/reject buttons
  const telegramText = [
    `📥 <b>คำขอสมัครใหม่</b>`,
    ``,
    `👤 <b>${htmlEscape(data.name)}</b>`,
    `📞 ${htmlEscape(data.phone)}`,
    `🪪 รหัสพนักงาน: <code>${htmlEscape(data.employeeCode)}</code>`,
    `🎭 ขอเป็น: <b>${htmlEscape(ROLE_LABEL[data.requestedRole] ?? data.requestedRole)}</b>`,
    branchInfo
      ? `🏢 สาขา: ${htmlEscape(branchInfo.code)} · ${htmlEscape(branchInfo.name)}`
      : `🏢 สาขา: <i>ยังไม่เลือก</i>`,
    data.notes ? `📝 ${htmlEscape(data.notes)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const tgResult = await sendToAdminChat({
    text: telegramText,
    inlineKeyboard: [
      [
        { text: "✅ อนุมัติ", callback_data: `register:approve:${id}` },
        { text: "❌ ปฏิเสธ", callback_data: `register:reject:${id}` },
      ],
      [{ text: "📋 ดูในเว็บ", url: getRequestUrl(id) }],
    ],
  });

  // Save Telegram message_id back to request so we can edit it after approval
  if (tgResult) {
    await admin
      .from("register_requests")
      .update({
        // store as JSON in notes — schema doesn't have telegram_message_id field yet
        // so we tack it onto a separate field if available, otherwise skip
      })
      .eq("id", id);
  }

  return NextResponse.json({ success: true, requestId: id });
}

function getRequestUrl(requestId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base}/users/requests?focus=${requestId}`;
}
