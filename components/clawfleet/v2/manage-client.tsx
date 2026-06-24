"use client";

/**
 * ClawFleet v2 — Manage client island (สาขา + ตู้ CRUD).
 *
 * แต่ละการ์ดสาขา = ชื่อ + จำนวนตู้ + ปุ่ม เปลี่ยนชื่อ / ลบ / + เพิ่มตู้ + กางดูตู้.
 * ปุ่มบนหัว "+ เพิ่มสาขา" เปิดฟอร์ม. ทุกปุ่มต่อ server action จริง (no dead onClick)
 * ผ่าน useTransition (pending state). ยืนยันก่อนลบ. ใช้คลาส .cf-* (token-driven).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ic, Pill } from "@/components/clawfleet/v2/chrome";
import {
  createBranch,
  renameBranch,
  deleteBranch,
  createCfMachine,
  renameCfMachine,
  retireCfMachine,
} from "@/lib/clawfleet/v2-actions";
import type { ManageBranch, ManageMachine } from "@/lib/clawfleet/v2-queries";

type Toast = { kind: "ok" | "err"; text: string };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="cf-field">
      <span className="cf-field-label">{label}</span>
      {children}
    </label>
  );
}

export function ManageClient({ branches }: { branches: ManageBranch[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<Toast | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // modal state — only one open at a time
  const [modal, setModal] = useState<
    | { type: "addBranch" }
    | { type: "renameBranch"; branch: ManageBranch }
    | { type: "addMachine"; branch: ManageBranch }
    | { type: "renameMachine"; branch: ManageBranch; machine: ManageMachine }
    | null
  >(null);

  const totalMachines = branches.reduce((s, b) => s + b.machineCount, 0);

  function flash(t: Toast) {
    setToast(t);
    setTimeout(() => setToast(null), 2600);
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** wrap an action call: run in transition, toast result, refresh on ok */
  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    okText: string,
    onOk?: () => void,
  ) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        flash({ kind: "ok", text: okText });
        onOk?.();
        router.refresh();
      } else {
        flash({ kind: "err", text: res.error ?? "ไม่สำเร็จ" });
      }
    });
  }

  function onDeleteBranch(b: ManageBranch) {
    const msg =
      b.machineCount > 0
        ? `สาขา "${b.name}" มีตู้ ${b.machineCount} ตู้ — จะปิดใช้งาน (ซ่อน) ไม่ลบประวัติ ยืนยันไหม?`
        : `ลบสาขา "${b.name}" ถาวร? (สาขานี้ยังไม่มีตู้/รอบเก็บ)`;
    if (!window.confirm(msg)) return;
    run(() => deleteBranch(b.id), "ลบ/ปิดสาขาแล้ว");
  }

  function onRetireMachine(_b: ManageBranch, m: ManageMachine) {
    if (!window.confirm(`ปลดระวางตู้ "${m.nickname || m.code}"? ตู้จะถูกซ่อนจากรายการ`)) return;
    run(() => retireCfMachine(m.id), "ปลดระวางตู้แล้ว");
  }

  return (
    <div className="cf-page">
      <div className="cf-page-head">
        <div>
          <div className="cf-eyebrow">จัดการ</div>
          <h1 className="cf-h1">สาขา &amp; ตู้</h1>
          <div className="cf-page-sub">
            {branches.length} สาขา · {totalMachines} ตู้ทั้งหมด
          </div>
        </div>
        <button
          className="cf-btn cf-btn-primary"
          onClick={() => setModal({ type: "addBranch" })}
          disabled={pending}
        >
          <Ic name="plus" size={14} /> เพิ่มสาขา
        </button>
      </div>

      {branches.length === 0 && (
        <div className="cf-manage-card cf-manage-empty">
          <div className="cf-manage-empty-sub">ยังไม่มีสาขาตู้คีบ — เริ่มจากเพิ่มสาขาแรก</div>
          <button className="cf-btn cf-btn-primary" onClick={() => setModal({ type: "addBranch" })}>
            <Ic name="plus" size={14} /> เพิ่มสาขา
          </button>
        </div>
      )}

      <div className="cf-manage-grid">
        {branches.map((b) => {
          const isOpen = expanded.has(b.id);
          return (
            <div key={b.id} className="cf-manage-card">
              <div className="cf-manage-card-head">
                <div className={`cf-branch-flag cf-branch-flag-${b.tone}`}>{b.avatar}</div>
                <div className="cf-fleet-card-id">
                  <div className="cf-fleet-card-name">{b.name}</div>
                  <div className="cf-fleet-card-meta">
                    {b.area} · {b.code}
                  </div>
                </div>
                <Pill color="slate" size="sm">
                  {b.machineCount} ตู้
                </Pill>
              </div>

              <div className="cf-manage-card-actions">
                <button
                  className="cf-btn cf-btn-ghost cf-btn-sm"
                  onClick={() => setModal({ type: "renameBranch", branch: b })}
                  disabled={pending}
                >
                  เปลี่ยนชื่อ
                </button>
                <button
                  className="cf-btn cf-btn-ghost cf-btn-sm"
                  onClick={() => onDeleteBranch(b)}
                  disabled={pending}
                >
                  ลบ
                </button>
                <button
                  className="cf-btn cf-btn-primary cf-btn-sm"
                  onClick={() => setModal({ type: "addMachine", branch: b })}
                  disabled={pending}
                >
                  <Ic name="plus" size={12} /> เพิ่มตู้
                </button>
              </div>

              <button
                className="cf-btn cf-btn-ghost cf-btn-sm cf-manage-expand"
                onClick={() => toggleExpand(b.id)}
              >
                <Ic name={isOpen ? "chevronD" : "chevronR"} size={14} />
                {isOpen ? "ซ่อนตู้" : `ดูตู้ (${b.machineCount})`}
              </button>

              {isOpen && (
                <div className="cf-manage-mlist">
                  {b.machines.length === 0 && (
                    <div className="cf-manage-mempty">ยังไม่มีตู้ในสาขานี้</div>
                  )}
                  {b.machines.map((m) => (
                    <div key={m.id} className="cf-manage-mrow">
                      <div className="cf-manage-mrow-id">
                        <div className="cf-manage-mrow-name">{m.nickname || m.code}</div>
                        <div className="cf-manage-mrow-meta">
                          {m.code} · {m.kind === "CLAW" ? "ตู้คีบ" : "ตู้แลกเหรียญ"}
                        </div>
                      </div>
                      <button
                        className="cf-btn cf-btn-ghost cf-btn-sm"
                        onClick={() => setModal({ type: "renameMachine", branch: b, machine: m })}
                        disabled={pending}
                      >
                        เปลี่ยนชื่อ
                      </button>
                      <button
                        className="cf-btn cf-btn-ghost cf-btn-sm"
                        onClick={() => onRetireMachine(b, m)}
                        disabled={pending}
                      >
                        ปลดระวาง
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ===== modals ===== */}
      {modal?.type === "addBranch" && (
        <BranchForm
          title="เพิ่มสาขาใหม่"
          submitLabel="เพิ่มสาขา"
          pending={pending}
          onClose={() => setModal(null)}
          onSubmit={(v) => run(() => createBranch(v), "เพิ่มสาขาแล้ว", () => setModal(null))}
        />
      )}
      {modal?.type === "renameBranch" && (
        <BranchForm
          title={`เปลี่ยนชื่อสาขา · ${modal.branch.name}`}
          submitLabel="บันทึก"
          pending={pending}
          initial={{ name: modal.branch.name, code: modal.branch.code }}
          onClose={() => setModal(null)}
          onSubmit={(v) =>
            run(
              () => renameBranch(modal.branch.id, { name: v.name, code: v.code }),
              "บันทึกแล้ว",
              () => setModal(null),
            )
          }
        />
      )}
      {modal?.type === "addMachine" && (
        <MachineForm
          title={`เพิ่มตู้ · ${modal.branch.name}`}
          submitLabel="เพิ่มตู้"
          pending={pending}
          onClose={() => setModal(null)}
          onSubmit={(v) =>
            run(
              () => createCfMachine({ branchId: modal.branch.id, ...v }),
              "เพิ่มตู้แล้ว",
              () => setModal(null),
            )
          }
        />
      )}
      {modal?.type === "renameMachine" && (
        <MachineForm
          title={`เปลี่ยนชื่อตู้ · ${modal.machine.code}`}
          submitLabel="บันทึก"
          pending={pending}
          initial={{
            code: modal.machine.code,
            nickname: modal.machine.nickname ?? "",
            kind: modal.machine.kind,
          }}
          onClose={() => setModal(null)}
          onSubmit={(v) =>
            run(() => renameCfMachine(modal.machine.id, v), "บันทึกแล้ว", () => setModal(null))
          }
        />
      )}

      {toast && (
        <div className={`cf-toast cf-toast-${toast.kind === "ok" ? "approve" : "escalate"}`}>
          <span className="cf-toast-icon">{toast.kind === "ok" ? "✓" : "⚠"}</span>
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}

/* ---------------- branch add/rename form ---------------- */
function BranchForm({
  title,
  submitLabel,
  pending,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  pending: boolean;
  initial?: { name: string; code: string };
  onClose: () => void;
  onSubmit: (v: { name: string; code: string; province?: string }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  const [province, setProvince] = useState("");
  const valid = name.trim().length > 0 && code.trim().length > 0;

  return (
    <div className="cf-modal-overlay" onClick={onClose}>
      <div className="cf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cf-modal-head">
          <h3 className="cf-modal-title">{title}</h3>
          <button className="cf-btn cf-btn-ghost cf-btn-sm" onClick={onClose}>
            <Ic name="x" size={14} />
          </button>
        </div>
        <Field label="ชื่อสาขา">
          <input
            className="cf-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="เช่น ปตท. จักราช"
            autoFocus
          />
        </Field>
        <Field label="รหัสสาขา (ไม่ซ้ำ)">
          <input
            className="cf-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="เช่น CTP"
          />
        </Field>
        {!initial && (
          <Field label="จังหวัด (ไม่บังคับ)">
            <input
              className="cf-input"
              value={province}
              onChange={(e) => setProvince(e.target.value)}
              placeholder="เช่น นครราชสีมา"
            />
          </Field>
        )}
        <div className="cf-modal-actions">
          <button className="cf-btn cf-btn-ghost" onClick={onClose} disabled={pending}>
            ยกเลิก
          </button>
          <button
            className="cf-btn cf-btn-primary"
            disabled={!valid || pending}
            onClick={() =>
              onSubmit({
                name: name.trim(),
                code: code.trim(),
                province: province.trim() || undefined,
              })
            }
          >
            {pending ? "กำลังบันทึก…" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- machine add/rename form ---------------- */
function MachineForm({
  title,
  submitLabel,
  pending,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  pending: boolean;
  initial?: { code: string; nickname: string; kind: "CLAW" | "EXCHANGER" };
  onClose: () => void;
  onSubmit: (v: { code: string; nickname?: string; kind: "CLAW" | "EXCHANGER" }) => void;
}) {
  const [code, setCode] = useState(initial?.code ?? "");
  const [nickname, setNickname] = useState(initial?.nickname ?? "");
  const [kind, setKind] = useState<"CLAW" | "EXCHANGER">(initial?.kind ?? "CLAW");
  const valid = code.trim().length > 0;

  return (
    <div className="cf-modal-overlay" onClick={onClose}>
      <div className="cf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cf-modal-head">
          <h3 className="cf-modal-title">{title}</h3>
          <button className="cf-btn cf-btn-ghost cf-btn-sm" onClick={onClose}>
            <Ic name="x" size={14} />
          </button>
        </div>
        <Field label="ชื่อตู้ (nickname · ไม่บังคับ)">
          <input
            className="cf-input"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="เช่น ตู้มุมหน้าร้าน"
            autoFocus
          />
        </Field>
        <Field label="รหัสตู้ (ไม่ซ้ำ)">
          <input
            className="cf-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="เช่น CW-001"
          />
        </Field>
        <Field label="ประเภท">
          <select
            className="cf-input"
            value={kind}
            onChange={(e) => setKind(e.target.value as "CLAW" | "EXCHANGER")}
          >
            <option value="CLAW">ตู้คีบ (CLAW)</option>
            <option value="EXCHANGER">ตู้แลกเหรียญ (EXCHANGER)</option>
          </select>
        </Field>
        <div className="cf-modal-actions">
          <button className="cf-btn cf-btn-ghost" onClick={onClose} disabled={pending}>
            ยกเลิก
          </button>
          <button
            className="cf-btn cf-btn-primary"
            disabled={!valid || pending}
            onClick={() =>
              onSubmit({ code: code.trim(), nickname: nickname.trim() || undefined, kind })
            }
          >
            {pending ? "กำลังบันทึก…" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
