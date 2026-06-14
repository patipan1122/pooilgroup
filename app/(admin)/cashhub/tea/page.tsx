// CASHHUB · ร้านชาไข่มุก (OWL CHA / MR.WOOF / SNOW DIP — POS Foodstory)
// CEO 2026-06-14: ดึง IV รายวันจาก TRCloud (มีคนคีย์ไว้แล้ว 1 ใบ/วัน/สาขา) มาทำตาราง 2 มุมมอง
//   (รวมทุกสาขา วันที่×สาขา + เจาะรายสาขา) แล้ว (ภายหลัง) อัปไฟล์ Foodstory มาเทียบว่าตรงกับ POS ไหม.
//   project codes 8 สาขา validated สด — ดู memory cashhub-tea-foodstory-iv-pull-2026-06-14.
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole, isExecutiveRole } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { BackButton } from "@/components/ui/back-button";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";
import { endOfMonth, startOfMonth } from "date-fns";
import { TEA_BRANCHES } from "@/lib/cashhub/tea-trcloud";
import { loadTeaDays } from "@/lib/cashhub/tea-data";
import { TeaView } from "./tea-view";

export const dynamic = "force-dynamic";

type SP = Promise<{ month?: string; view?: string; branch?: string }>;

export default async function TeaSalesPage({ searchParams }: { searchParams: SP }) {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const orgId = session.user.org_id;
  const admin = adminClient();
  const sp = await searchParams;

  // ── เดือน (default = เดือนปัจจุบัน) ──
  const monthStr = sp.month ?? new Date().toISOString().slice(0, 7);
  const [yy, mm] = monthStr.split("-").map((x) => Number.parseInt(x, 10));
  const monthDate = new Date(yy, (mm || 1) - 1, 1);
  const from = startOfMonth(monthDate).toISOString().slice(0, 10);
  const to = endOfMonth(monthDate).toISOString().slice(0, 10);

  const savedDays = await loadTeaDays(admin, orgId, from, to);
  const canPull = isExecutiveRole(session.user.role);

  const branches = TEA_BRANCHES.map((b) => ({
    code: b.code,
    label: b.label,
    brand: b.brand,
  }));

  return (
    <div className="ch-scope p-3 sm:p-6 lg:p-8 max-w-7xl mx-auto pb-24">
      <BackButton label="ภาพรวม" fallbackHref="/cashhub/dashboard" />
      <header className="mt-3 mb-5">
        <SectionPill num="🧋" label="ร้านชาไข่มุก · ยอดขายรายวัน (TRCloud)" />
        <div className="flex flex-wrap items-end justify-between gap-3 mt-1">
          <TwoToneTitle first="ยอดขาย" accent="ร้านชาไข่มุก" size={30} />
        </div>
        <p className="text-sm text-zinc-500 mt-1">
          ดึงใบกำกับ (IV) รายวันจาก TRCloud ทั้ง {branches.length} สาขา · เก็บถาวร · (เร็ว ๆ นี้)
          อัปไฟล์ Foodstory มาเทียบว่ายอดที่คีย์ตรงกับ POS จริงไหม
        </p>
      </header>

      <TeaView
        month={monthStr}
        from={from}
        to={to}
        branches={branches}
        savedDays={savedDays}
        canPull={canPull}
        initialView={sp.view === "branch" ? "branch" : "matrix"}
        initialBranch={sp.branch ?? branches[0]?.code ?? ""}
      />
    </div>
  );
}
