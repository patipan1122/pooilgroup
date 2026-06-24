// DC · หลังบ้าน · ตรวจกระทบยอด / งานบำรุงรักษา (server component)
//
// แสดงผล runDcReconcile:
//   • รายการที่ควรนับสต๊อก (count tasks) — ลิงก์ไปหน้านับ /dc/count
//   • การเลื่อนสถานะการโอนค้างอัตโนมัติ (auto-promote stale transfers)
//   • สถานะการตั้งค่า TRCloud (เทียบมูลค่า DC↔บัญชี)
//
// ปุ่ม "ตรวจกระทบยอดตอนนี้" (client) เรียก /api/dc/reconcile แล้ว refresh.
// งานนี้ NON-blocking — ไม่ขยับเงิน · แค่ housekeeping + แนะนำงานนับ.
import Link from "next/link";
import {
  ClipboardCheck,
  Truck,
  CheckCircle2,
  AlertTriangle,
  Plug,
  PlugZap,
} from "lucide-react";
import { getDcContext } from "@/lib/dc/access";
import { canDcManage, requireDcManager } from "@/lib/dc/role-guard";
import { runDcReconcile } from "@/lib/dc/reconcile";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { KpiTile } from "@/components/ui/kpi-tile";
import { DataTable } from "@/components/ui/data-table";
import { Section } from "@/components/ui/section";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { RerunReconcileButton } from "./rerun-button";

export const dynamic = "force-dynamic";

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" }).format(d);
}
function daysAgo(d: Date): number {
  return Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
}

