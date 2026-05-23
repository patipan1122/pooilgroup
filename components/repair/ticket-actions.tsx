"use client";

// Compact action panel for a ticket — scoped to .repair-root design tokens
// (no Tailwind colors). Includes status transitions, assign tech, ETA,
// labor cost editor, and add-part inline form.
// Comment/photo are intentionally NOT here — the .composer at the bottom of
// TicketDetailPanel covers that flow.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  changeStatus,
  assignTechnician,
  addPart,
  setEta,
  setLaborCost,
  updatePartStatus,
} from "@/lib/repair/actions";
import { STATUS_LABELS, STATUS_TRANSITIONS } from "@/lib/repair/types";
import type { RepairTicketStatus, RepairPartStatus } from "@/lib/generated/prisma/enums";
import { Loader2, Plus, Wrench, PackageSearch, Clock, AlertCircle, Coins } from "lucide-react";

// Status transitions that warrant a confirm dialog (irreversible or near-so)
const CONFIRM_TRANSITIONS: Partial<Record<RepairTicketStatus, string>> = {
  CLOSED: "ปิดถาวรแล้วจะ reopen ไม่ได้ · ยืนยัน?",
  CANCELLED: "ยกเลิกใบนี้?",
};

/**
 * Action button label keyed by (from, to). Falls back to STATUS_LABELS[to]
 * if no contextual label. CEO wants the "approval" semantic visible.
 */
function actionLabel(from: RepairTicketStatus, to: RepairTicketStatus): string {
  // Approval semantic — NEW means "report awaiting manager review"
  if (from === "NEW" && to === "ACK") return "อนุมัติซ่อม";
  // Started work
  if (from === "ACK" && to === "IN_PROGRESS") return "เริ่มลงมือซ่อม";
  if (from === "WAITING_PARTS" && to === "IN_PROGRESS") return "อะไหล่ถึงแล้ว · ซ่อมต่อ";
  if (from === "RESOLVED" && to === "IN_PROGRESS") return "เปิดใบใหม่ (ยังไม่หาย)";
  // Resolved
  if (to === "RESOLVED") return "ทำเสร็จแล้ว";
  if (to === "CLOSED") return "ปิดถาวร";
  if (to === "CANCELLED") return "ยกเลิกใบนี้";
  if (to === "WAITING_PARTS") return "รออะไหล่";
  if (to === "NEW" && from === "CANCELLED") return "เปิดใบใหม่อีกครั้ง";
  return STATUS_LABELS[to];
}

interface Technician { id: string; name: string; kind: "INTERNAL" | "VENDOR"; isActive: boolean }

interface Props {
  ticketId: string;
  currentStatus: RepairTicketStatus;
  currentTechId: string | null;
  currentEta: string | null;
  currentLaborCostCents: number;
  technicians: Technician[];
  canAdmin: boolean;
}

