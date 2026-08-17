import { FileText, Pencil, Trash2, Receipt, Banknote, Percent, History as HistoryIcon } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { userIsModuleAdmin } from "@/lib/auth/module-access";
import { adminClient } from "@/lib/db/server";
import { RsPage, RsHeader, RsCard, RsBackLink } from "@/components/rentspace/ui";
import { getBill } from "@/lib/rentspace/data";
import { getBillHistory, type BillHistoryEntry } from "@/lib/rentspace/history";
import { formatBaht, periodLabel } from "@/lib/rentspace/format";
import { bkkDateTime } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

const ACTION_META: Record<string, { label: string; Icon: typeof FileText; tone: string }> = {
  RENTSPACE_BILL_CREATED: { label: "สร้างบิล", Icon: FileText, tone: "var(--rs-info)" },
  RENTSPACE_BILL_UPDATED: { label: "แก้ไขรายการบิล", Icon: Pencil, tone: "var(--rs-pending)" },
  RENTSPACE_BILL_VOIDED: { label: "ลบ/ยกเลิกบิล", Icon: Trash2, tone: "var(--rs-danger)" },
  RENTSPACE_TAX_INVOICE_ISSUED: { label: "ออกใบกำกับภาษี", Icon: Receipt, tone: "var(--rs-brand)" },
  RENTSPACE_PAYMENT_RECORDED: { label: "การชำระเงิน", Icon: Banknote, tone: "var(--rs-ok)" },
};

type ItemSnapshot = { kind: string; label: string; amount: number };

function ItemList({ items, total }: { items: ItemSnapshot[]; total: number }) {
  return (
    <div className="mt-1.5 rounded-lg border text-[12px]" style={{ borderColor: "var(--rs-border)" }}>
      {items.map((it, i) => (
        <div
          key={i}
          className="flex items-center justify-between px-2.5 py-1"
          style={{ borderTop: i ? "1px solid var(--rs-border)" : "none", color: "var(--rs-text-2)" }}
        >
          <span>{it.label}</span>
          <span className="tabular-nums">{formatBaht(it.amount)}</span>
        </div>
      ))}
      <div
        className="flex items-center justify-between px-2.5 py-1 font-semibold"
        style={{ borderTop: "1px solid var(--rs-border)", background: "var(--rs-bg-2)", color: "var(--rs-text)" }}
      >
        <span>รวม</span>
        <span className="tabular-nums">{formatBaht(total)}</span>
      </div>
    </div>
  );
}

function EntryBody({ entry }: { entry: BillHistoryEntry }) {
  const d = entry.diff?.new ?? {};
  switch (entry.action) {
    case "RENTSPACE_BILL_UPDATED": {
      const before = d.before as { total: number; items: ItemSnapshot[] } | undefined;
      const after = d.after as { total: number; items: ItemSnapshot[] } | undefined;
      if (!before || !after) return null;
      return (
        <details className="mt-1">
          <summary className="cursor-pointer text-[12px]" style={{ color: "var(--rs-text-3)" }}>
            {formatBaht(before.total)} → {formatBaht(after.total)} · กดดูรายการ
          </summary>
          <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-[11px] font-semibold" style={{ color: "var(--rs-text-3)" }}>ก่อนแก้</div>
              <ItemList items={before.items} total={before.total} />
            </div>
            <div>
              <div className="mb-1 text-[11px] font-semibold" style={{ color: "var(--rs-text-3)" }}>หลังแก้</div>
              <ItemList items={after.items} total={after.total} />
            </div>
          </div>
        </details>
      );
    }
    case "RENTSPACE_BILL_VOIDED": {
      const items = d.items as ItemSnapshot[] | undefined;
      const total = d.total as number | undefined;
      const batchCount = d.batchCount as number | undefined;
      return (
        <div className="mt-1">
          {batchCount && batchCount > 1 ? (
            <div className="text-[12px]" style={{ color: "var(--rs-text-3)" }}>ลบพร้อมกัน {batchCount} ใบ</div>
          ) : null}
          {items && total !== undefined ? (
            <details className="mt-1">
              <summary className="cursor-pointer text-[12px]" style={{ color: "var(--rs-text-3)" }}>
                รายการที่ถูกลบ ({formatBaht(total)}) · กดดู
              </summary>
              <ItemList items={items} total={total} />
            </details>
          ) : null}
        </div>
      );
    }
    case "RENTSPACE_TAX_INVOICE_ISSUED":
      return (
        <div className="mt-1 text-[12px]" style={{ color: "var(--rs-text-3)" }}>
          เลขที่ {String(d.taxInvoiceNo ?? "—")}
        </div>
      );
    case "RENTSPACE_PAYMENT_RECORDED": {
      const amount = d.amount as number | undefined;
      const label = d.voided ? "ยกเลิกรายการชำระ" : d.rejectTenantSlip ? "ปฏิเสธสลิปผู้เช่า" : d.confirmTenantSlip ? "ยืนยันสลิปผู้เช่า" : "รับชำระ";
      return (
        <div className="mt-1 text-[12px]" style={{ color: "var(--rs-text-3)" }}>
          {label}{amount !== undefined ? ` · ${formatBaht(amount)}` : ""}
        </div>
      );
    }
    default:
      return null;
  }
}

