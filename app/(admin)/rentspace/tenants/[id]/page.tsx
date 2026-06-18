import Link from "next/link";
import { notFound } from "next/navigation";
import { User, Phone, Mail, IdCard, FileText, Building2, Wallet, ReceiptText, History } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { getTenantFull } from "@/lib/rentspace/data";
import {
  formatBaht,
  thaiDateLong,
  tenantDisplayName,
  toNum,
  periodLabel,
  PAYMENT_METHODS,
} from "@/lib/rentspace/format";
import { RsPage, RsHeader, RsBadge, RsBackLink, RsCard, RsKpi } from "@/components/rentspace/ui";
import TenantForm from "../_components/tenant-form";
import CombinedPaymentButton from "../_components/combined-payment-button";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = ["draft", "active", "expiring"];

/** เงินประกันคงเหลือที่ถือไว้ = เก็บ − (คืน+หัก+ริบ) */
function depositBalance(deposits: { kind: string; amountThb: unknown }[]): number {
  return deposits.reduce((s, d) => {
    const amt = toNum(d.amountThb);
    return d.kind === "collect" ? s + amt : s - amt;
  }, 0);
}

/** ระยะเวลาเช่าเป็นข้อความไทย (เดือน/ปี) จาก start → end */
function durationText(start: Date, end: Date): string {
  const months = Math.max(
    0,
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth()),
  );
  if (months < 1) return "< 1 เดือน";
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y ? `${y} ปี` : "", m ? `${m} เดือน` : ""].filter(Boolean).join(" ") || "1 เดือน";
}

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const tenant = await getTenantFull(session.user.org_id, id);
  if (!tenant) notFound();

  const birth = tenant.birthDate ? thaiDateLong(tenant.birthDate) : null;

  const activeContracts = tenant.contracts.filter((c) => ACTIVE_STATUSES.includes(c.status));
  const pastContracts = tenant.contracts.filter((c) => !ACTIVE_STATUSES.includes(c.status));

  // สรุปการเงิน
  const liveBills = tenant.bills.filter((b) => b.status !== "void");
  const outstanding = liveBills.reduce(
    (s, b) => s + Math.max(0, toNum(b.totalAmount) - toNum(b.paidAmount)),
    0,
  );
  const unpaidCount = liveBills.filter(
    (b) => toNum(b.totalAmount) - toNum(b.paidAmount) > 0 && b.status !== "paid",
  ).length;
  const depositHeld = tenant.contracts.reduce((s, c) => s + depositBalance(c.deposits), 0);

  return (
    <RsPage>
      <RsBackLink href="/rentspace/tenants" label="ผู้เช่าทั้งหมด" />

      <RsHeader
        title={tenantDisplayName(tenant)}
        subtitle={tenant.nickname ? `ชื่อเล่น: ${tenant.nickname}` : undefined}
        action={
          <TenantForm
            tenant={{
              id: tenant.id,
              prefix: tenant.prefix,
              firstName: tenant.firstName,
              lastName: tenant.lastName,
              nickname: tenant.nickname,
              bizName: tenant.bizName,
              phones: tenant.phones,
              idCardNo: tenant.idCardNo,
              taxId: tenant.taxId,
              birthDate: tenant.birthDate ? tenant.birthDate.toISOString() : null,
              nationality: tenant.nationality,
              address: tenant.address,
              email: tenant.email,
              facebook: tenant.facebook,
              lineId: tenant.lineId,
              idCardUrl: tenant.idCardUrl,
              docUrls: tenant.docUrls,
              note: tenant.note,
            }}
          />
        }
      />

      {/* สรุป 360° */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <RsKpi label="ค้างชำระรวม" value={formatBaht(outstanding)} tone={outstanding > 0 ? "danger" : undefined} />
        <RsKpi label="บิลค้าง" value={`${unpaidCount} ใบ`} />
        <RsKpi label="บิลทั้งหมด" value={`${liveBills.length} ใบ`} />
        <RsKpi label="เงินประกันคงเหลือ" value={formatBaht(depositHeld)} />
      </div>

      {/* profile */}
      <RsCard className="p-5">
        <SectionTitle icon={<User className="h-4 w-4" />} title="ข้อมูลผู้เช่า" />
        <div className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {tenant.phones && tenant.phones.length > 0 && (
            <Row icon={<Phone className="h-4 w-4" />} label="เบอร์โทร">
              {tenant.phones.join(" · ")}
            </Row>
          )}
          {tenant.email && (
            <Row icon={<Mail className="h-4 w-4" />} label="อีเมล">
              {tenant.email}
            </Row>
          )}
          {tenant.lineId && <Row label="LINE ID">{tenant.lineId}</Row>}
          {tenant.facebook && <Row label="Facebook">{tenant.facebook}</Row>}
          {tenant.idCardNo && (
            <Row icon={<IdCard className="h-4 w-4" />} label="เลขบัตร ปชช.">
              {tenant.idCardNo}
            </Row>
          )}
          {tenant.taxId && <Row label="เลขผู้เสียภาษี">{tenant.taxId}</Row>}
          {birth && <Row label="วันเกิด">{birth}</Row>}
          {tenant.nationality && <Row label="สัญชาติ">{tenant.nationality}</Row>}
          {tenant.address && (
            <Row label="ที่อยู่" full>
              {tenant.address}
            </Row>
          )}
          {tenant.note && (
            <Row label="หมายเหตุ" full>
              {tenant.note}
            </Row>
          )}
        </div>

        {/* documents */}
        {(tenant.idCardUrl || (tenant.docUrls && tenant.docUrls.length > 0) || tenant.documents.length > 0) && (
          <div className="mt-5 pt-4 border-t" style={{ borderColor: "var(--rs-border)" }}>
            <div className="text-[13px] font-semibold mb-2" style={{ color: "var(--rs-text-2)" }}>
              เอกสารแนบ
            </div>
            <div className="flex flex-wrap gap-3">
              {tenant.idCardUrl && (
                <a href={tenant.idCardUrl} target="_blank" rel="noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={tenant.idCardUrl}
                    alt="บัตรประชาชน"
                    className="h-24 w-36 object-cover rounded-lg border"
                    style={{ borderColor: "var(--rs-border)" }}
                  />
                  <span className="block text-[12px] mt-1 text-center" style={{ color: "var(--rs-text-3)" }}>
                    บัตรประชาชน
                  </span>
                </a>
              )}
              {tenant.docUrls?.map((url, i) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg text-sm font-medium"
                  style={{ background: "var(--rs-bg-2)", border: "1px solid var(--rs-border)", color: "var(--rs-brand)" }}
                >
                  <FileText className="h-4 w-4" /> เอกสาร {i + 1}
                </a>
              ))}
              {tenant.documents.map((d) => (
                <a
                  key={d.id}
                  href={d.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg text-sm font-medium"
                  style={{ background: "var(--rs-bg-2)", border: "1px solid var(--rs-border)", color: "var(--rs-brand)" }}
                >
                  <FileText className="h-4 w-4" /> {d.label || "เอกสาร"}
                </a>
              ))}
            </div>
          </div>
        )}
      </RsCard>

      {/* สัญญาปัจจุบัน + เงินประกัน */}
      <RsCard className="p-5">
        <SectionTitle icon={<Building2 className="h-4 w-4" />} title="สัญญาปัจจุบัน" />
        {activeContracts.length === 0 ? (
          <p className="mt-3 text-sm" style={{ color: "var(--rs-text-3)" }}>
            ผู้เช่ารายนี้ยังไม่มีสัญญาที่ใช้งานอยู่
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {activeContracts.map((c) => {
              const bal = depositBalance(c.deposits);
              return (
                <div
                  key={c.id}
                  className="rounded-xl border p-3.5"
                  style={{ borderColor: "var(--rs-border)" }}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <Link
                        href={`/rentspace/units/${c.unitId}`}
                        className="text-[15px] font-bold"
                        style={{ color: "var(--rs-brand)" }}
                      >
                        ห้อง {c.unit?.code ?? "—"}
                      </Link>
                      <span className="ml-2"><RsBadge kind="contract" status={c.status} /></span>
                      <div className="text-[12.5px] mt-1" style={{ color: "var(--rs-text-2)" }}>
                        {c.project?.name} · {thaiDateLong(c.startDate)}
                        {c.endDate ? ` – ${thaiDateLong(c.endDate)}` : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[15px] font-bold tabular-nums" style={{ color: "var(--rs-text)" }}>
                        {formatBaht(toNum(c.rentAmountThb))}/เดือน
                      </div>
                      <div className="text-[12px] flex items-center gap-1 justify-end" style={{ color: "var(--rs-text-3)" }}>
                        <Wallet className="h-3.5 w-3.5" /> เงินประกัน {formatBaht(bal)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-3 text-[13px]">
                    <Link href={`/rentspace/contracts/${c.id}`} className="font-medium" style={{ color: "var(--rs-brand)" }}>
                      ดูสัญญา →
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </RsCard>

      {/* บิลค่าเช่า — timeline วางบิล/ชำระ/สลิป (#4) + ชำระรวม (#10) */}
      <RsCard className="p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <SectionTitle icon={<ReceiptText className="h-4 w-4" />} title="บิลค่าเช่า & การชำระ" />
          {outstanding > 0 && <CombinedPaymentButton tenantId={tenant.id} outstanding={outstanding} />}
        </div>
        {liveBills.length === 0 ? (
          <p className="mt-3 text-sm" style={{ color: "var(--rs-text-3)" }}>
            ยังไม่มีบิลสำหรับผู้เช่ารายนี้
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {liveBills.slice(0, 24).map((b) => {
              const remaining = Math.max(0, toNum(b.totalAmount) - toNum(b.paidAmount));
              const lastPay = b.payments[0];
              return (
                <Link
                  key={b.id}
                  href={`/rentspace/bills/${b.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 hover:bg-[var(--rs-bg-2)] transition-colors"
                  style={{ borderColor: "var(--rs-border)" }}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-semibold" style={{ color: "var(--rs-text)" }}>
                        {periodLabel(b.period)}
                      </span>
                      <RsBadge kind="bill" status={b.status} />
                      <span className="text-[12px]" style={{ color: "var(--rs-text-3)" }}>
                        ห้อง {b.unit?.code}
                      </span>
                    </div>
                    <div className="text-[12px] mt-0.5" style={{ color: "var(--rs-text-3)" }}>
                      วางบิล {b.issueDate ? thaiDateLong(b.issueDate) : "—"} · ครบกำหนด {b.dueDate ? thaiDateLong(b.dueDate) : "—"}
                      {lastPay
                        ? ` · ชำระล่าสุด ${thaiDateLong(lastPay.paidOn)} (${PAYMENT_METHODS[lastPay.method] ?? lastPay.method})`
                        : " · ยังไม่ชำระ"}
                      {lastPay?.slipUrl ? " · มีสลิป" : ""}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[13.5px] font-bold tabular-nums" style={{ color: "var(--rs-text)" }}>
                      {formatBaht(toNum(b.totalAmount))}
                    </div>
                    {remaining > 0 ? (
                      <div className="text-[12px] tabular-nums font-medium" style={{ color: "var(--rs-danger)" }}>
                        ค้าง {formatBaht(remaining)}
                      </div>
                    ) : (
                      <div className="text-[12px]" style={{ color: "var(--rs-ok)" }}>
                        ชำระครบ
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </RsCard>

      {/* ประวัติการเช่า — สัญญาที่จบแล้ว (#7) */}
      {pastContracts.length > 0 && (
        <RsCard className="p-5">
          <SectionTitle icon={<History className="h-4 w-4" />} title="ประวัติการเช่า" />
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr style={{ color: "var(--rs-text-3)" }} className="text-left text-[12px]">
                  <th className="py-1.5 pr-3 font-medium">ห้อง</th>
                  <th className="py-1.5 pr-3 font-medium">ช่วงที่เช่า</th>
                  <th className="py-1.5 pr-3 font-medium">ระยะเวลา</th>
                  <th className="py-1.5 pr-3 font-medium text-right">ค่าเช่า</th>
                  <th className="py-1.5 pr-3 font-medium">สถานะ</th>
                  <th className="py-1.5 pr-3 font-medium" />
                </tr>
              </thead>
              <tbody style={{ color: "var(--rs-text)" }}>
                {pastContracts.map((c) => {
                  const end = c.moveOutDate ?? c.endDate ?? c.updatedAt;
                  return (
                    <tr key={c.id} className="border-t" style={{ borderColor: "var(--rs-border)" }}>
                      <td className="py-1.5 pr-3">
                        <Link href={`/rentspace/units/${c.unitId}`} className="font-medium" style={{ color: "var(--rs-brand)" }}>
                          {c.unit?.code ?? "—"}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap" style={{ color: "var(--rs-text-2)" }}>
                        {thaiDateLong(c.startDate)} – {thaiDateLong(end)}
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap" style={{ color: "var(--rs-text-2)" }}>
                        {durationText(new Date(c.startDate), new Date(end))}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatBaht(toNum(c.rentAmountThb))}</td>
                      <td className="py-1.5 pr-3">
                        <RsBadge kind="contract" status={c.status} />
                      </td>
                      <td className="py-1.5 pr-3">
                        <Link href={`/rentspace/contracts/${c.id}`} className="text-[13px] font-medium" style={{ color: "var(--rs-brand)" }}>
                          ดู →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </RsCard>
      )}
    </RsPage>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2" style={{ color: "var(--rs-text)" }}>
      <span style={{ color: "var(--rs-brand)" }}>{icon}</span>
      <h2 className="text-base font-bold">{title}</h2>
    </div>
  );
}

function Row({
  icon,
  label,
  full,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex gap-2 ${full ? "sm:col-span-2" : ""}`}>
      <span className="shrink-0 w-28 flex items-center gap-1.5" style={{ color: "var(--rs-text-3)" }}>
        {icon}
        {label}
      </span>
      <span style={{ color: "var(--rs-text)" }}>{children}</span>
    </div>
  );
}