export function TicketActions({
  ticketId,
  currentStatus,
  currentTechId,
  currentEta,
  currentLaborCostCents,
  technicians,
  canAdmin,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [techId, setTechId] = useState(currentTechId ?? "");
  const [eta, setEtaInput] = useState(currentEta ? currentEta.slice(0, 16) : "");
  const [laborBaht, setLaborBaht] = useState(Math.round(currentLaborCostCents / 100));

  const [partOpen, setPartOpen] = useState(false);
  const [partName, setPartName] = useState("");
  const [partSpec, setPartSpec] = useState("");
  const [partQty, setPartQty] = useState(1);
  const [partUnit, setPartUnit] = useState("ชิ้น");
  const [partPrice, setPartPrice] = useState(0);

  function run<T extends { ok: boolean; error?: string }>(fn: () => Promise<T>) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "ผิดพลาด");
      router.refresh();
    });
  }

  // Status change with confirm-on-destructive + undo toast on cancel.
  function attemptStatusChange(to: RepairTicketStatus) {
    const confirmMsg = CONFIRM_TRANSITIONS[to];
    if (confirmMsg && typeof window !== "undefined" && !window.confirm(confirmMsg)) {
      return;
    }
    setError(null);
    const previous = currentStatus;
    startTransition(async () => {
      const r = await changeStatus({ ticketId, to });
      if (!r.ok) {
        setError(r.error ?? "ผิดพลาด");
        return;
      }
      router.refresh();
      if (to === "CANCELLED") {
        toast.success(`ยกเลิกใบ ${ticketId.slice(0, 8)}…`, {
          duration: 6000,
          action: {
            label: "เลิกการยกเลิก",
            onClick: () => {
              startTransition(async () => {
                const back = await changeStatus({ ticketId, to: previous });
                if (back.ok) {
                  toast.success("ใบกลับมาเปิดแล้ว");
                  router.refresh();
                }
              });
            },
          },
        });
      } else if (to === "RESOLVED") {
        toast.success("ทำเสร็จแล้ว · จดบันทึกผลการซ่อมในช่องคอมเมนต์ด้านล่างได้");
      }
    });
  }

  function attemptAssign(nextTechId: string | null) {
    setError(null);
    const previousTechId = currentTechId;
    startTransition(async () => {
      const r = await assignTechnician({ ticketId, technicianId: nextTechId });
      if (!r.ok) {
        setError(r.error ?? "ผิดพลาด");
        return;
      }
      router.refresh();
      toast.success(nextTechId ? "มอบหมายช่างแล้ว" : "ปลดช่างแล้ว", {
        duration: 6000,
        action: {
          label: "เลิกทำ",
          onClick: () => {
            startTransition(async () => {
              const back = await assignTechnician({ ticketId, technicianId: previousTechId });
              if (back.ok) {
                setTechId(previousTechId ?? "");
                toast.success("กลับค่าเดิมแล้ว");
                router.refresh();
              }
            });
          },
        },
      });
    });
  }

  const nextStatuses = STATUS_TRANSITIONS[currentStatus] ?? [];
  // Primary action = first non-destructive next status (e.g. NEW → ACK, IN_PROGRESS → RESOLVED)
  const primaryStatus = nextStatuses.find((s) => s !== "CLOSED" && s !== "CANCELLED");
  const secondaryStatuses = nextStatuses.filter((s) => s !== primaryStatus);

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 12,
    }}>
      {error && (
        <div style={{
          background: "#FEF2F2", border: "1px solid #FECACA",
          borderRadius: 8, padding: "6px 9px",
          display: "flex", gap: 6, alignItems: "flex-start",
          color: "#991B1B", fontSize: 11.5,
        }}>
          <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}

      {/* Primary + secondary status transitions */}
      {nextStatuses.length > 0 && (
        <div>
          <div className="detail-side-label">เปลี่ยนสถานะ</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {primaryStatus && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => attemptStatusChange(primaryStatus)}
                className="btn btn-primary"
                style={{ fontWeight: 600 }}
              >
                {actionLabel(currentStatus, primaryStatus)}
              </button>
            )}
            {secondaryStatuses.map((s) => {
              if (s === "CLOSED" && !canAdmin) return null;
              const isDestructive = s === "CLOSED" || s === "CANCELLED";
              return (
                <button
                  key={s}
                  type="button"
                  disabled={isPending}
                  onClick={() => attemptStatusChange(s)}
                  className="btn"
                  style={isDestructive ? {
                    background: "#fff",
                    borderColor: "#FECACA",
                    color: "var(--bad)",
                  } : undefined}
                >
                  {actionLabel(currentStatus, s)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Assign technician */}
      <div>
        <div className="detail-side-label">ช่างที่ดูแล</div>
        <div style={{ display: "flex", gap: 6 }}>
          <select
            value={techId}
            onChange={(e) => setTechId(e.target.value)}
            style={{
              flex: 1, height: 32,
              padding: "0 8px", borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--surface)",
              fontSize: 12, fontFamily: "inherit",
              color: "var(--ink-900)",
              outline: "none",
            }}
          >
            <option value="">— ไม่มอบหมาย —</option>
            {technicians.filter((t) => t.isActive).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.kind === "INTERNAL" ? "ใน" : "นอก"})
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={isPending || techId === (currentTechId ?? "")}
            onClick={() => attemptAssign(techId || null)}
            className="btn btn-primary"
            style={{ flexShrink: 0 }}
          >
            <Wrench /> บันทึก
          </button>
        </div>
      </div>

      {/* ETA */}
      <div>
        <div className="detail-side-label">ETA (วันเวลาที่คาดว่าจะเสร็จ)</div>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            type="datetime-local"
            value={eta}
            onChange={(e) => setEtaInput(e.target.value)}
            style={{
              flex: 1, height: 32,
              padding: "0 8px", borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--surface)",
              fontSize: 12, fontFamily: "inherit",
              color: "var(--ink-900)",
              outline: "none",
            }}
          />
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => setEta({ ticketId, etaAt: eta || null }))}
            className="btn btn-primary"
            style={{ flexShrink: 0 }}
          >
            <Clock /> บันทึก
          </button>
        </div>
      </div>

      {/* Labor cost — manual entry, separate from parts */}
      <div>
        <div className="detail-side-label">ค่าแรง + เดินทาง (บาท)</div>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            type="number"
            min={0}
            step={1}
            value={laborBaht}
            onChange={(e) => setLaborBaht(Math.max(0, parseInt(e.target.value || "0", 10)))}
            placeholder="0"
            style={{
              flex: 1, height: 32,
              padding: "0 8px", borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--surface)",
              fontSize: 12, fontFamily: "var(--font-num)",
              color: "var(--ink-900)",
              outline: "none",
            }}
          />
          <button
            type="button"
            disabled={isPending || laborBaht * 100 === currentLaborCostCents}
            onClick={() => run(() => setLaborCost({
              ticketId,
              laborCostCents: laborBaht * 100,
            }))}
            className="btn btn-primary"
            style={{ flexShrink: 0 }}
          >
            <Coins /> บันทึก
          </button>
        </div>
      </div>

      {/* Add part */}
      <div>
        <div className="detail-side-label">เพิ่มอะไหล่</div>
        {!partOpen ? (
          <button
            type="button"
            onClick={() => setPartOpen(true)}
            className="btn"
            style={{ width: "100%", justifyContent: "center" }}
          >
            <PackageSearch /> <Plus /> เพิ่มรายการอะไหล่
          </button>
        ) : (
          <div style={{
            background: "var(--surface)", border: "1px solid var(--line)",
            borderRadius: 8, padding: 8,
            display: "flex", flexDirection: "column", gap: 6,
          }}>
            <input
              value={partName}
              onChange={(e) => setPartName(e.target.value)}
              placeholder="ชื่ออะไหล่"
              style={partInputStyle}
              required
            />
            <input
              value={partSpec}
              onChange={(e) => setPartSpec(e.target.value)}
              placeholder="spec (เช่น 35µF 440V)"
              style={partInputStyle}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <input
                type="number"
                min={1}
                value={partQty}
                onChange={(e) => setPartQty(Math.max(1, parseInt(e.target.value || "1", 10)))}
                placeholder="จำนวน"
                style={partInputStyle}
              />
              <input
                value={partUnit}
                onChange={(e) => setPartUnit(e.target.value)}
                placeholder="หน่วย"
                style={partInputStyle}
              />
            </div>
            <input
              type="number"
              min={0}
              step={1}
              value={partPrice}
              onChange={(e) => setPartPrice(Math.max(0, parseInt(e.target.value || "0", 10)))}
              placeholder="ราคา/หน่วย (บาท)"
              style={partInputStyle}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                disabled={isPending || partName.trim().length === 0}
                onClick={() => {
                  run(async () => {
                    const r = await addPart({
                      ticketId,
                      name: partName.trim(),
                      spec: partSpec.trim() || undefined,
                      quantity: partQty,
                      unit: partUnit,
                      unitPriceCents: Math.round(partPrice * 100),
                    });
                    if (r.ok) {
                      setPartName("");
                      setPartSpec("");
                      setPartQty(1);
                      setPartPrice(0);
                      setPartOpen(false);
                    }
                    return r;
                  });
                }}
                className="btn btn-primary"
                style={{ flex: 1, justifyContent: "center" }}
              >
                บันทึกอะไหล่
              </button>
              <button
                type="button"
                onClick={() => setPartOpen(false)}
                className="btn"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        )}
      </div>

      {isPending && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          color: "var(--ink-500)", fontSize: 11,
        }}>
          <Loader2 size={12} className="rf-spin" /> กำลังบันทึก…
        </div>
      )}
    </div>
  );
}

