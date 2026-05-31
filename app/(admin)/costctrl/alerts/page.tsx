// CostCtrl · Alerts · /costctrl/alerts
// 3-tab page: rules CRUD · monthly budgets · API credentials (encrypted).

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { listAlertRules, listRecentAlertEvents, listCredentials } from "@/lib/costctrl/data";
import { AlertsPanels } from "./_components/alerts-panels";

export const dynamic = "force-dynamic";

export default async function CostCtrlAlertsPage() {
  const [providers, rules, events, creds] = await Promise.all([
    prisma.costProvider.findMany({ orderBy: { slug: "asc" } }),
    listAlertRules(),
    listRecentAlertEvents(30),
    listCredentials(),
  ]);

  const month = new Date();
  const ymKey = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`;

  const providerLites = providers.map((p) => {
    const map = (p.budgetMonthly as Record<string, number>) ?? {};
    const budgetThisMonth = map[ymKey] ?? map["default"] ?? 0;
    return {
      id: p.id,
      slug: p.slug,
      displayName: p.displayName,
      enabled: p.enabled,
      budgetThisMonth,
      budgetDefault: map["default"] ?? 0,
    };
  });

  const ruleLites = rules.map((r) => ({
    id: r.id,
    providerSlug: r.provider.slug,
    providerName: r.provider.displayName,
    metric: r.metric,
    thresholdPct: r.thresholdPct != null ? Number(r.thresholdPct) : null,
    thresholdAbs: r.thresholdAbs != null ? Number(r.thresholdAbs) : null,
    channel: r.channel,
    cooldownHours: r.cooldownHours,
    enabled: r.enabled,
  }));

  const credLites = creds.map((c) => ({
    id: c.id,
    providerSlug: c.provider.slug,
    providerName: c.provider.displayName,
    label: c.label,
    scope: c.scope,
    lastUsedAt: c.lastUsedAt ? new Date(c.lastUsedAt).toLocaleString("th-TH") : null,
    lastError: c.lastError,
  }));

  const eventLites = events.map((e) => ({
    id: e.id,
    providerName: e.rule.provider.displayName,
    metric: e.rule.metric,
    triggeredAt: new Date(e.triggeredAt).toLocaleString("th-TH"),
    observedValue: Number(e.observedValue),
    thresholdValue: Number(e.thresholdValue),
    message: e.message,
    notified: !!e.notifiedAt,
  }));

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8 max-w-6xl mx-auto space-y-6">
      <header>
        <Link href="/costctrl" className="text-xs text-blue-600 hover:underline">← กลับภาพรวม</Link>
        <h1 className="text-2xl font-semibold text-zinc-900 mt-1">เตือน + Budget + คีย์</h1>
        <p className="text-sm text-zinc-500">ตั้งค่ารู้ก่อนเกิน · เพิ่ม API key เพื่อให้ sync ดึงตัวเลขได้</p>
      </header>

      <AlertsPanels
        providers={providerLites}
        rules={ruleLites}
        creds={credLites}
        events={eventLites}
        ymKey={ymKey}
      />
    </div>
  );
}
