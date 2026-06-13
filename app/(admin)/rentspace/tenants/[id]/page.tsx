import Link from "next/link";
import { notFound } from "next/navigation";
import { User, Phone, Mail, IdCard, FileText, Building2 } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { getTenant } from "@/lib/rentspace/data";
import { formatBaht, thaiDateLong, tenantDisplayName, toNum } from "@/lib/rentspace/format";
import { RsPage, RsHeader, RsBadge, RsBackLink, RsCard } from "@/components/rentspace/ui";
import TenantForm from "../_components/tenant-form";

export const dynamic = "force-dynamic";

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const tenant = await getTenant(session.user.org_id, id);
  if (!tenant) notFound();

  const birth = tenant.birthDate ? thaiDateLong(tenant.birthDate) : null;

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
        {(tenant.idCardUrl || (tenant.docUrls && tenant.docUrls.length > 0)) && (
          <div className="mt-5 pt-4 border-t" style={{ borderColor: "var(--rs-border)" }}>
            <div className="text-[13px] font-semibold mb-2" style={{ color: "var(--rs-text-2)" }}>
              เอกสาร
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
            </div>
          </div>
        )}
      </RsCard>

      {/* contracts */}
      <RsCard className="p-5">
        <SectionTitle icon={<Building2 className="h-4 w-4" />} title="สัญญาเช่า" />
        {tenant.contracts.length === 0 ? (
          <p className="mt-3 text-sm" style={{ color: "var(--rs-text-3)" }}>
            ผู้เช่ารายนี้ยังไม่มีสัญญา
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--rs-text-3)" }} className="text-left text-[12px]">
                  <th className="py-1.5 pr-3 font-medium">ห้อง</th>
                  <th className="py-1.5 pr-3 font-medium">โครงการ</th>
                  <th className="py-1.5 pr-3 font-medium text-right">ค่าเช่า</th>
                  <th className="py-1.5 pr-3 font-medium">ระยะ</th>
                  <th className="py-1.5 pr-3 font-medium">สถานะ</th>
                  <th className="py-1.5 pr-3 font-medium" />
                </tr>
              </thead>
              <tbody style={{ color: "var(--rs-text)" }}>
                {tenant.contracts.map((c) => (
                  <tr key={c.id} className="border-t" style={{ borderColor: "var(--rs-border)" }}>
                    <td className="py-1.5 pr-3">
                      <Link
                        href={`/rentspace/units/${c.unitId}`}
                        className="font-medium"
                        style={{ color: "var(--rs-brand)" }}
                      >
                        {c.unit?.code ?? "—"}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3" style={{ color: "var(--rs-text-2)" }}>
                      {c.project?.name ?? "—"}
                    </td>
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