const partInputStyle: React.CSSProperties = {
  height: 30,
  padding: "0 8px",
  borderRadius: 6,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  fontSize: 12,
  fontFamily: "inherit",
  color: "var(--ink-900)",
  outline: "none",
};

/** Exposed for parts queue page — toggle a part's status */
export function PartStatusButtons({
  partId,
  current,
}: {
  partId: string;
  current: RepairPartStatus;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const next: { label: string; to: RepairPartStatus }[] = [];
  if (current === "NEEDED") next.push({ label: "สั่งแล้ว", to: "ORDERED" });
  if (current === "ORDERED") next.push({ label: "ของถึง", to: "DELIVERED" });
  if (current === "DELIVERED") next.push({ label: "ติดตั้ง", to: "INSTALLED" });
  if (current !== "CANCELLED" && current !== "INSTALLED")
    next.push({ label: "ยกเลิก", to: "CANCELLED" });

  if (next.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      {next.map((n) => {
        const isDestructive = n.to === "CANCELLED";
        return (
          <button
            key={n.to}
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                await updatePartStatus({ partId, status: n.to });
                router.refresh();
              })
            }
            className="btn btn-sm"
            style={{
              padding: "2px 7px",
              fontSize: 10.5,
              ...(isDestructive ? {
                background: "#fff",
                borderColor: "#FECACA",
                color: "var(--bad)",
              } : undefined),
            }}
          >
            → {n.label}
          </button>
        );
      })}
    </span>
  );
}
