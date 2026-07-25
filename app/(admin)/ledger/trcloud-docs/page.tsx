// Ledger · เอกสาร TRCloud — ดึง PO/AP จาก TRCloud มาดู/กรอง (อ่านอย่างเดียว · snapshot).
//   TRCloud = ต้นฉบับ · เราเก็บสำเนาในตาราง ledger_trcloud_doc แล้วเปิด browse/filter จาก DB
//   (TRCloud rate-limit + ตัวกรองวันที่พัง → ไม่ยิงสดทุกครั้ง · กด "รีเฟรช" เพื่อ sync รอบใหม่).
// URL state: ?kind=AP|PO&companyFormat=&department=&project=&status=&from=&to=&q=
import { requireRole } from "@/lib/auth/session";
import { getTrcloudDocs, type TrcloudDocKind, type TrcloudDocSource } from "@/lib/ledger/trcloud-docs-data";
import { SyncButton } from "./_components/SyncButton";
import { TrcloudDocsFilters } from "./_components/TrcloudDocsFilters";
import { TrcloudDocsTable } from "./_components/TrcloudDocsTable";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // ปุ่มรีเฟรชยิง TRCloud หลายหน้า (มี throttle)

function fmtSynced(iso: string | null): string {
  if (!iso) return "ยังไม่เคยดึง";
  const d = new Date(iso);
  return d.toLocaleString("th-TH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default async function TrcloudDocsPage({
  searchParams,
}: {
  searchParams: Promise<{
    kind?: string;
    companyFormat?: string;
    department?: string;
    project?: string;
    status?: string;
    source?: string;
    from?: string;
    to?: string;
    q?: string;
  }>;
}) {
  // financial-view tier (เห็นยอด/ผู้ขาย/ทุกนิติบุคคล) — ตรงกับหน้ารายจ่าย
  const session = await requireRole("super_admin", "org_admin", "admin", "area_manager", "viewer");
  const sp = await searchParams;

  const kind: TrcloudDocKind = sp.kind === "PO" ? "PO" : "AP";
  const source: TrcloudDocSource | undefined =
    sp.source === "ours" || sp.source === "trcloud" ? sp.source : undefined;
  const filters = {
    kind,
    companyFormat: sp.companyFormat?.trim() || undefined,
    department: sp.department?.trim() || undefined,
    project: sp.project?.trim() || undefined,
    status: sp.status?.trim() || undefined,
    source,
    from: sp.from?.trim() || undefined,
    to: sp.to?.trim() || undefined,
    q: sp.q?.trim() || undefined,
  };

  const data = await getTrcloudDocs(session.user.org_id, filters);

  return (
    <div className="space-y-4 p-4 sm:px-6 sm:pt-4 sm:pb-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">เอกสาร TRCloud</h1>
          <p className="text-xs text-zinc-500">
            ดึงใบ PO/AP จาก TRCloud มาดูในเว็บเรา (อ่านอย่างเดียว) · อัปเดตล่าสุด {fmtSynced(data.lastSyncedAt)}
          </p>
        </div>
        <SyncButton />
      </div>

      {/* Tabs + filters */}
      <TrcloudDocsFilters
        kind={kind}
        counts={data.counts}
        facets={data.facets}
        current={filters}
      />

      {/* Result count */}
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>
          แสดง {data.rows.length.toLocaleString("th-TH")} รายการ
          {data.fromLedgerInView > 0 && ` · ในนี้ส่งจากเรา (LedgerLine) ${data.fromLedgerInView.toLocaleString("th-TH")} ใบ`}
          {data.truncated && " · จำกัด 300 รายการแรก — กรองให้แคบลงเพื่อดูรายการอื่น"}
        </span>
      </div>

      {/* Table */}
      <TrcloudDocsTable rows={data.rows} kind={kind} />
    </div>
  );
}
