import Link from "next/link";
import { Search, Phone, User, IdCard } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { listTenants } from "@/lib/rentspace/data";
import { tenantDisplayName } from "@/lib/rentspace/format";
import { RsPage, RsHeader, RsCard, RsEmpty } from "@/components/rentspace/ui";
import TenantForm from "./_components/tenant-form";

export const dynamic = "force-dynamic";

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const search = (q ?? "").trim();
  const session = await requireSession();
  const tenants = await listTenants(session.user.org_id, search || undefined);

  return (
    <RsPage>
      <RsHeader
        title="ผู้เช่า"
        subtitle={`${tenants.length} ราย`}
        action={<TenantForm />}
      />

      {/* search — server-driven GET form (no JS needed) */}
      <form method="get" className="relative">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
          style={{ color: "var(--rs-text-3)" }}
        />
        <input
          name="q"
          defaultValue={search}
          placeholder="ค้นหาชื่อ / ชื่อร้าน / เลขบัตร"
          aria-label="ค้นหาผู้เช่า"
          className="w-full h-11 pl-9 pr-4 rounded-xl text-sm"
          style={{ border: "1px solid var(--rs-border)", background: "#fff", color: "var(--rs-text)" }}
        />
      </form>

      {tenants.length === 0 ? (
        <RsEmpty
          icon="👤"
          title={search ? "ไม่พบผู้เช่าที่ค้นหา" : "ยังไม่มีผู้เช่า"}
          hint={search ? `ลองค้นด้วยคำอื่น (ค้นหา: "${search}")` : "กดปุ่ม เพิ่มผู้เช่า เพื่อสร้างรายแรก"}
          action={search ? <Link href="/rentspace/tenants" className="rs-btn rs-btn-ghost">ล้างการค้นหา</Link> : <TenantForm />}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {tenants.map((t) => {
            const activeContracts = t.contracts; // already filtered to status=active in data layer
            const phone = t.phones?.[0];
            const activeUnitId = activeContracts.find((c) => c.unit?.id)?.unit?.id;
            const href = activeUnitId ? `/rentspace/tenants?unit=${activeUnitId}` : `/rentspace/tenants/${t.id}`;
            return (
              <Link key={t.id} href={href} className="block">
                <RsCard className="p-4 h-full hover:border-[var(--rs-brand)] transition-colors">
                  <div className="flex items-start gap-3">
                    <div
                      className="shrink-0 h-10 w-10 rounded-full flex items-center justify-center"
                      style={{ background: "var(--rs-brand-50)", color: "var(--rs-brand)" }}
                    >
                      <User className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold truncate" style={{ color: "var(--rs-text)" }}>
                        {tenantDisplayName(t)}
                      </div>
                      <div className="mt-1 space-y-0.5 text-[13px]" style={{ color: "var(--rs-text-2)" }}>
                        {phone && (
                          <div className="flex items-center gap-1.5">
                            <Phone className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--rs-text-3)" }} />
                            <span className="truncate">{t.phones!.join(" · ")}</span>
                          </div>
                        )}
                        {t.idCardNo && (
                          <div className="flex items-center gap-1.5">
                            <IdCard className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--rs-text-3)" }} />
                            <span className="truncate">{t.idCardNo}</span>
                          </div>
                        )}
                      </div>
                      <div className="mt-2 text-[12.5px]" style={{ color: "var(--rs-text-3)" }}>
                        {activeContracts.length > 0 ? (
                          <span>
                            {activeContracts.length} สัญญาใช้งาน ·{" "}
                            <span style={{ color: "var(--rs-text-2)" }}>
                              {activeContracts.map((c) => c.unit?.code).filter(Boolean).join(", ")}
                            </span>
                          </span>
                        ) : (
                          "ไม่มีสัญญาที่ใช้งาน"
                        )}
                      </div>
                    </div>
                  </div>
                </RsCard>
              </Link>
            );
          })}
        </div>
      )}
    </RsPage>
  );
}
