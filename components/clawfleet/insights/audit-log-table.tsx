// Insights · audit log table (server component)
// TODO[claude-design]: cf_audit_log table missing per AUDIT §1 (M1 migration pending).
// Until migration ships, this renders an EmptyState with the deferred-migration note.
// When the table exists, swap the stub for:
//   const rows = await getAuditLog({ actorId, actionType, from, to, take: 50 });

import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, type TableRow } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { FileSearch, AlertTriangle } from "lucide-react";

interface AuditLogTableProps {
  actorId?: string;
  actionType?: string;
  from: Date;
  to: Date;
  baseParams: URLSearchParams;
}

// Shape that the real getAuditLog query will return.
interface AuditEntry {
  id: string;
  occurredAt: Date;
  actorName: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  diff?: string;
}

// TODO[claude-design]: replace this stub with:
//   import { getAuditLog } from "@/lib/clawfleet/queries";
//   const rows = await getAuditLog({ actorId, actionType, from, to, take: 50 });
async function getAuditLogStub(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _opts: { actorId?: string; actionType?: string; from: Date; to: Date },
): Promise<AuditEntry[]> {
  return [];
}

const ACTION_LABEL: Record<string, string> = {
  CREATE_MACHINE: "เพิ่มตู้",
  UPDATE_MACHINE: "แก้ไขตู้",
  SET_LOADOUT: "ตั้งสินค้า",
  REVIEW_SESSION: "Review รอบเก็บ",
  STOCK_RECEIVE: "รับสต๊อก",
  STOCK_COUNT: "นับสต๊อก",
  UPDATE_SETTINGS: "แก้ Settings",
};

export async function AuditLogTable({
  actorId,
  actionType,
  from,
  to,
  baseParams,
}: AuditLogTableProps) {
  const entries = await getAuditLogStub({ actorId, actionType, from, to });

  if (entries.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold">ตาราง cf_audit_log ยังไม่ถูก migrate</p>
            <p className="mt-0.5 text-xs text-amber-800">
              ดูบันทึก audit ตามแผน M1 (audit-only migration) ใน
              <code className="ml-1 rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px]">
                memory clawfleet-audit-2026-05-25
              </code>
              {" · "}เมื่อ migration ผ่านแล้ว ระบบจะดึงข้อมูลจริงให้อัตโนมัติ
            </p>
          </div>
        </div>
        <EmptyState
          icon={<FileSearch className="h-6 w-6" />}
          title="ยังไม่มีข้อมูล audit log"
          description="ระบบจะแสดงประวัติทุกการแก้ไข · ทุกคน · ทุกเวลา หลัง migration M1 ผ่าน"
        />
      </div>
    );
  }

  const rows: TableRow[] = entries.map((e) => {
    const drillParams = new URLSearchParams(baseParams);
    drillParams.set("drill", e.id);
    const ts = new Date(e.occurredAt);

    return {
      key: e.id,
      href: `?${drillParams.toString()}`,
      cells: {
        time: (
          <div className="leading-tight">
            <div className="text-sm text-zinc-900 tabular-nums">
              {ts.toLocaleDateString("th-TH", {
                day: "2-digit",
                month: "short",
              })}
            </div>
            <div className="text-[11px] text-zinc-500 tabular-nums">
              {ts.toLocaleTimeString("th-TH", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
        ),
        actor: (
          <div>
            <div className="text-sm font-semibold text-zinc-900">
              {e.actorName}
            </div>
            <div className="text-[11px] text-zinc-500">{e.actorRole}</div>
          </div>
        ),
        action: (
          <StatusPill tone="brand" size="xs">
            {ACTION_LABEL[e.action] ?? e.action}
          </StatusPill>
        ),
        entity: (
          <div>
            <div className="text-xs text-zinc-500">{e.entityType}</div>
            <div className="font-mono text-[11px] text-zinc-700">
              {e.entityId.slice(0, 12)}…
            </div>
          </div>
        ),
        diff: (
          <span className="line-clamp-1 text-xs text-zinc-600">
            {e.diff ?? "—"}
          </span>
        ),
      },
    };
  });

  return (
    <DataTable
      columns={[
        { key: "time", header: "เวลา" },
        { key: "actor", header: "ใคร" },
        { key: "action", header: "ทำอะไร" },
        { key: "entity", header: "เป้าหมาย" },
        { key: "diff", header: "การเปลี่ยนแปลง" },
      ]}
      rows={rows}
    />
  );
}
