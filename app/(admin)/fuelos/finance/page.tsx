import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, atLeast } from "@/lib/fuelos/auth";
import { PageHeader } from "@/components/fuelos/ui/page-header";
import { cn } from "@/lib/fuelos/utils/cn";
import {
  listCredit,
  listPayments,
  listCheques,
  listCustomerOptions,
  getFinanceSummary,
} from "@/lib/fuelos/finance-data";
import { CreditTable } from "./credit-table";
import { PaymentsPanel } from "./payments-panel";
import { ChequesPanel } from "./cheques-panel";

type Tab = "credit" | "payments" | "cheques";

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireUser();
  // หน้าการเงิน = เฉพาะฝ่ายการเงินขึ้นไป (FINANCE ↑) — คนอื่นเด้งกลับ dashboard
  if (!atLeast(user.role, "FINANCE")) redirect("/fuelos/dashboard");

  const sp = await searchParams;
  const tab = (["credit", "payments", "cheques"].includes(sp.tab ?? "")
    ? sp.tab
    : "credit") as Tab;

  const summary = await getFinanceSummary(user.orgId);

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: "credit", label: "วงเงินเครดิต" },
    { key: "payments", label: "รับชำระ", badge: summary.pendingPayments },
    { key: "cheques", label: "เช็ค", badge: summary.pendingCheques },
  ];

  return (
    <div>
      <PageHeader
        title="การเงิน / เครดิต"
        subtitle="วงเงินลูกค้า · ยืนยันยอดเข้า · เช็ครับเข้า"
      />

      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-0.5">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/fuelos/finance?tab=${t.key}`}
            className={cn(
              "px-3.5 h-9 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 shrink-0",
              tab === t.key
                ? "bg-brand-600 text-white"
                : "bg-surface border border-border text-zinc-600",
            )}
          >
            {t.label}
            {t.badge ? (
              <span
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded-full tabular-nums",
                  tab === t.key ? "bg-white/20 text-white" : "bg-warning/15 text-warning",
                )}
              >
                {t.badge}
              </span>
            ) : null}
          </Link>
        ))}
      </div>

      {tab === "credit" && <CreditTable rows={await listCredit(user.orgId)} />}
      {tab === "payments" && (
        <PaymentsPanel
          payments={await listPayments(user.orgId)}
          customers={await listCustomerOptions(user.orgId)}
        />
      )}
      {tab === "cheques" && (
        <ChequesPanel
          cheques={await listCheques(user.orgId)}
          customers={await listCustomerOptions(user.orgId)}
        />
      )}
    </div>
  );
}
