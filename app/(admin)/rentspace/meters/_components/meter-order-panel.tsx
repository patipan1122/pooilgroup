"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GripVertical, ArrowUp, ArrowDown, CheckCircle2, ListOrdered } from "lucide-react";
import { actReorderMeterUnits } from "../../_actions";

export type MeterOrderRoom = { id: string; code: string; name: string | null; tenant: string | null };

/**
 * จัดลำดับห้องหน้าจดมิเตอร์เอง — ให้ตรงกับเส้นทางเดินจดจริง (ไม่ใช่ลำดับรหัสห้อง).
 * ลำดับนี้ใช้ร่วมกันทั้งองค์กร (ทุกคนที่จดเห็นลำดับเดียวกัน) — แยกจากลำดับหน้า
 * Excel matrix (matrixSortOrder) เพราะเป็นคนละเส้นทาง/คนละวัตถุประสงค์กัน.
 * พอร์ตมาจาก pattern เดียวกับ matrix-grid.tsx (ลาก/กดลูกศร ▲▼).
 */
export default function MeterOrderPanel({ projectId, rooms }: { projectId: string; rooms: MeterOrderRoom[] }) {
  const router = useRouter();
  const [orderMode, setOrderMode] = useState(false);
  const [draft, setDraft] = useState<MeterOrderRoom[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [saving, startSave] = useTransition();

  function enterOrder() {
    setDraft([...rooms]);
    setOrderMode(true);
  }
  function cancelOrder() {
    setOrderMode(false);
    setDragIdx(null);
  }
  function moveTo(from: number, to: number) {
    if (from === to || to < 0 || to >= draft.length) return;
    setDraft((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }
  function saveOrder() {
    const ids = draft.map((r) => r.id);
    startSave(async () => {
      try {
        await actReorderMeterUnits(projectId, ids);
        setOrderMode(false);
        setDragIdx(null);
        router.refresh();
      } catch {
        alert("บันทึกลำดับไม่สำเร็จ ลองอีกครั้ง");
      }
    });
  }

  if (rooms.length === 0) return null;

  if (!orderMode) {
    return (
      <button type="button" onClick={enterOrder} className="rs-btn-ghost !h-9 inline-flex items-center gap-1.5">
        <ListOrdered className="h-4 w-4" /> จัดลำดับห้อง
      </button>
    );
  }

  return (
    <div className="rs-card p-3 mt-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <div className="text-sm font-bold" style={{ color: "var(--rs-text)" }}>
            จัดลำดับห้อง (หน้าจดมิเตอร์)
          </div>
          <div className="text-[12px]" style={{ color: "var(--rs-text-3)" }}>
            ลากที่ ⠿ หรือกดลูกศร ▲▼ ให้ตรงกับเส้นทางเดินจดมิเตอร์จริง · ห้องบนสุด = ห้องแรกที่จด · ลำดับนี้ใช้ร่วมกันทุกคน
          </div>
        </div>
        <button type="button" onClick={cancelOrder} disabled={saving} className="rs-btn-ghost !h-9">
          ยกเลิก
        </button>
        <button type="button" onClick={saveOrder} disabled={saving} className="rs-btn !h-9 inline-flex items-center gap-1">
          <CheckCircle2 className="h-4 w-4" /> {saving ? "กำลังบันทึก…" : "บันทึกลำดับ"}
        </button>
      </div>

      <div className="rs-reorder">
        {draft.map((r, i) => (
          <div
            key={r.id}
            draggable={!saving}
            onDragStart={() => setDragIdx(i)}
            onDragEnter={() => {
              if (dragIdx !== null && dragIdx !== i) {
                moveTo(dragIdx, i);
                setDragIdx(i);
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragEnd={() => setDragIdx(null)}
            className={`rs-reorder-row ${dragIdx === i ? "rs-reorder-drag" : ""}`}
          >
            <GripVertical className="rs-grip h-4 w-4 shrink-0" />
            <span className="rs-reorder-num tabular-nums">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div style={{ fontWeight: 700, color: "var(--rs-text)", fontSize: 13 }}>{r.code}</div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--rs-text-3)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {r.name ?? r.tenant ?? "— ว่าง —"}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                aria-label="เลื่อนขึ้น"
                disabled={i === 0 || saving}
                onClick={() => moveTo(i, i - 1)}
                className="rs-move-btn"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="เลื่อนลง"
                disabled={i === draft.length - 1 || saving}
                onClick={() => moveTo(i, i + 1)}
                className="rs-move-btn"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <style jsx>{`
        .rs-reorder {
          max-height: calc(100dvh - 20rem);
          overflow: auto;
          border: 1px solid var(--rs-border);
          border-radius: 12px;
          overscroll-behavior: contain;
        }
        .rs-reorder-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          border-bottom: 1px solid var(--rs-border);
          background: var(--rs-bg);
          cursor: grab;
          user-select: none;
        }
        .rs-reorder-row:last-child {
          border-bottom: none;
        }
        .rs-reorder-drag {
          background: var(--rs-brand-50);
          outline: 2px solid var(--rs-brand);
          outline-offset: -2px;
        }
        .rs-grip {
          color: var(--rs-text-3);
        }
        .rs-reorder-num {
          width: 26px;
          text-align: right;
          font-size: 11px;
          font-weight: 700;
          color: var(--rs-text-3);
        }
        .rs-move-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border-radius: 8px;
          color: var(--rs-text-2);
          border: 1px solid var(--rs-border);
          background: var(--rs-bg);
        }
        .rs-move-btn:disabled {
          opacity: 0.35;
        }
        .rs-move-btn:not(:disabled):hover {
          background: var(--rs-brand-50);
          color: var(--rs-brand);
          border-color: var(--rs-brand);
        }
      `}</style>
    </div>
  );
}
