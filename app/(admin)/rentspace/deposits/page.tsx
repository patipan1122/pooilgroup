import Link from "next/link";
import { Building2, Wallet2 } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { RsPage, RsHeader, RsKpi, RsEmpty, RsCard, RsBackLink, RsMobileCard, RsField } from "@/components/rentspace/ui";
import {
  formatBaht,
  thaiDateLong,
  tenantDisplayName,
  toNum,
  PAYMENT_METHODS,
} from "@/lib/rentspace/format";
import { listDeposits } from "@/lib/rentspace/data";

export const dynamic = "force-dynamic";

// เก็บ = บวกเข้ายอดถือครอง · คืน/หัก/ริบ = ลดยอดถือครอง
const KIND: Record<string, { label: string; color: string; soft: string; sign: 1 | -1 }> = {
  collect: { label: "เก็บ", color: "var(--rs-ok)", soft: "var(--rs-ok-soft)", sign: 1 },
  refund: { label: "คืน", color: "var(--rs-info)", soft: "var(--rs-info-soft)", sign: -1 },
  deduct: { label: "หัก", color: "var(--rs-pending)", soft: "var(--rs-pending-soft)", sign: -1 },
  forfeit: { label: "ริบ", color: "var(--rs-danger)", soft: "var(--rs-danger-soft)", sign: -1 },
};

function KindBadge({ kind }: { kind: string }) {
  const k = KIND[kind] ?? { label: kind, color: "var(--rs-text-3)", soft: "var(--rs-bg-3)", sign: 1 as const };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold"
      style={{ background: k.soft, color: k.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: k.color }} />
      {k.label}
    </span>
  );
}

