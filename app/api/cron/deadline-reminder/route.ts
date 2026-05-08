// Cron — Deadline Reminder (ทุก 30 นาที)
// ────────────────────────────────────────────────────────────────────
// Spec source: ดีเทลv1/CASHHUB.md + CORE_SYSTEM.md (Branch.report_deadline)
//
// Logic:
//  - แต่ละสาขามี report_deadline ของตัวเอง (HH:mm, default 21:00)
//  - ตรวจ "เวลาปัจจุบัน + 60 นาที" → ตรงกับ deadline ของสาขาไหน → reminder รอบ 1
//  - ตรวจ "เวลาปัจจุบัน + 30 นาที" → ตรงกับ deadline ของสาขาไหน → reminder รอบ 2 (urgent)
//  - ใช้ tolerance ±5 นาที กันกรณี cron ยิงคลาดเวลา
//  - ส่ง Telegram → LINE Group (ถ้ามี) หรือ ผู้จัดการสาขา (Telegram chat)
//  - หลัง deadline → ปล่อยให้ evening-check / access-review จัดการ flag missing
//  - Idempotent: เช็ค audit_logs ว่า slot นี้เคยส่งหรือยังในวันนี้ (กันส่งซ้ำ)
//
// Auth: Bearer ${CRON_SECRET}
// ────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { adminClient } from "@/lib/db/server";
import { sendTelegramMessage, htmlEscape } from "@/lib/telegram/send";
import { loadBranches, loadReports } from "@/lib/cashhub/data";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { formatInTimeZone } from "date-fns-tz";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

// Reminder slots: minutes before deadline + display label + audit action key
const REMINDER_SLOTS = [
  {
    minutesBefore: 60,
    label: "60",
    action: "DEADLINE_REMINDER_T60",
    urgency: "warning" as const,
  },
  {
    minutesBefore: 30,
    label: "30",
    action: "DEADLINE_REMINDER_T30",
    urgency: "danger" as const,
  },
];

const TOLERANCE_MINUTES = 5; // cron may fire ±5 min late/early

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run();
}

export async function POST(req: NextRequest) {
  return GET(req);
}

interface BranchTargetInfo {
  id: string;
  code: string;
  name: string;
  business_type: string;
  line_group_id: string | null;
  manager_id: string | null;
  deadline: string; // HH:mm
}

