// CostCtrl alerts — evaluate cost_alert_rule against latest snapshots
// + push LINE to CEO when triggered (respects cooldown_hours).
//
// Reuses ChairOps LINE messaging adapter (already set up in prod).

import { prisma } from "@/lib/prisma";

type LineMessage = { type: "text"; text: string };

async function pushLineToCeo(text: string): Promise<boolean> {
  const token = process.env.CHAIROPS_LINE_CHANNEL_ACCESS_TOKEN;
  const recipient = process.env.COSTCTRL_LINE_USER_ID ?? process.env.CHAIROPS_CEO_LINE_USER_ID;
  if (!token || !recipient) {
    console.warn("[costctrl alerts] missing CHAIROPS_LINE_CHANNEL_ACCESS_TOKEN or COSTCTRL_LINE_USER_ID — alert NOT pushed");
    return false;
  }
  const messages: LineMessage[] = [{ type: "text", text: text.slice(0, 1900) }];
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to: recipient, messages }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[costctrl alerts] LINE push failed", res.status, body.slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[costctrl alerts] LINE push error", (e as Error).message);
    return false;
  }
}

function firstOfMonth(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function pickBudgetForMonth(budgetMonthly: unknown, month: Date): number {
  if (!budgetMonthly || typeof budgetMonthly !== "object" || Array.isArray(budgetMonthly)) return 0;
  const obj = budgetMonthly as Record<string, unknown>;
  const ym = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`;
  const v = obj[ym] ?? obj["default"];
  return typeof v === "number" ? v : Number(v ?? 0) || 0;
}

export async function evaluateAlerts(): Promise<number> {
  const month = firstOfMonth();
  const rules = await prisma.costAlertRule.findMany({
    where: { enabled: true },
    include: {
      provider: true,
      events: { orderBy: { triggeredAt: "desc" }, take: 1 },
    },
  });

  let triggered = 0;
  for (const rule of rules) {
    // Find latest snapshot for this metric in current month
    const snap = await prisma.costSnapshot.findFirst({
      where: { providerId: rule.providerId, periodMonth: month, metric: rule.metric },
      orderBy: { capturedAt: "desc" },
    });
    if (!snap) continue;

    let thresholdValue = 0;
    let observed = Number(rule.metric === "cost_usd" ? snap.costUsd : snap.value);

    if (rule.thresholdPct != null) {
      const budget = pickBudgetForMonth(rule.provider.budgetMonthly, month);
      thresholdValue = budget * (Number(rule.thresholdPct) / 100);
    } else if (rule.thresholdAbs != null) {
      thresholdValue = Number(rule.thresholdAbs);
    } else {
      continue;
    }

    if (thresholdValue <= 0 || observed < thresholdValue) continue;

    // Cooldown — skip if last event triggered within cooldown_hours
    const lastEvt = rule.events[0];
    if (lastEvt) {
      const ageMs = Date.now() - new Date(lastEvt.triggeredAt).getTime();
      if (ageMs < rule.cooldownHours * 3600_000) continue;
    }

    const pct = thresholdValue > 0 ? Math.round((observed / thresholdValue) * 100) : 0;
    const msg = `⚠️ CostCtrl · ${rule.provider.displayName}\n` +
      `${rule.metric} = ${observed.toFixed(2)} (เกิน threshold ${thresholdValue.toFixed(2)} · ${pct}%)\n` +
      `เดือนนี้: ${month.toISOString().slice(0, 7)}\n` +
      `ดูรายละเอียดที่ /costctrl/providers/${rule.provider.slug}`;

    const event = await prisma.costAlertEvent.create({
      data: {
        ruleId: rule.id,
        observedValue: observed,
        thresholdValue,
        message: msg,
      },
    });
    const pushed = await pushLineToCeo(msg);
    if (pushed) {
      await prisma.costAlertEvent.update({
        where: { id: event.id },
        data: { notifiedAt: new Date() },
      });
    }
    triggered++;
  }
  return triggered;
}
