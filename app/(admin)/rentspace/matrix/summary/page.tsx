// RentSpace — รายงานสรุปการเก็บค่าเช่า (export จากหน้า matrix). ตารางเดียวรวม
// ทุกเจ้า: ค่าเช่ารวม / ชำระแล้ว / ค้างชำระ ต่อช่วงเดือนที่เลือก. ดีไซน์แบบใบวางบิล
// A4 (โลโก้ + หัวเอกสารทางการ) ตาม CEO 2026-09-09 — พิมพ์/เซฟ PDF ผ่านเบราว์เซอร์
// เหมือนใบวางบิลเดี่ยวเดิม ไม่ใช้ PDF lib ใหม่.
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getPrimaryProject, getProject } from "@/lib/rentspace/data";
import { tenantRentSummary } from "@/lib/rentspace/tenant-summary";
import { formatBaht, periodLabel, thaiDateLong } from "@/lib/rentspace/format";
import { RsPage, RsHeader, RsBackLink } from "@/components/rentspace/ui";
import { PrintSummaryButton } from "./_components/print-summary-button";

export const dynamic = "force-dynamic";

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function currentYearRange(): { from: string; to: string } {
  const y = new Date().getFullYear();
  return { from: `${y}-01`, to: `${y}-12` };
}

export default async function MatrixSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; from?: string; to?: string }>;
}) {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const sp = await searchParams;

  const project = sp.projectId ? await getProject(orgId, sp.projectId) : await getPrimaryProject(orgId);
  if (!project) notFound();

  const fallback = currentYearRange();
  let from = sp.from && PERIOD_RE.test(sp.from) ? sp.from : fallback.from;
  let to = sp.to && PERIOD_RE.test(sp.to) ? sp.to : fallback.to;
  if (from > to) [from, to] = [to, from]; // สลับให้ถูกถ้าเลือกช่วงกลับด้าน

  const report = await tenantRentSummary(orgId, project.id, from, to);
  const rangeLabel = from === to ? periodLabel(from) : `${periodLabel(from)} – ${periodLabel(to)}`;
  const generatedAt = thaiDateLong(new Date());

  return (
    <RsPage>
      <div className="print:hidden">
        <RsBackLink href={`/rentspace/matrix?projectId=${project.id}`} label="กลับตารางค่าเช่า" />
      </div>
      <RsHeader
        title="รายงานสรุปการเก็บค่าเช่า"
        subtitle={`${project.name} · ${rangeLabel} · ${report.rows.length} เจ้า`}
        action={
          <div className="print:hidden">
            <PrintSummaryButton />
          </div>
        }
      />

      <div id="rs-summary" className="rs-card p-6">
        {/* accent bar */}
        <div style={{ height: 5, borderRadius: 3, background: "var(--rs-brand)", marginBottom: 20 }} />

        {/* header: โลโก้ + หัวเอกสาร */}
        <div className="flex items-start justify-between gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logos/jpsync-logo-full.png"
            alt="JPSYNC GROUP · BE THE FUTURE"
            style={{ height: 60, width: "auto", display: "block" }}
          />
          <div className="text-right">
            <div className="text-[22px] font-extrabold leading-none" style={{ color: "var(--rs-text)" }}>
              รายงานสรุปการเก็บค่าเช่า
            </div>
            <div
              className="text-[10px] font-semibold mt-1"
              style={{ color: "var(--rs-text-3)", letterSpacing: "3px" }}
            >
              RENT COLLECTION SUMMARY
            </div>
          </div>
        </div>

        <div className="my-4" style={{ height: 1, background: "var(--rs-border)" }} />

        {/* โครงการ + ช่วงเวลา */}
        <div className="grid grid-cols-2 gap-6">
          <div>
            <div
              className="text-[10px] font-bold uppercase tracking-wide mb-1"
              style={{ color: "var(--rs-text-3)" }}
            >
              โครงการ
            </div>
            <div className="text-[14.5px] font-bold" style={{ color: "var(--rs-text)" }}>
              {project.billCompanyName || project.name}
            </div>
            {(project.billAddress || project.address) && (
              <div className="text-[12px] mt-0.5" style={{ color: "var(--rs-text-2)" }}>
                {project.billAddress || project.address}
              </div>
            )}
          </div>
          <div className="text-right">
            <div
              className="text-[10px] font-bold uppercase tracking-wide mb-1"
              style={{ color: "var(--rs-text-3)" }}
            >
              ช่วงเวลา
            </div>
            <div className="text-[14.5px] font-bold" style={{ color: "var(--rs-text)" }}>
              {rangeLabel}
            </div>
            <div className="text-[12px] mt-0.5" style={{ color: "var(--rs-text-2)" }}>
              ออกรายงานเมื่อ {generatedAt}
            </div>
          </div>
        </div>

        {/* table */}
        <div className="overflow-x-auto mt-5">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr className="text-left" style={{ color: "#fff" }}>
                <th
                  className="py-2.5 px-3 font-semibold text-[11.5px]"
                  style={{ background: "var(--rs-brand)", borderRadius: "8px 0 0 8px" }}
                >
                  ห้อง
                </th>
                <th className="py-2.5 px-3 font-semibold text-[11.5px]" style={{ background: "var(--rs-brand)" }}>
                  ผู้เช่า
                </th>
                <th
                  className="py-2.5 px-3 font-semibold text-[11.5px] text-right"
                  style={{ background: "var(--rs-brand)" }}
                >
                  จำนวนบิล
                </th>
                <th
                  className="py-2.5 px-3 font-semibold text-[11.5px] text-right"
                  style={{ background: "var(--rs-brand)" }}
                >
                  ค่าเช่ารวม
                </th>
                <th
                  className="py-2.5 px-3 font-semibold text-[11.5px] text-right"
                  style={{ background: "var(--rs-brand)" }}
                >
                  ได้ชำระแล้ว
                </th>
                <th
                  className="py-2.5 px-3 font-semibold text-[11.5px] text-right"
                  style={{ background: "var(--rs-brand)", borderRadius: "0 8px 8px 0" }}
                >
                  ค้างชำระ
                </th>
              </tr>
            </thead>
            <tbody>
              {report.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-[13px]" style={{ color: "var(--rs-text-3)" }}>
                    ไม่มีบิลในช่วงเวลานี้
                  </td>
                </tr>
              ) : (
                report.rows.map((r) => (
                  <tr key={`${r.unitId}|${r.tenantId}`} style={{ borderBottom: "1px solid var(--rs-border)" }}>
                    <td className="py-2.5 px-3 align-top font-semibold" style={{ color: "var(--rs-text)" }}>
                      {r.unitCode}
                      {r.unitName ? (
                        <div className="text-[11px] font-normal" style={{ color: "var(--rs-text-3)" }}>
                          {r.unitName}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2.5 px-3 align-top" style={{ color: "var(--rs-text)" }}>
                      {r.tenantName}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums align-top" style={{ color: "var(--rs-text-2)" }}>
                      {r.billCount}
                    </td>
                    <td
                      className="py-2.5 px-3 text-right tabular-nums align-top font-medium"
                      style={{ color: "var(--rs-text)" }}
                    >
                      {formatBaht(r.totalBilled)}
                    </td>
                    <td
                      className="py-2.5 px-3 text-right tabular-nums align-top font-medium"
                      style={{ color: "var(--rs-ok)" }}
                    >
                      {formatBaht(r.totalPaid)}
                    </td>
                    <td
                      className="py-2.5 px-3 text-right tabular-nums align-top font-semibold"
                      style={{ color: r.totalOutstanding > 0 ? "var(--rs-danger)" : "var(--rs-text-3)" }}
                    >
                      {formatBaht(r.totalOutstanding)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {report.rows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={2} className="py-3 px-3 font-bold" style={{ color: "var(--rs-text)" }}>
                    รวมทั้งหมด
                  </td>
                  <td className="py-3 px-3 text-right tabular-nums font-bold" style={{ color: "var(--rs-text)" }}>
                    {report.totals.billCount}
                  </td>
                  <td className="py-3 px-3 text-right tabular-nums font-bold" style={{ color: "var(--rs-text)" }}>
                    {formatBaht(report.totals.totalBilled)}
                  </td>
                  <td className="py-3 px-3 text-right tabular-nums font-bold" style={{ color: "var(--rs-ok)" }}>
                    {formatBaht(report.totals.totalPaid)}
                  </td>
                  <td
                    className="py-3 px-3 text-right tabular-nums font-bold"
                    style={{ color: report.totals.totalOutstanding > 0 ? "var(--rs-danger)" : "var(--rs-text-3)" }}
                  >
                    {formatBaht(report.totals.totalOutstanding)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          body { background: #fff; }
          body * { visibility: hidden; }
          #rs-summary, #rs-summary * { visibility: visible; }
          #rs-summary {
            position: absolute;
            inset: 0;
            box-shadow: none !important;
            border: none !important;
          }
        }
      `}</style>
    </RsPage>
  );
}