/** Parse "HH:mm" → minutes since midnight (in TZ-local terms). Returns null if invalid. */
function parseHmToMinutes(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = parseInt(m[1]!, 10);
  const min = parseInt(m[2]!, 10);
  if (isNaN(h) || isNaN(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return null;
  }
  return h * 60 + min;
}

async function run() {
  const admin = adminClient();
  const now = new Date();
  const today = formatInTimeZone(now, TZ, "yyyy-MM-dd");
  const nowMinutes =
    parseInt(formatInTimeZone(now, TZ, "H"), 10) * 60 +
    parseInt(formatInTimeZone(now, TZ, "m"), 10);

  const { data: orgs } = await admin
    .from("organizations")
    .select("id, name")
    .eq("is_active", true);
  if (!orgs) return NextResponse.json({ ok: true, sent: 0, slots: [] });

  let totalSent = 0;
  const slotsTriggered: Array<{
    orgId: string;
    slot: string;
    branches: string[];
  }> = [];

  for (const org of orgs) {
    const branches = await loadBranches(org.id, { activeOnly: true });
    if (branches.length === 0) continue;

    // Reports submitted today (any status — submitted/approved counts as "ส่งแล้ว")
    const reportsToday = await loadReports(org.id, {
      dateFrom: today,
      dateTo: today,
      statuses: ["submitted", "approved", "rejected", "draft"],
    });
    const submittedBranchIds = new Set(reportsToday.map((r) => r.branch_id));

    for (const slot of REMINDER_SLOTS) {
      const targetMinutes = nowMinutes + slot.minutesBefore;

      // Find branches whose deadline falls in [target - tol, target + tol]
      const matching: BranchTargetInfo[] = [];
      for (const b of branches) {
        // Skip branches that already submitted today
        if (submittedBranchIds.has(b.id)) continue;

        const deadline =
          (b.settings as { report_deadline?: string } | null)?.report_deadline;
        // Branch.report_deadline ถูก map เป็น column ใน DB — แต่ data loader
        // ไม่ได้ select มา. Pull from DB directly per branch slot — ใช้ admin
        // อีกครั้งเพื่อ select report_deadline เพิ่ม.
        // อย่างไรก็ตาม performance: query เดียว 1 ครั้งนอก loop ดีกว่า.
        // → เก็บไว้สู่ array ก่อน แล้ว resolve ภายนอก.
        if (deadline) {
          const dmin = parseHmToMinutes(deadline);
          if (dmin === null) continue;
          if (Math.abs(dmin - targetMinutes) <= TOLERANCE_MINUTES) {
            matching.push({
              id: b.id,
              code: b.code,
              name: b.name,
              business_type: b.business_type,
              line_group_id: b.line_group_id,
              manager_id: b.manager_id,
              deadline,
            });
          }
        }
      }

      // settings JSON ไม่มี report_deadline (อยู่ใน column report_deadline)
      // → query เพิ่มถ้า matching ว่าง
      if (matching.length === 0) {
        const branchIds = branches
          .filter((b) => !submittedBranchIds.has(b.id))
          .map((b) => b.id);
        if (branchIds.length === 0) continue;

        const { data: dlRows } = await admin
          .from("branches")
          .select("id, report_deadline")
          .in("id", branchIds);

        for (const row of dlRows ?? []) {
          const deadline =
            (row as { report_deadline?: string }).report_deadline ?? "21:00";
          const dmin = parseHmToMinutes(deadline);
          if (dmin === null) continue;
          if (Math.abs(dmin - targetMinutes) <= TOLERANCE_MINUTES) {
            const b = branches.find((x) => x.id === (row as { id: string }).id);
            if (!b) continue;
            matching.push({
              id: b.id,
              code: b.code,
              name: b.name,
              business_type: b.business_type,
              line_group_id: b.line_group_id,
              manager_id: b.manager_id,
              deadline,
            });
          }
        }
      }

      if (matching.length === 0) continue;

      // Idempotency: ตรวจ audit_logs ว่ารอบ slot นี้ของวันนี้ส่งหรือยัง
      // (resource_type='branch', resource_id=branch_id, action=slot.action, created_at>=today00:00 TZ)
      const todayStartIso = formatInTimeZone(
        now,
        TZ,
        "yyyy-MM-dd'T'00:00:00XXX",
      );
      const { data: alreadySent } = await admin
        .from("audit_logs")
        .select("resource_id")
        .eq("org_id", org.id)
        .eq("action", slot.action)
        .gte("created_at", todayStartIso)
        .in(
          "resource_id",
          matching.map((m) => m.id),
        );
      const sentSet = new Set(
        (alreadySent ?? [])
          .map((r) => (r as { resource_id: string | null }).resource_id)
          .filter((id): id is string => id !== null),
      );

      const toSend = matching.filter((m) => !sentSet.has(m.id));
      if (toSend.length === 0) continue;

      // Resolve manager Telegram chat IDs (if line_group_id missing)
      const managerIds = toSend
        .map((m) => m.manager_id)
        .filter((id): id is string => id !== null);
      const managerById = new Map<string, { telegram_chat_id: string | null; name: string }>();
      if (managerIds.length > 0) {
        const { data: managers } = await admin
          .from("users")
          .select("id, telegram_chat_id, name")
          .in("id", managerIds)
          .eq("is_active", true);
        for (const u of managers ?? []) {
          const row = u as {
            id: string;
            telegram_chat_id: string | null;
            name: string;
          };
          managerById.set(row.id, {
            telegram_chat_id: row.telegram_chat_id,
            name: row.name,
          });
        }
      }

      const slotBranchCodes: string[] = [];
      for (const b of toSend) {
        const emoji = BUSINESS_TYPES[b.business_type]?.emoji ?? "🏢";
        const isUrgent = slot.urgency === "danger";
        const head = isUrgent
          ? "🚨 <b>ด่วน — เหลือ 30 นาที</b>"
          : "⏰ <b>เตือน — เหลือ 1 ชั่วโมง</b>";
        const lines = [
          "━━━━━━━━━━━━━━━━━━━━",
          head,
          "━━━━━━━━━━━━━━━━━━━━",
          `${emoji} <b>${htmlEscape(b.code)}</b> · ${htmlEscape(b.name)}`,
          `📅 ${today} · Deadline ${b.deadline} น.`,
          "",
          `ยังไม่ได้กรอกรายงานวันนี้`,
          isUrgent
            ? "⚠️ ถ้าไม่กรอกก่อน Deadline จะถือเป็น <b>missing report</b>"
            : "กรุณากรอกรายงานก่อนเวลา Deadline",
          "━━━━━━━━━━━━━━━━━━━━",
        ];
        const text = lines.join("\n");

        // Prefer LINE Group → fallback to manager's Telegram chat
        let delivered = false;
        if (b.line_group_id) {
          // Telegram bot ส่ง LINE Group ไม่ได้ — ใช้ Telegram group ID เก็บใน
          // line_group_id field (ตามชื่อ field) กรณีนี้ใช้เป็น chatId Telegram
          // ถ้า org ใช้ LINE จริงต้องเรียก LINE Push (out-of-scope ของ cron นี้)
          const r = await sendTelegramMessage({
            chatId: b.line_group_id,
            text,
            parseMode: "HTML",
          });
          if (r) delivered = true;
        }
        if (!delivered && b.manager_id) {
          const mgr = managerById.get(b.manager_id);
          if (mgr?.telegram_chat_id) {
            const r = await sendTelegramMessage({
              chatId: mgr.telegram_chat_id,
              text,
              parseMode: "HTML",
            });
            if (r) delivered = true;
          }
        }

        if (delivered) {
          totalSent += 1;
          slotBranchCodes.push(b.code);
          // Audit log (per-branch) — ถ้าส่งจริง
          await admin.from("audit_logs").insert({
            id: crypto.randomUUID(),
            org_id: org.id,
            user_id: null,
            action: slot.action,
            resource_type: "branch",
            resource_id: b.id,
            diff: {
              new: {
                slot: slot.label,
                deadline: b.deadline,
                report_date: today,
              },
            },
          });
        }
      }

      if (slotBranchCodes.length > 0) {
        slotsTriggered.push({
          orgId: org.id,
          slot: slot.label,
          branches: slotBranchCodes,
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    sent: totalSent,
    slots: slotsTriggered,
  });
}
