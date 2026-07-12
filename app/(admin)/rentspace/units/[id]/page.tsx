import Link from "next/link";
import { notFound } from "next/navigation";
import { Phone, Gauge, FileText, History } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { getUnitDetail } from "@/lib/rentspace/data";
import { formatBaht, thaiDateLong, tenantDisplayName, toNum, currentPeriod, periodLabel } from "@/lib/rentspace/format";
import { RsPage, RsHeader, RsBadge, RsBackLink, RsCard } from "@/components/rentspace/ui";
import UnitForm from "../_components/unit-form";
import { UnitBillAction } from "../_components/unit-bill-action";

export const dynamic = "force-dynamic";

export default async function UnitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const unit = await getUnitDetail(session.user.org_id, id);
  if (!unit) notFound();

  // สัญญาที่ยัง "ใช้งาน/หมดอายุ" (เช่าต่อรายเดือน) = ผู้เช่าปัจจุบัน · กันเฉพาะ draft/terminated
  const activeContract =
    unit.contracts.find((c) => ["active", "expiring", "expired"].includes(c.status)) ?? unit.contracts[0] ?? null;

  // สถานะบิลงวดปัจจุบัน + ออกบิลได้ไหม
  const period = currentPeriod();
  const currentBill = unit.bills.find((b) => b.period === period && b.status !== "void") ?? null;
  const billableContract =
    activeContract && ["active", "expiring", "expired"].includes(activeContract.status) ? activeContract : null;

  return (
    <RsPage>
      <RsBackLink href="/rentspace/units" label="ห้องเช่าทั้งหมด" />

      <RsHeader
        title={`${unit.code}${unit.name ? ` · ${unit.name}` : ""}`}
        subtitle={[unit.project?.name, unit.building && `อาคาร ${unit.building}`, unit.floor != null && `ชั้น ${unit.floor}`]
          .filter(Boolean)
          .join(" · ")}
        action={
          <div className="flex items-center gap-2">
            <RsBadge kind="unit" status={unit.status} />
            <UnitForm
              projectId={unit.projectId}
              unit={{
                id: unit.id,
                code: unit.code,
                name: unit.name,
                building: unit.building,
                floor: unit.floor,
                zone: unit.zone,
                areaSqm: unit.areaSqm,
                baseRentThb: unit.baseRentThb,
                status: unit.status,
                sortOrder: unit.sortOrder,
              }}
            />
          </div>
        }
      />

      {/* (a) ผู้เช่า / สัญญาปัจจุบัน */}
      <RsCard className="p-5">
        <SectionTitle icon={<Phone className="h-4 w-4" />} title="ผู้เช่า / สัญญาปัจจุบัน" />
        {activeContract ? (
          <div className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Row label="ผู้เช่า">
              <Link
                href={`/rentspace/tenants/${activeContract.tenantId}`}
                className="font-medium"
                style={{ color: "var(--rs-brand)" }}
              >
                {tenantDisplayName(activeContract.tenant)}
              </Link>
            </Row>
            <Row label="เบอร์โทร">{activeContract.tenant.phones?.[0] ?? "—"}</Row>
            <Row label="ค่าเช่า/เดือน">{formatBaht(toNum(activeContract.rentAmountThb))}</Row>
            <Row label="สถานะสัญญา">
              <RsBadge kind="contract" status={activeContract.status} />
            </Row>
            <Row label="ระยะสัญญา">
              {thaiDateLong(activeContract.startDate)}
              {activeContract.endDate ? ` – ${thaiDateLong(activeContract.endDate)}` : " – ไม่มีกำหนด"}
            </Row>
            <Row label="">
              <Link
                href={`/rentspace/contracts/${activeContract.id}`}
                className="text-[13px] font-medium"
                style={{ color: "var(--rs-brand)" }}
              >
                ดูสัญญา →
              </Link>
            </Row>
          </div>
        ) : (
          <p className="mt-3 text-sm" style={{ color: "var(--rs-text-3)" }}>
            ยังไม่มีสัญญาที่ใช้งานอยู่สำหรับห้องนี้
          </p>
        )}

        {/* ออกบิลงวดนี้ + สถานะ — กดออกบิลจากหน้าห้องได้เลย */}
        <div className="mt-4 pt-4 border-t" style={{ borderColor: "var(--rs-border)" }}>
          <UnitBillAction
            contractId={billableContract?.id ?? null}
            period={period}
            periodLabelText={periodLabel(period)}
            currentBillId={currentBill?.id ?? null}
            currentBillStatus={currentBill?.status ?? null}
          />
        </div>
      </RsCard>

      {/* (b) มิเตอร์ */}
      <RsCard className="p-5">
        <SectionTitle icon={<Gauge className="h-4 w-4" />} title="มิเตอร์" />
        {unit.meters.length === 0 ? (
          <p className="mt-3 text-sm" style={{ color: "var(--rs-text-3)" }}>
            ยังไม่มีมิเตอร์ในห้องนี้
          </p>
        ) : (
          <div className="mt-3 space-y-4">
            {unit.meters.map((m) => (
              <div key={m.id}>
                <div className="text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text-2)" }}>
                  {m.kind === "electric" ? "ไฟฟ้า" : m.kind === "water" ? "น้ำ" : m.kind}
                </div>
                {m.readings.length === 0 ? (
                  <p className="text-sm" style={{ color: "var(--rs-text-3)" }}>
                    ยังไม่มีการจดเลข
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ color: "var(--rs-text-3)" }} className="text-left text-[12px]">
                          <th className="py-1.5 pr-3 font-medium">งวด</th>
                          <th className="py-1.5 pr-3 font-medium text-right">เลขก่อน</th>
                          <th className="py-1.5 pr-3 font-medium text-right">เลขปัจจุบัน</th>
                          <th className="py-1.5 pr-3 font-medium text-right">หน่วย</th>
                          <th className="py-1.5 pr-3 font-medium text-right">เป็นเงิน</th>
                        </tr>
                      </thead>
                      <tbody style={{ color: "var(--rs-text)" }}>
                        {m.readings.map((r) => (
                          <tr key={r.id} className="border-t" style={{ borderColor: "var(--rs-border)" }}>
                            <td className="py-1.5 pr-3">{r.period}</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">{toNum(r.prevReading)}</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">{toNum(r.currReading)}</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">{toNum(r.usage)}</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">{formatBaht(toNum(r.amountThb))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </RsCard>

      {/* (c) บิลล่าสุด */}
      <RsCard className="p-5">
        <SectionTitle icon={<FileText className="h-4 w-4" />} title="บิลล่าสุด" />
        {unit.bills.length === 0 ? (
          <p className="mt-3 text-sm" style={{ color: "var(--rs-text-3)" }}>
            ยังไม่มีบิล
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--rs-text-3)" }} className="text-left text-[12px]">
                  <th className="py-1.5 pr-3 font-medium">งวด</th>
                  <th className="py-1.5 pr-3 font-medium text-right">ยอดรวม</th>
                  <th className="py-1.5 pr-3 font-medium text-right">ชำระแล้ว</th>
                  <th className="py-1.5 pr-3 font-medium">สถานะ</th>
                  <th className="py-1.5 pr-3 font-medium" />
                </tr>
              </thead>
              <tbody style={{ color: "var(--rs-text)" }}>
                {unit.bills.map((b) => (
                  <tr key={b.id} className="border-t" style={{ borderColor: "var(--rs-border)" }}>
                    <td className="py-1.5 pr-3">{b.period}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatBaht(toNum(b.totalAmount))}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatBaht(toNum(b.paidAmount))}</td>
                    <td className="py-1.5 pr-3">
                      <RsBadge kind="bill" status={b.status} />
                    </td>
                    <td className="py-1.5 pr-3">
                      <Link
                        href={`/rentspace/bills/${b.id}`}
                        className="text-[13px] font-medium"
                        style={{ color: "var(--rs-brand)" }}
                      >
                        ดู →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </RsCard>

      {/* (d) ประวัติสัญญาทั้งหมด */}
      <RsCard className="p-5">
        <SectionTitle icon={<History className="h-4 w-4" />} title="ประวัติสัญญาทั้งหมด" />
        {unit.contracts.length === 0 ? (
          <p className="mt-3 text-sm" style={{ color: "var(--rs-text-3)" }}>
            ยังไม่มีสัญญา
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--rs-text-3)" }} className="text-left text-[12px]">
                  <th className="py-1.5 pr-3 font-medium">เลขสัญญา</th>
                  <th className="py-1.5 pr-3 font-medium">ผู้เช่า</th>
                  <th className="py-1.5 pr-3 font-medium text-right">ค่าเช่า</th>
                  <th className="py-1.5 pr-3 font-medium">ระยะ</th>
                  <th className="py-1.5 pr-3 font-medium">สถานะ</th>
                  <th className="py-1.5 pr-3 font-medium" />
                </tr>
              </thead>
              <tbody style={{ color: "var(--rs-text)" }}>
                {unit.contracts.map((c) => (
                  <tr key={c.id} className="border-t" style={{ borderColor: "var(--rs-border)" }}>
                    <td className="py-1.5 pr-3 font-medium">{c.contractNo}</td>
                    <td className="py-1.5 pr-3">{tenantDisplayName(c.tenant)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatBaht(toNum(c.rentAmountThb))}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap" style={{ color: "var(--rs-text-2)" }}>
                      {thaiDateLong(c.startDate)}
                      {c.endDate ? ` – ${thaiDateLong(c.endDate)}` : ""}
                    </td>
                    <td className="py-1.5 pr-3">
                      <RsBadge kind="contract" status={c.status} />
                    </td>
                    <td className="py-1.5 pr-3">
                      <Link
                        href={`/rentspace/contracts/${c.id}`}
                        className="text-[13px] font-medium"
                        style={{ color: "var(--rs-brand)" }}
                      >
                        ดู →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </RsCard>
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      {label && (
        <span className="shrink-0 w-24" style={{ color: "var(--rs-text-3)" }}>
          {label}
        </span>
      )}
      <span style={{ color: "var(--rs-text)" }}>{children}</span>
    </div>
  );
}
