// Cron — 07:00 BKK Morning Brief to all org admins via Telegram
// Auth: Bearer ${CRON_SECRET}

import { NextResponse, type NextRequest } from "next/server";
import { adminClient } from "@/lib/db/server";
import { sendTelegramMessage } from "@/lib/telegram/send";
import { buildMorningBrief } from "@/lib/telegram/messages";
import { getBaseUrl } from "@/lib/utils/base-url";
import { subDays, addDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { BUSINESS_TYPES } from "@/constants/business-types";
import { loadBranches, loadReports, indexBranches } from "@/lib/cashhub/data";
import { prisma } from "@/lib/prisma";
import {
  formatExpiryAlert,
  type ExpiryDocItem,
} from "@/lib/docuflow/telegram-alerts";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

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

async function run() {
  const admin = adminClient();
  const now = new Date();
  const yesterday = formatInTimeZone(subDays(now, 1), TZ, "yyyy-MM-dd");
  const dayBefore = formatInTimeZone(subDays(now, 2), TZ, "yyyy-MM-dd");

  const { data: orgs } = await admin
    .from("organizations")
    .select("id, name")
    .eq("is_active", true);
  if (!orgs) return NextResponse.json({ ok: true, sent: 0 });

  let sent = 0;
  for (const org of orgs) {
    // All reads through the canonical loader.
    const branches = await loadBranches(org.id, { activeOnly: true });
    const branchById = indexBranches(branches);

    const yReports = await loadReports(org.id, {
      dateFrom: yesterday,
      dateTo: yesterday,
      statuses: ["approved"],
    });
    const dReports = await loadReports(org.id, {
      dateFrom: dayBefore,
      dateTo: dayBefore,
      statuses: ["approved"],
    });
    const pendingRows = await loadReports(org.id, {
      statuses: ["submitted"],
    });

    const yTotal = yReports.reduce(
      (s, r) => s + Number(r.total_sales || 0),
      0,
    );
    const dTotal = dReports.reduce(
      (s, r) => s + Number(r.total_sales || 0),
      0,
    );
    const vsPrev = dTotal > 0 ? ((yTotal - dTotal) / dTotal) * 100 : null;

    // Top 3 branches yesterday
    const byBranch = new Map<string, { code: string; emoji: string; total: number }>();
    for (const r of yReports) {
      const id = r.branch_id;
      const b = branchById.get(id);
      const code = b?.code ?? "—";
      const emoji = BUSINESS_TYPES[b?.business_type ?? ""]?.emoji ?? "🏢";
      const cur = byBranch.get(id) ?? { code, emoji, total: 0 };
      cur.total += Number(r.total_sales || 0);
      byBranch.set(id, cur);
    }
    const topBranches = Array.from(byBranch.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);

    // Alerts: branches that didn't submit yesterday
    const submittedIds = new Set(yReports.map((r) => r.branch_id));
    const missing = branches.filter((b) => !submittedIds.has(b.id));
    const alertLines = missing.slice(0, 5).map((b) => `${b.code} — ไม่กรอกเมื่อวาน`);

    let message = buildMorningBrief({
      yesterdayDate: yesterday,
      yesterdayTotal: yTotal,
      vsPrevDayPct: vsPrev,
      topBranches,
      pendingCount: (pendingRows ?? []).length,
      alertLines,
      webBaseUrl: getBaseUrl(),
    });

    // ────────────────────────────────────────────────────────────────
    // DocuFlow expiry alerts — append to morning brief if any rows exist.
    // Guard: only append when there are critical (≤7d) or urgent (≤30d) docs.
    // Watch tier (≤90d) shown only when we already have crit/urgent (avoid noise).
    // Failure here must NOT break morning-brief — wrapped in try/catch.
    // ────────────────────────────────────────────────────────────────
    try {
      const todayDate = new Date(now);
      todayDate.setHours(0, 0, 0, 0);
      const cutoff90 = addDays(todayDate, 90);

      const expiringRenewals = await prisma.documentRenewal.findMany({
        where: {
          orgId: org.id,
          expiryDate: { lte: cutoff90 },
          status: { not: "renewed" },
        },
        include: {
          document: {
            include: {
              ownership: true,
            },
          },
        },
      });

      // Pull branch labels in one query (no DocumentOwnership.branch relation)
      const ownerBranchIds = new Set<string>();
      for (const r of expiringRenewals) {
        for (const own of r.document.ownership) {
          if (own.branchId) ownerBranchIds.add(own.branchId);
        }
      }
      const branchById = new Map<string, { code: string; name: string }>();
      if (ownerBranchIds.size > 0) {
        const ownerBranches = await prisma.branch.findMany({
          where: {
            orgId: org.id,
            id: { in: Array.from(ownerBranchIds) },
          },
          select: { id: true, code: true, name: true },
        });
        for (const b of ownerBranches) {
          branchById.set(b.id, { code: b.code, name: b.name });
        }
      }

      const critical: ExpiryDocItem[] = [];
      const urgent: ExpiryDocItem[] = [];
      const watch: ExpiryDocItem[] = [];

      for (const r of expiringRenewals) {
        const exp = new Date(r.expiryDate);
        exp.setHours(0, 0, 0, 0);
        const days = Math.floor(
          (exp.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        const expiryStr = exp.toISOString().slice(0, 10);
        // Owner label — best-effort: branch code/name → "Org" fallback
        const own = r.document.ownership[0];
        let owner = org.name || "Pooilgroup";
        if (own?.branchId) {
          const b = branchById.get(own.branchId);
          if (b) owner = `${b.code} · ${b.name}`;
        }
        const item: ExpiryDocItem = {
          name: r.document.name,
          owner,
          expiryDate: expiryStr,
          daysToExpiry: days,
        };
        if (days <= 7) critical.push(item);
        else if (days <= 30) urgent.push(item);
        else if (days <= 90) watch.push(item);
      }

      // Sort each tier oldest-expiry-first (most urgent at top)
      critical.sort((a, b) => a.daysToExpiry - b.daysToExpiry);
      urgent.sort((a, b) => a.daysToExpiry - b.daysToExpiry);
      watch.sort((a, b) => a.daysToExpiry - b.daysToExpiry);

      if (critical.length > 0 || urgent.length > 0) {
        const expiryBlock = formatExpiryAlert(
          org.name,
          critical,
          urgent,
          watch,
        );
        message = `${message}\n${expiryBlock}`;
      }
    } catch (err) {
      console.error("[morning-brief] expiry alert append failed", err);
      // Continue — original morning brief still ships.
    }

    // Send to org admins with linked Telegram
    const { data: admins } = await admin
      .from("users")
      .select("telegram_chat_id, name")
      .eq("org_id", org.id)
      .in("role", ["super_admin", "org_admin", "admin"])
      .eq("is_active", true);
    for (const a of admins ?? []) {
      if (a.telegram_chat_id) {
        const r = await sendTelegramMessage({
          chatId: a.telegram_chat_id as string,
          text: message,
          parseMode: "HTML",
        });
        if (r) sent += 1;
      }
    }
  }
  return NextResponse.json({ ok: true, sent });
}
