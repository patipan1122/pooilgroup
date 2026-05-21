// DocuFlow — /docuflow/browse
// ────────────────────────────────────────────────────────────────────
// Tree-style overview ของเอกสารทั้ง org. ลำดับชั้น:
//   🌐 ทั้งกลุ่ม  →  🏢 บริษัท  →  ⛽ ประเภทธุรกิจ  →  🏪 สาขา  →  เอกสาร
//   👤 เอกสารบุคลากร  (collapse list)
//
// Search box ที่บนสุด — auto-expand nodes ที่มี match. Click doc → /docuflow/documents/[id]
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { ArrowLeft, Upload, FolderTree } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { isAdminTier } from "@/lib/auth/module-access";
import { Section } from "@/components/ui/section";
import { thaiDateLong } from "@/lib/utils/format";
import { buildDocumentTree } from "@/lib/docuflow/tree";
import { TreeBrowser } from "@/components/docuflow/tree-browser";

export const dynamic = "force-dynamic";

export default async function DocuFlowBrowsePage() {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const orgId = session.user.org_id;
  const adminTier = isAdminTier(session.user.role);

  const tree = await buildDocumentTree(orgId);

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-5xl mx-auto pb-24">
      <header className="mb-6 animate-fade-up flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link
            href="/docuflow"
            className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            <ArrowLeft className="size-4" />
            กลับ
          </Link>
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold mt-3">
            📄 DocuFlow · {thaiDateLong(new Date())}
          </p>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.04em] font-display mt-3 leading-[1.05]">
            <span className="text-gradient-blue">เอกสารทั้งหมด</span> · ตามโครงสร้าง
          </h1>
          <p className="text-zinc-600 mt-1.5 text-sm">
            กดที่ลูกศรเพื่อเปิด/ปิดแต่ละชั้น — ค้นหาด้วยช่องด้านล่าง
          </p>
        </div>
        {adminTier && (
          <Link
            href="/docuflow/documents/upload/template"
            className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 bg-[var(--color-brand-600)] text-white hover:bg-[var(--color-brand-700)] active:bg-[var(--color-brand-800)] shadow-soft h-10 px-4 text-sm rounded-xl shrink-0"
          >
            <Upload className="size-4" />
            อัปโหลดเอกสาร
          </Link>
        )}
      </header>

      <Section
        number="BR"
        label="BROWSE"
        title="โครงสร้างเอกสาร Pooilgroup"
        description={`${tree.totals.docCount.toLocaleString("th-TH")} เอกสาร · ต้องต่ออายุด่วน ${tree.totals.expiringCount.toLocaleString("th-TH")}`}
        className="animate-fade-up delay-100"
        action={
          <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
            <FolderTree className="size-4" />
            view ตาม ownership
          </span>
        }
      >
        <TreeBrowser tree={tree} />
      </Section>
    </div>
  );
}
