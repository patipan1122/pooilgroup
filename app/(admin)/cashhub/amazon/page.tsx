// CASHHUB · Café Amazon — ตรวจยอดขาย + คีย์ IV อัตโนมัติ (เซฟถาวร + เทียบ POS↔TRCloud)
// CEO 2026-06-14: อัปไฟล์ POS → เซฟลง DB → แสดงตลอดเป็นตาราง Excel + เช็คว่าที่คีย์ใน TRCloud
//   ตรงกับยอด POS ไหม (match/mismatch) + ดาวน์โหลด Excel + กดสร้าง IV วันที่ยังไม่มี.
//   recipe พิสูจน์แล้ว (IV 1048468). human-confirm ก่อนสร้าง. pilot=ชุมชนหัวทะเล (5157).
//   ดู docs/WORKSHOP_cashhub-amazon-pos-iv.md
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole, isSuperAdmin } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { BackButton } from "@/components/ui/back-button";
import { SectionPill } from "@/components/cashhub/redesign/section-pill";
import { TwoToneTitle } from "@/components/cashhub/redesign/two-tone-title";
import { endOfMonth, startOfMonth } from "date-fns";
import {
  loadAmazonDays,
  listAmazonStores,
  loadImportHistory,
  loadReconcileStatus,
} from "@/lib/cashhub/amazon-data";
import { loadChannelConfig } from "@/lib/cashhub/amazon-settlement-data";
import { findAmazonBranch } from "@/lib/cashhub/amazon-branch-data";
import { AmazonView } from "./amazon-view";
import Link from "next/link";

export const dynamic = "force-dynamic";

type SP = Promise<{ store?: string; month?: string }>;

export default async function AmazonSalesPage({ searchParams }: { searchParams: SP }) {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const orgId = session.user.org_id;
  const admin = adminClient();
  const sp = await searchParams;

  // ── เลือกสาขา (default = สาขาที่มีข้อมูลแล้ว, ไม่งั้น pilot 5157) ──
  const stores = await listAmazonStores(admin, orgId);
  const storeCode = sp.store ?? stores[0]?.store_code ?? "5157";
  const storeLabel = stores.find((s) => s.store_code === storeCode)?.branch_label ?? null;
  const cfg = await findAmazonBranch(admin, orgId, storeCode, storeLabel);
  const branchLabel = storeLabel ?? cfg?.label ?? storeCode;

  // ── เดือน (default = เดือนปัจจุบัน) — guard รูปแบบผิด (?month=xxx) ไม่ให้ Invalid Date → 500 ──
  const monthStr =
    sp.month && /^\d{4}-\d{2}$/.test(sp.month)
      ? sp.month
      : new Date().toISOString().slice(0, 7);
  const [yy, mm] = monthStr.split("-").map((x) => Number.parseInt(x, 10));
  const safeMm = mm >= 1 && mm <= 12 ? mm : 1;
  const monthDate = new Date(yy, safeMm - 1, 1);
  const from = startOfMonth(monthDate).toISOString().slice(0, 10);
  const to = endOfMonth(monthDate).toISOString().slice(0, 10);

  const savedDays = await loadAmazonDays(admin, orgId, storeCode, from, to);
  const history = await loadImportHistory(admin, orgId);
  const configs = await loadChannelConfig(admin, orgId);
  const reconcile = await loadReconcileStatus(admin, orgId, storeCode, from, to);
  const canSend = isSuperAdmin(session.user.role); // ส่งเข้า TRCloud/reconcile = super_admin เท่านั้น
  // ปุ่ม "ส่งซ้ำ (ทดสอบ)" สร้างใบกำกับภาษีซ้ำจริง = foot-gun → ซ่อนใน prod เปิดเฉพาะ env CASHHUB_AMAZON_FORCE=1
  const allowForce = canSend && process.env.CASHHUB_AMAZON_FORCE === "1";

  return (
    <div className="ch-scope p-3 sm:p-6 lg:p-8 max-w-6xl mx-auto pb-24">
      <BackButton label="ภาพรวม" fallbackHref="/cashhub/dashboard" />
      <header className="mt-3 mb-5">
        <SectionPill num="☕" label="Café Amazon · ตรวจยอด + คีย์ IV" />
        <div className="flex flex-wrap items-end justify-between gap-3 mt-1">
          <TwoToneTitle first="ยอดขาย" accent={branchLabel} size={30} />
          {canSend && (
            <Link
              href="/cashhub/amazon/branches"
              className="h-9 inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              🏪 จัดการสาขา
            </Link>
          )}
        </div>
        <p className="text-sm text-zinc-500 mt-1">
          อัปไฟล์ปิดกะ POS → เซฟถาวร → เทียบว่าที่คีย์ใน TRCloud ตรงกับยอด POS ไหม + กดสร้าง IV วันที่ยังไม่มี
        </p>
      </header>

      {/* store / month picker */}
      <form method="get" className="flex flex-wrap gap-2 mb-5">
        {stores.length > 1 && (
          <select
            name="store"
            aria-label="เลือกสาขา"
            title="เลือกสาขา"
            defaultValue={storeCode}
            className="h-10 rounded-xl border border-zinc-200 px-3 text-sm font-medium bg-white"
          >
            {stores.map((s) => (
              <option key={s.store_code} value={s.store_code}>
                {s.branch_label ?? s.store_code}
              </option>
            ))}
          </select>
        )}
        <input
          type="month"
          name="month"
          aria-label="เลือกเดือน"
          title="เลือกเดือน"
          defaultValue={monthStr}
          className="h-10 rounded-xl border border-zinc-200 px-3 text-sm font-medium bg-white"
        />
        <button
          type="submit"
          className="h-10 rounded-xl bg-zinc-900 text-white font-semibold px-5 text-sm"
        >
          ดู
        </button>
      </form>

      <AmazonView
        storeCode={storeCode}
        branchLabel={branchLabel}
        branchType={cfg?.type ?? null}
        month={monthStr}
        from={from}
        to={to}
        savedDays={savedDays}
        canSend={canSend}
        allowForce={allowForce}
        history={history}
        configs={configs}
        reconcile={reconcile}
      />
    </div>
  );
}
