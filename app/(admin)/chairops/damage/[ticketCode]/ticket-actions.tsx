"use client";

// Sidebar action panel for damage ticket detail
// Server actions invoked with useTransition · toast feedback
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChairopsTicketStatus, ChairopsUserRole } from "@/lib/generated/prisma/enums";
import { assignTicket, updateStatus, useParts, closeTicket } from "./actions";

interface PartLite {
  id: string;
  partCode: string;
  name: string;
  unit: string;
  stockOnHand: number;
}

interface Props {
  code: string;
  status: ChairopsTicketStatus;
  assignedToId: string | null;
  actorRole: ChairopsUserRole;
  technicians: { id: string; displayName: string }[];
  parts: PartLite[];
  isClosed: boolean;
}

const NEXT_STATUS: Record<ChairopsTicketStatus, { value: ChairopsTicketStatus; label: string }[]> = {
  OPEN: [
    { value: "IN_PROGRESS", label: "เริ่มซ่อม" },
    { value: "CANCELLED", label: "ยกเลิก" },
  ],
  ASSIGNED: [
    { value: "IN_PROGRESS", label: "เริ่มซ่อม" },
    { value: "WAITING_PARTS", label: "รออะไหล่" },
    { value: "CANCELLED", label: "ยกเลิก" },
  ],
  IN_PROGRESS: [
    { value: "WAITING_PARTS", label: "รออะไหล่" },
    { value: "DONE", label: "เสร็จ" },
  ],
  WAITING_PARTS: [
    { value: "IN_PROGRESS", label: "กลับมาซ่อม" },
    { value: "DONE", label: "เสร็จ" },
  ],
  DONE: [],
  CANCELLED: [],
};

export function TicketActions({
  code,
  status,
  assignedToId,
  actorRole,
  technicians,
  parts,
  isClosed,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [assignee, setAssignee] = useState(assignedToId ?? "");
  const [partRows, setPartRows] = useState<{ partId: string; qty: number }[]>([
    { partId: "", qty: 1 },
  ]);
  const [closeNotes, setCloseNotes] = useState("");

  const canAssign = actorRole === "MANAGER" || actorRole === "CEO" || actorRole === "ADMIN";

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) toast.success(success);
      else toast.error(r.error ?? "ทำงานไม่สำเร็จ");
    });
  }

  function addPartRow() {
    setPartRows((rows) => [...rows, { partId: "", qty: 1 }]);
  }
  function removePartRow(i: number) {
    setPartRows((rows) => rows.filter((_, idx) => idx !== i));
  }
  function updatePartRow(i: number, patch: Partial<{ partId: string; qty: number }>) {
    setPartRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  return (
    <>
      {canAssign && !isClosed && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ผู้รับผิดชอบ</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              disabled={isPending}
              className="h-10 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">— เลือกช่าง —</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.displayName}
                </option>
              ))}
            </select>
            <Button
              type="button"
              disabled={!assignee || isPending}
              onClick={() => run(() => assignTicket(code, assignee), "มอบหมายเรียบร้อย")}
              className="w-full"
            >
              {isPending ? "กำลังบันทึก..." : "มอบหมาย"}
            </Button>
          </CardBody>
        </Card>
      )}

      {!isClosed && NEXT_STATUS[status].length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">เปลี่ยนสถานะ</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {NEXT_STATUS[status].map((opt) => (
              <Button
                key={opt.value}
                type="button"
                variant={opt.value === "DONE" ? "primary" : opt.value === "CANCELLED" ? "danger" : "outline"}
                disabled={isPending}
                onClick={() =>
                  run(
                    () => updateStatus(code, opt.value),
                    `เปลี่ยนเป็น "${opt.label}" แล้ว`
                  )
                }
                className="w-full"
              >
                {opt.label}
              </Button>
            ))}
          </CardBody>
        </Card>
      )}

      {!isClosed && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ใช้อะไหล่</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {partRows.map((row, i) => (
              <div key={i} className="flex gap-2">
                <select
                  value={row.partId}
                  onChange={(e) => updatePartRow(i, { partId: e.target.value })}
                  disabled={isPending}
                  className="h-10 flex-1 rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="">— เลือกอะไหล่ —</option>
                  {parts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.partCode} · {p.name} (เหลือ {p.stockOnHand})
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  value={row.qty}
                  onChange={(e) =>
                    updatePartRow(i, { qty: parseInt(e.target.value, 10) || 1 })
                  }
                  disabled={isPending}
                  className="h-10 w-20 rounded-md border border-border bg-background px-2 text-sm"
                />
                {partRows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removePartRow(i)}
                    className="h-10 rounded-md border border-border px-2 text-xs hover:bg-muted"
                  >
                    ลบ
                  </button>
                )}
              </div>
            ))}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addPartRow}
                disabled={isPending}
              >
                + เพิ่มอะไหล่
              </Button>
              <Button
                type="button"
                disabled={isPending || partRows.some((r) => !r.partId)}
                onClick={() =>
                  run(
                    () => useParts(code, partRows.filter((r) => r.partId)),
                    "บันทึกการใช้อะไหล่แล้ว"
                  )
                }
                className="ml-auto"
              >
                บันทึก
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {!isClosed && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ปิดงาน</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            <textarea
              value={closeNotes}
              onChange={(e) => setCloseNotes(e.target.value)}
              placeholder="บันทึกการแก้ไข (เช่น เปลี่ยนมอเตอร์เสร็จ ทดสอบใช้งานปกติ)"
              rows={3}
              disabled={isPending}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <Button
              type="button"
              variant="primary"
              disabled={isPending}
              onClick={() => run(() => closeTicket(code, closeNotes), "ปิดงานเรียบร้อย")}
              className="w-full"
            >
              {isPending ? "กำลังปิด..." : "ปิดงาน (Done)"}
            </Button>
          </CardBody>
        </Card>
      )}
    </>
  );
}