export default async function DcReconcilePage() {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const result = await runDcReconcile(orgId);

  return (
    <div className="dc-page dc-page--wide">
      <div className="dc-head">
        <div>
          <div className="dc-h1">ตรวจกระทบยอด · DC คลังกลาง</div>
          <div className="dc-sub">งานบำรุงรักษา — เลื่อนสถานะโอนค้าง · งานนับสต๊อกที่ควรทำ · เทียบกับบัญชี</div>
        </div>
        <DcModeSwitch canManage={canDcManage(ctx.session.user.role)} />
      </div>

      <div className="flex items-start justify-between gap-3 flex-wrap mb-6">
        <div
          className="grid gap-3 flex-1"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}
        >
          <KpiTile
            icon={<ClipboardCheck size={16} />}
            accent={result.countTasks.length > 0 ? "warning" : "success"}
            label="ควรนับสต๊อก"
            value={result.countTasks.length}
            unit="รายการ"
          />
          <KpiTile
            icon={<Truck size={16} />}
            accent="info"
            label="เลื่อนสถานะโอนแล้ว"
            value={result.promotedTransfers}
            unit="ใบ"
          />
          <KpiTile
            icon={result.trcloudConfigured ? <PlugZap size={16} /> : <Plug size={16} />}
            accent={result.trcloudConfigured ? "success" : "zinc"}
            label="TRCloud"
            value={result.trcloudConfigured ? "ตั้งค่าแล้ว" : "ยังไม่ตั้งค่า"}
          />
        </div>
        <RerunReconcileButton />
      </div>

      {/* บันทึกผลรอบล่าสุด */}
      <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 px-4 py-3 mb-8 text-sm text-zinc-600">
        {result.note}
      </div>

      <div className="flex flex-col gap-8">
        {/* งานนับสต๊อก */}
        <Section
          number="01"
          label="งานนับสต๊อก"
          title="รายการที่ควรนับ"
          description="สินค้าที่มีของแต่ไม่ได้นับเกิน 30 วัน หรือยังไม่เคยนับ — ความต่างระหว่างยอดในระบบกับของจริงคือสัญญาณให้นับ"
          action={
            result.countTasks.length > 0 ? (
              <Link
                href="/dc/count"
                className="h-9 px-4 rounded-lg bg-[var(--color-brand-600)] text-white text-sm font-bold inline-flex items-center gap-2 hover:bg-[var(--color-brand-700)]"
              >
                <ClipboardCheck size={15} /> ไปหน้านับสต๊อก
              </Link>
            ) : undefined
          }
        >
          <DataTable
            columns={[
              { key: "name", header: "สินค้า" },
              { key: "onHand", header: "คงเหลือ", align: "right" },
              { key: "last", header: "นับล่าสุด", align: "right" },
              { key: "go", header: "", align: "right" },
            ]}
            rows={result.countTasks.slice(0, 100).map((t) => ({
              key: t.productId,
              href: "/dc/count",
              cells: {
                name: (
                  <div>
                    <div className="font-bold text-zinc-900">{t.name}</div>
                    <div className="text-xs text-zinc-400 tabular-nums">{t.sku}</div>
                  </div>
                ),
                onHand: <span className="font-bold tabular-nums">{t.onHand.toLocaleString("th-TH")}</span>,
                last:
                  t.lastCountedAt === null ? (
                    <StatusPill tone="danger" size="sm" dot>
                      ยังไม่เคยนับ
                    </StatusPill>
                  ) : (
                    <span className="text-zinc-500 tabular-nums">
                      {fmtDate(t.lastCountedAt)} · {daysAgo(t.lastCountedAt)} วันก่อน
                    </span>
                  ),
                go: <span className="text-[var(--color-brand-600)] text-xs font-bold">นับ →</span>,
              },
            }))}
            emptyState={
              <EmptyState
                icon={<CheckCircle2 size={26} />}
                title="ไม่มีรายการค้างนับ"
                description="สต๊อกทุกตัวถูกนับภายใน 30 วันที่ผ่านมา"
              />
            }
          />
          {result.countTasks.length > 100 && (
            <p className="mt-2 text-xs text-zinc-400">แสดง 100 รายการแรก จากทั้งหมด {result.countTasks.length} รายการ</p>
          )}
        </Section>

        {/* การเลื่อนสถานะโอน */}
        <Section
          number="02"
          label="การโอนค้าง"
          title="เลื่อนสถานะการโอนอัตโนมัติ"
          description="การโอนที่ค้างนานจะถูกเลื่อนเป็น 'รับอัตโนมัติ (ยังไม่ยืนยัน)' ให้ปลายทางมายืนยันภายหลัง"
        >
          <div className="rounded-xl border border-zinc-200 bg-white px-5 py-6 flex items-center gap-4">
            <div
              className={`size-11 rounded-xl grid place-items-center flex-shrink-0 ${
                result.promotedTransfers > 0 ? "bg-blue-100 text-blue-700" : "bg-zinc-100 text-zinc-500"
              }`}
            >
              <Truck size={22} />
            </div>
            <div>
              <div className="font-bold text-zinc-900">
                {result.promotedTransfers > 0
                  ? `เลื่อนสถานะ ${result.promotedTransfers.toLocaleString("th-TH")} ใบในรอบนี้`
                  : "ไม่มีการโอนที่ต้องเลื่อนสถานะ"}
              </div>
              <div className="text-sm text-zinc-500 mt-0.5">
                {result.promotedTransfers > 0
                  ? "รายการเหล่านี้รอปลายทางยืนยันการรับ"
                  : "การโอนทั้งหมดอยู่ในสถานะปกติ"}
              </div>
            </div>
          </div>
        </Section>

        {/* TRCloud */}
        <Section
          number="03"
          label="เทียบกับบัญชี"
          title="DC ↔ TRCloud"
          description="DC = จำนวนของจริง · TRCloud = มูลค่าทางบัญชี — สองค่านี้อาจต่างกัน ความต่างคือสัญญาณให้ตรวจนับ"
        >
          <div className="rounded-xl border border-zinc-200 bg-white px-5 py-6 flex items-center gap-4">
            <div
              className={`size-11 rounded-xl grid place-items-center flex-shrink-0 ${
                result.trcloudConfigured ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
              }`}
            >
              {result.trcloudConfigured ? <PlugZap size={22} /> : <AlertTriangle size={22} />}
            </div>
            <div>
              <div className="font-bold text-zinc-900">
                {result.trcloudConfigured ? "เชื่อม TRCloud แล้ว" : "ยังไม่ได้ตั้งค่า TRCloud"}
              </div>
              <div className="text-sm text-zinc-500 mt-0.5">
                {result.trcloudConfigured
                  ? "การเทียบมูลค่า DC↔TRCloud จะทำงานในรอบถัดไป"
                  : "ตั้งค่า env DC_TRCLOUD_COMPANY_ID เพื่อเปิดการเทียบมูลค่ากับบัญชี"}
              </div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
