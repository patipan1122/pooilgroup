"use client";

// DC · มุมมอง "บอร์ดสถานะ" (Kanban) — 5 คอลัมน์หลักตาม flow (PO_FLOW_CORE):
//   สั่งแล้ว → ได้เลข Tracking → ถึงไทยแล้ว → ถึงโกดังแล้ว → รับแล้ว
// แต่ละการ์ด: poCode · ผู้ขาย · ยอด · จำนวนรายการ · วันที่ + ลิงก์ action หลัก 1 อันต่อคอลัมน์
// (ใส่เลข Tracking / อัปเดตขนส่ง / ติดตามขนส่ง / รับเข้า GRN) → เปิดหน้ารายละเอียดของใบนั้น.
// PARTIAL/CLOSED/CANCELLED → โซน "อื่น ๆ" ด้านล่าง. เลื่อนแนวนอนได้บนมือถือ. ไม่มี drag-drop.

import { useMemo } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  PO_FLOW_CORE,
  PO_KANBAN_LABEL,
  PO_KANBAN_ACTION,
  PO_STATUS_LABEL,
  PO_STATUS_TONE,
  PO_ORIGIN_LABEL,
} from "@/lib/dc/nav";
import { type PoListItem, fmtMoney, fmtDate, moneySym } from "./purchasing-workspace";

const OTHER_STATUSES = ["PARTIAL", "CLOSED", "CANCELLED"];

function tone(status: string): string {
  return PO_STATUS_TONE[status] ?? "draft";
}

export function KanbanBoard({ items }: { items: PoListItem[] }) {
  const byStatus = useMemo(() => {
    const m: Record<string, PoListItem[]> = {};
    for (const s of PO_FLOW_CORE) m[s] = [];
    const other: PoListItem[] = [];
    for (const it of items) {
      if (m[it.status]) m[it.status].push(it);
      else if (OTHER_STATUSES.includes(it.status)) other.push(it);
      // DRAFT/PENDING_APPROVAL/APPROVED ยังไม่ถึงขั้นในบอร์ด → ไม่แสดง (ดูในมุมมองรายการ)
    }
    return { m, other };
  }, [items]);

  // จำนวนใบ "กำลังดำเนิน" = อยู่ใน 4 คอลัมน์แรก (ยังไม่รับครบ)
  const inProgress = useMemo(
    () =>
      PO_FLOW_CORE.filter((s) => s !== "RECEIVED").reduce((n, s) => n + (byStatus.m[s]?.length ?? 0), 0),
    [byStatus],
  );

  return (
    <div className="dc-pur-kb">
      <div className="dc-pur-kb__hint">{inProgress} ใบกำลังดำเนิน</div>

      <div className="dc-pur-kb__cols">
        {PO_FLOW_CORE.map((s) => {
          const col = byStatus.m[s] ?? [];
          return (
            <div key={s} className="dc-pur-kb__col">
              <div className="dc-pur-kb__head">
                <span>{PO_KANBAN_LABEL[s] ?? s}</span>
                <span className="dc-pur-kb__count">{col.length}</span>
              </div>
              <div className="dc-pur-kb__body">
                {col.length === 0 ? (
                  <div className="dc-pur-kb__empty">—</div>
                ) : (
                  col.map((it) => <KanbanCard key={it.id} item={it} action={PO_KANBAN_ACTION[s]} />)
                )}
              </div>
            </div>
          );
        })}
      </div>

      {byStatus.other.length > 0 && (
        <div className="dc-pur-kb__other">
          <div className="dc-pur-kb__other-head">อื่น ๆ (รับบางส่วน · ปิดใบ · ยกเลิก)</div>
          <div className="dc-pur-kb__other-row">
            {byStatus.other.map((it) => (
              <KanbanCard key={it.id} item={it} action="เปิดดูใบ" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function KanbanCard({ item, action }: { item: PoListItem; action: string }) {
  const s = moneySym(item);
  return (
    <Link href={`/dc/office/purchasing/${item.id}`} className="dc-pur-kb__card">
      <div className="dc-pur-kb__card-top">
        <span className="dc-pur-kb__card-supplier">{item.supplierName ?? "— ไม่ระบุ —"}</span>
        <span
          className={`dc-st dc-st--${item.origin === "THAI" ? "ok" : "ship"}`}
          style={{ fontSize: 10, padding: "1px 6px", flexShrink: 0 }}
        >
          {PO_ORIGIN_LABEL[item.origin] ?? item.origin}
        </span>
      </div>
      <div className="dc-pur-kb__card-meta">
        {item.poCode} · {item.lineCount} รายการ
        {item.boxCount > 0 ? ` · ${item.boxCount} กล่อง` : ""} · {fmtDate(item.date)}
      </div>
      <div className="dc-pur-kb__card-foot">
        <span className="dc-pur-kb__card-total">
          {s}
          {fmtMoney(item.total)}
        </span>
        {OTHER_STATUSES.includes(item.status) && (
          <span className={`dc-st dc-st--${tone(item.status)}`} style={{ fontSize: 10.5 }}>
            {PO_STATUS_LABEL[item.status] ?? item.status}
          </span>
        )}
      </div>
      <span className="dc-pur-kb__card-action">
        {action} <ChevronRight size={14} />
      </span>
    </Link>
  );
}