export default async function BillHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const canView = isAdminTier(session.user.role) || (await userIsModuleAdmin(session.user, "rentspace"));
  if (!canView) {
    return (
      <RsPage>
        <RsCard className="p-6 text-center">
          <span className="text-sm" style={{ color: "var(--rs-text-2)" }}>ไม่มีสิทธิ์ดูประวัติหน้านี้</span>
        </RsCard>
      </RsPage>
    );
  }

  const [bill, history] = await Promise.all([
    getBill(session.user.org_id, id),
    getBillHistory(session.user.org_id, id),
  ]);

  // สังเคราะห์เหตุการณ์ "สร้างบิล" จากตัวแถวบิลเอง — บิลที่ออกผ่านปุ่ม "ออกบิลทั้งโครงการ/รายห้อง"
  // (bulk) ไม่มี audit entry ต่อใบ (แค่สรุประดับโครงการ) แต่ createdAt/createdBy มีอยู่แล้วเสมอ.
  let entries = history;
  const hasCreatedEntry = history.some((h) => h.action === "RENTSPACE_BILL_CREATED");
  if (bill && !hasCreatedEntry) {
    let creatorName: string | null = null;
    if (bill.createdBy) {
      const admin = adminClient();
      const { data } = await admin.from("users").select("name").eq("id", bill.createdBy).maybeSingle();
      creatorName = data?.name ?? null;
    }
    entries = [
      ...history,
      {
        id: "synthetic-created",
        action: "RENTSPACE_BILL_CREATED",
        createdAt: bill.createdAt.toISOString(),
        userName: creatorName,
        diff: null,
      },
    ];
  }
  entries = [...entries].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const headerCtx = bill
    ? { billNo: bill.billNo, unitCode: bill.unit.code, period: bill.period, deleted: false }
    : (() => {
        const voided = history.find((h) => h.action === "RENTSPACE_BILL_VOIDED");
        const d = voided?.diff?.new ?? {};
        return {
          billNo: (d.billNo as string) ?? "—",
          unitCode: (d.unitCode as string) ?? "—",
          period: (d.period as string) ?? "",
          deleted: true,
        };
      })();

  return (
    <RsPage>
      <RsBackLink href={bill ? `/rentspace/bills/${id}` : "/rentspace/bills"} label={bill ? "กลับไปที่บิล" : "กลับรายการบิล"} />
      <RsHeader
        title={`ประวัติบิล ${headerCtx.billNo}`}
        subtitle={`ห้อง ${headerCtx.unitCode}${headerCtx.period ? ` · ${periodLabel(headerCtx.period)}` : ""}`}
      />
      {headerCtx.deleted && (
        <div
          className="rounded-xl px-3.5 py-2.5 text-[13px] font-medium"
          style={{ background: "var(--rs-danger-soft)", color: "var(--rs-danger)" }}
        >
          บิลนี้ถูกลบไปแล้ว — แสดงประวัติที่บันทึกไว้ก่อนลบเท่านั้น
        </div>
      )}
      <RsCard className="p-5">
        {entries.length === 0 ? (
          <div className="py-8 text-center text-sm flex flex-col items-center gap-2" style={{ color: "var(--rs-text-3)" }}>
            <HistoryIcon className="h-6 w-6" />
            ไม่พบประวัติของบิลนี้
          </div>
        ) : (
          <div className="space-y-4">
            {entries.map((e) => {
              const meta = ACTION_META[e.action] ?? { label: e.action, Icon: FileText, tone: "var(--rs-text-3)" };
              const Icon = meta.Icon;
              return (
                <div key={e.id} className="flex gap-3">
                  <div
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                    style={{ background: "var(--rs-bg-2)" }}
                  >
                    <Icon className="h-3.5 w-3.5" style={{ color: meta.tone }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-[13px] font-semibold" style={{ color: "var(--rs-text)" }}>
                        {meta.label}
                      </span>
                      <span className="text-[11.5px]" style={{ color: "var(--rs-text-3)" }}>
                        {bkkDateTime(e.createdAt)}
                        {e.userName ? ` · ${e.userName}` : ""}
                      </span>
                    </div>
                    <EntryBody entry={e} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </RsCard>
    </RsPage>
  );
}