export default async function DepositsPage() {
  const session = await requireSession();
  const deposits = await listDeposits(session.user.org_id);

  // สรุปยอดเงินประกัน: ถือครอง = เก็บ − (คืน + หัก + ริบ)
  let collected = 0;
  let releasedTotal = 0; // คืน + หัก + ริบ
  for (const d of deposits) {
    const amt = toNum(d.amountThb);
    if (d.kind === "collect") collected += amt;
    else releasedTotal += amt;
  }
  const held = collected - releasedTotal;

  return (
    <RsPage>
      <RsBackLink href="/rentspace" label="กลับหน้าหลัก" />
      <RsHeader title="เงินประกัน" subtitle="ภาพรวมเงินประกันถือครองทุกห้องในโครงการ" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <RsKpi
          label="เงินประกันถือครองรวม"
          value={formatBaht(held)}
          tone={held > 0 ? "ok" : undefined}
          hint="เก็บ − คืน/หัก/ริบ"
        />
        <RsKpi label="เก็บเข้าทั้งหมด" value={formatBaht(collected)} hint="ยอดเก็บสะสม" />
        <RsKpi
          label="คืน / หักทั้งหมด"
          value={formatBaht(releasedTotal)}
          tone={releasedTotal > 0 ? "pending" : undefined}
          hint="คืน + หัก + ริบ"
        />
      </div>

      <RsCard className="overflow-hidden">
        <div className="px-5 pt-4 pb-2 flex items-center gap-2">
          <Wallet2 className="h-4 w-4" style={{ color: "var(--rs-text-2)" }} />
          <h2 className="font-bold" style={{ color: "var(--rs-text)" }}>
            ความเคลื่อนไหวเงินประกัน
          </h2>
        </div>
        {deposits.length === 0 ? (
          <RsEmpty
            icon="🔒"
            title="ยังไม่มีรายการเงินประกัน"
            hint="เมื่อบันทึกเก็บ/คืน/หักเงินประกันจากหน้าสัญญา รายการจะมาแสดงที่นี่"
          />
        ) : (
          <>
          {/* desktop table */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="rs-table w-full text-sm">
              <thead>
                <tr style={{ color: "var(--rs-text-2)" }} className="text-left text-[12.5px]">
                  <th className="px-4 py-2.5 font-semibold">วันที่</th>
                  <th className="px-4 py-2.5 font-semibold">ห้อง / ผู้เช่า</th>
                  <th className="px-4 py-2.5 font-semibold">ประเภท</th>
                  <th className="px-4 py-2.5 font-semibold text-right">จำนวน</th>
                  <th className="px-4 py-2.5 font-semibold">วิธี</th>
                  <th className="px-4 py-2.5 font-semibold text-center">สลิป</th>
                  <th className="px-4 py-2.5 font-semibold">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {deposits.map((d) => {
                  const k = KIND[d.kind] ?? { sign: 1 as const, color: "var(--rs-text)" };
                  const amt = toNum(d.amountThb);
                  const signed = `${k.sign < 0 ? "−" : "+"} ${formatBaht(amt)}`;
                  return (
                    <tr
                      key={d.id}
                      className="border-t hover:bg-[var(--rs-bg-2)] transition"
                      style={{ borderColor: "var(--rs-border)" }}
                    >
                      <td className="px-4 py-3 text-[12.5px]" style={{ color: "var(--rs-text-2)" }}>
                        {thaiDateLong(d.occurredOn)}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/rentspace/contracts/${d.contractId}`}
                          className="font-semibold inline-flex items-center gap-1.5"
                          style={{ color: "var(--rs-brand)" }}
                        >
                          <Building2 className="h-3.5 w-3.5" /> {d.contract.unit.code}
                        </Link>
                        <span style={{ color: "var(--rs-text-3)" }}>
                          {" · "}
                          {tenantDisplayName(d.contract.tenant)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <KindBadge kind={d.kind} />
                      </td>
                      <td
                        className="px-4 py-3 text-right tabular-nums font-semibold"
                        style={{ color: k.color }}
                      >
                        {signed}
                      </td>
                      <td className="px-4 py-3 text-[12.5px]" style={{ color: "var(--rs-text-2)" }}>
                        {d.method ? PAYMENT_METHODS[d.method] ?? d.method : "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {d.slipUrl ? (
                          <a
                            href={d.slipUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[12.5px]"
                            style={{ color: "var(--rs-brand)" }}
                          >
                            ดู
                          </a>
                        ) : (
                          <span style={{ color: "var(--rs-text-3)" }}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[12.5px]" style={{ color: "var(--rs-text-2)" }}>
                        {d.note || <span style={{ color: "var(--rs-text-3)" }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* mobile card stack */}
          <div className="lg:hidden p-3 space-y-2">
            {deposits.map((d) => {
              const k = KIND[d.kind] ?? { sign: 1 as const, color: "var(--rs-text)" };
              const amt = toNum(d.amountThb);
              const signed = `${k.sign < 0 ? "−" : "+"} ${formatBaht(amt)}`;
              return (
                <RsMobileCard
                  key={d.id}
                  href={`/rentspace/contracts/${d.contractId}`}
                  title={
                    <span className="flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--rs-brand)" }} aria-hidden="true" />
                      <span className="truncate">{d.contract.unit.code}</span>
                      <span className="truncate text-[12.5px] font-normal" style={{ color: "var(--rs-text-3)" }}>
                        · {tenantDisplayName(d.contract.tenant)}
                      </span>
                    </span>
                  }
                  titleRight={
                    <div className="space-y-1">
                      <KindBadge kind={d.kind} />
                      <div className="text-[15px] font-bold tabular-nums" style={{ color: k.color }}>
                        {signed}
                      </div>
                    </div>
                  }
                >
                  <RsField label="วันที่" value={thaiDateLong(d.occurredOn)} />
                  <RsField
                    label="วิธี"
                    value={d.method ? PAYMENT_METHODS[d.method] ?? d.method : "—"}
                    align="right"
                  />
                  {d.slipUrl ? (
                    <RsField label="สลิป" value="มีสลิป (เปิดในหน้าสัญญา)" full />
                  ) : null}
                  {d.note ? <RsField label="หมายเหตุ" value={d.note} full /> : null}
                </RsMobileCard>
              );
            })}
          </div>
          </>
        )}
      </RsCard>
    </RsPage>
  );
}
