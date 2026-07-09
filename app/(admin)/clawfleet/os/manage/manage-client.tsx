"use client";

/**
 * ตู้คีบ OS — หน้า "จัดการ" (management hub · client UI).
 * ที่เดียวจบ: CRUD สาขา + CRUD/ย้าย/ปลด ตู้ + ดูรายละเอียด+ประวัติตู้ + คลังประจำสาขา.
 * Wire เฉพาะ action ที่มีอยู่แล้ว (createBranch/renameBranch/deleteBranch/
 * createCfMachine/renameCfMachine/retireCfMachine/reassignCfMachineBranch) —
 * server assert สิทธิ์เองทุกตัว · หน้านี้อยู่หลัง admin-gate อยู่แล้ว.
 * ใช้ kit + clawos tokens เดิม (ไม่มีสี/คอมโพเนนต์ใหม่).
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Store, Cpu, Plus, Pencil, Trash2, Truck, PackageOpen, ChevronRight, Search,
  AlertTriangle, PowerOff, History, Boxes, ArrowRight, Package,
} from "lucide-react";
import { Card, Modal, Pill, IconBox, Kpi, EmptyState } from "@/components/clawfleet/os/kit";
import { baht, bahtN, num, type Tone } from "@/components/clawfleet/os/format";
import {
  createBranch, renameBranch, deleteBranch,
  createCfMachine, renameCfMachine, retireCfMachine, reassignCfMachineBranch,
} from "@/lib/clawfleet/actions";
import { loadMachineDetail } from "./manage-detail-action";
import type { MachineDetailData } from "@/lib/clawfleet/manage-queries";

/* ───────────────────────── types (view-models จาก server) ───────────────────────── */
export type MachineKind = "CLAW" | "EXCHANGER";
export type ManageMachineVM = {
  id: string;
  code: string;
  nickname: string | null;
  kind: MachineKind;
  isActive: boolean;
  awaitingSetup: boolean; // ⚪ ยังไม่ตั้งค่าครั้งแรก (baseline)
};
export type BranchStockVM = {
  branchId: string;
  skuCount: number;
  lowCount: number;
  inventoryValueCents: number;
};
export type ManageBranchVM = {
  id: string;
  name: string;
  code: string;
  area: string;
  manager: string;
  machineCount: number;
  machines: ManageMachineVM[];
  stock: BranchStockVM | null;
};
export type MachineOption = { id: string; code: string; nickname: string | null; branchId: string; branchName: string; isActive: boolean };
export type BranchOption = { id: string; name: string; code: string };

/* ───────────────────────── shared field styles (ตรงกับ branches-client) ───────────────────────── */
const FIELD: React.CSSProperties = { width: "100%", fontSize: 13, padding: "10px 12px", borderRadius: 10, border: "1px solid #E3E6EA", background: "#fff", color: "#1A1D21", outline: "none" };
const LABEL: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#5A6270", marginBottom: 6, display: "block" };
const BRAND = "#4F46E5";

function PrimaryBtn({ children, onClick, disabled, full }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; full?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="co-tap"
      style={{ flex: full ? 1 : undefined, border: "none", cursor: disabled ? "wait" : "pointer", background: disabled ? "#A5A0EC" : BRAND, color: "#fff", fontSize: 13.5, fontWeight: 700, padding: full ? "11px 0" : "9px 15px", borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, whiteSpace: "nowrap" }}>
      {children}
    </button>
  );
}
function GhostBtn({ children, onClick, disabled, tone = "neutral" }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; tone?: "neutral" | "danger" }) {
  const danger = tone === "danger";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="co-tap"
      style={{ border: `1px solid ${danger ? "#F0CFCB" : "#E3E6EA"}`, background: "#fff", cursor: disabled ? "not-allowed" : "pointer", color: danger ? "#B42318" : "#5A6270", fontSize: 12.5, fontWeight: 600, padding: "8px 13px", borderRadius: 9, display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
      {children}
    </button>
  );
}
function ErrBox({ msg }: { msg: string }) {
  return <div style={{ background: "#FCEDEC", border: "1px solid #F5C6C2", borderRadius: 9, padding: "9px 12px", fontSize: 12.5, color: "#B42318" }}>{msg}</div>;
}

/* status dot ตู้ — ⚪ awaiting = เทา (ห้ามแดง) · retired = เทาเข้ม · active = เขียว */
function machineDot(m: ManageMachineVM): { bg: string; label: string; tone: Tone } {
  if (!m.isActive) return { bg: "#B9BEC7", label: "ปลดระวางแล้ว", tone: "neutral" };
  if (m.awaitingSetup) return { bg: "#C7CBD2", label: "รอตั้งค่าครั้งแรก", tone: "neutral" };
  return { bg: "#2FA866", label: "ใช้งาน", tone: "green" };
}

/* ═══════════════════════════════ ROOT ═══════════════════════════════ */
export function ManageClient({
  branches,
  machineOptions,
  branchOptions,
}: {
  branches: ManageBranchVM[];
  machineOptions: MachineOption[];
  branchOptions: BranchOption[];
}) {
  const router = useRouter();
  const isEmpty = branches.length === 0;

  // ── modal state (ก้อนเดียว · discriminated) ──
  type ModalState =
    | { t: "none" }
    | { t: "createBranch" }
    | { t: "renameBranch"; b: ManageBranchVM }
    | { t: "deleteBranch"; b: ManageBranchVM }
    | { t: "createMachine"; branchId?: string }
    | { t: "editMachine"; m: ManageMachineVM }
    | { t: "reassignMachine"; m: ManageMachineVM }
    | { t: "retireMachine"; m: ManageMachineVM }
    | { t: "detail"; m: ManageMachineVM; branchName: string };
  const [modal, setModal] = useState<ModalState>({ t: "none" });
  const close = () => setModal({ t: "none" });
  const refresh = () => router.refresh();

  // flatten machines (+ ชื่อสาขา) สำหรับ ตู้ section
  const allMachines = useMemo(
    () => branches.flatMap((b) => b.machines.map((m) => ({ ...m, branchId: b.id, branchName: b.name, branchCode: b.code }))),
    [branches],
  );

  // ── search / filter ──
  const [branchQ, setBranchQ] = useState("");
  const [machineQ, setMachineQ] = useState("");
  const [machineBranchFilter, setMachineBranchFilter] = useState<string>("");

  const filteredBranches = useMemo(() => {
    const q = branchQ.trim().toLowerCase();
    if (!q) return branches;
    return branches.filter((b) => b.name.toLowerCase().includes(q) || b.code.toLowerCase().includes(q));
  }, [branches, branchQ]);

  const filteredMachines = useMemo(() => {
    const q = machineQ.trim().toLowerCase();
    return allMachines.filter((m) => {
      if (machineBranchFilter && m.branchId !== machineBranchFilter) return false;
      if (!q) return true;
      return m.code.toLowerCase().includes(q) || (m.nickname ?? "").toLowerCase().includes(q) || m.branchName.toLowerCase().includes(q);
    });
  }, [allMachines, machineQ, machineBranchFilter]);

  // summary
  const totBranches = branches.length;
  const totMachines = allMachines.length;
  const totAwaiting = allMachines.filter((m) => m.isActive && m.awaitingSetup).length;
  const totLow = branches.reduce((s, b) => s + (b.stock?.lowCount ?? 0), 0);

  return (
    <div>
      {/* ── header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.3px" }}>จัดการ · ตู้ / สาขา / คลัง</div>
          <div style={{ fontSize: 12.5, color: "#9AA1AB", marginTop: 2 }}>ที่เดียวจบ — เพิ่ม/แก้/ลบ สาขา · เพิ่ม/แก้/ย้าย/ปลด ตู้ · ดูประวัติตู้ · คลังประจำสาขา</div>
        </div>
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
          <PrimaryBtn onClick={() => setModal({ t: "createBranch" })}><Plus size={15} /> เพิ่มสาขา</PrimaryBtn>
          <PrimaryBtn onClick={() => setModal({ t: "createMachine" })} disabled={branches.length === 0}><Plus size={15} /> เพิ่มตู้</PrimaryBtn>
        </div>
      </div>

      {isEmpty ? (
        <Card>
          <EmptyState
            icon={<Store size={40} />}
            title="ยังไม่มีสาขาในระบบ"
            sub="เริ่มจากกด “เพิ่มสาขา” ด้านบน แล้วค่อยเพิ่มตู้เข้าไปในแต่ละสาขา — ทุกอย่างจัดการที่หน้านี้ที่เดียว"
          />
        </Card>
      ) : (
        <>
          {/* ── summary KPIs ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-5">
            <Kpi icon={<Store size={16} />} label="สาขาทั้งหมด" value={`${num(totBranches)} สาขา`} delta="ตู้คีบ" deltaColor="#9AA1AB" />
            <Kpi icon={<Boxes size={16} />} iconTone="neutral" label="ตู้ทั้งหมด" value={`${num(totMachines)} ตู้`} delta={`${totBranches} สาขา`} deltaColor="#9AA1AB" />
            <Kpi icon={<Cpu size={16} />} iconTone="neutral" label="ตู้รอตั้งค่าครั้งแรก" value={`${num(totAwaiting)} ตู้`} valueColor={totAwaiting > 0 ? "#6B7280" : "#15803D"} delta={totAwaiting > 0 ? "⚪ ยังไม่ล็อก baseline" : "ล็อกครบแล้ว"} deltaColor="#9AA1AB" />
            <Kpi icon={<AlertTriangle size={16} />} iconTone={totLow > 0 ? "amber" : "green"} label="สินค้าใกล้หมด (ทุกสาขา)" value={`${num(totLow)} รายการ`} valueColor={totLow > 0 ? "#B45309" : "#15803D"} delta="รวมคลังทุกสาขา" deltaColor="#9AA1AB" />
          </div>

          {/* ══════════ สาขา ══════════ */}
          <Card
            title="สาขา"
            sub="รายชื่อสาขาตู้คีบ · จำนวนตู้ · แก้ชื่อ/ลบ"
            right={
              <SearchBox value={branchQ} onChange={setBranchQ} placeholder="ค้นหาสาขา…" />
            }
            pad={false}
          >
            {filteredBranches.length === 0 ? (
              <EmptyState title="ไม่พบสาขาที่ค้นหา" sub="ลองพิมพ์ชื่อหรือรหัสสาขาอื่น" />
            ) : (
              <div>
                {filteredBranches.map((b) => (
                  <div key={b.id} className="co-rowh" style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 20px", borderBottom: "1px solid #F4F5F7", flexWrap: "wrap" }}>
                    <IconBox tone="neutral" size={40} radius={10} bg="#F1F2F7" color={BRAND}>
                      <span className="num" style={{ fontSize: 13, fontWeight: 700 }}>{b.code}</span>
                    </IconBox>
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 700 }}>{b.name}</div>
                      <div style={{ fontSize: 11.5, color: "#9AA1AB" }}>
                        <span className="num">{b.machineCount}</span> ตู้ · {b.area}{b.manager && b.manager !== "—" ? ` · ผจก. ${b.manager}` : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <GhostBtn onClick={() => setModal({ t: "renameBranch", b })}><Pencil size={13} /> แก้ชื่อ</GhostBtn>
                      <GhostBtn tone="danger" onClick={() => setModal({ t: "deleteBranch", b })}><Trash2 size={13} /> ลบ</GhostBtn>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* ══════════ ตู้ ══════════ */}
          <div style={{ marginTop: 18 }}>
            <Card
              title="ตู้"
              sub="ตู้ทุกสาขา · แก้ชื่อ/รหัส · ย้ายสาขา · ปลดระวาง · ดูประวัติ"
              right={
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <select aria-label="กรองตามสาขา" value={machineBranchFilter} onChange={(e) => setMachineBranchFilter(e.target.value)}
                    style={{ ...FIELD, width: "auto", padding: "8px 10px", fontSize: 12.5 }}>
                    <option value="">ทุกสาขา</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
                  </select>
                  <SearchBox value={machineQ} onChange={setMachineQ} placeholder="ค้นหาตู้…" />
                </div>
              }
              pad={false}
            >
              {filteredMachines.length === 0 ? (
                <EmptyState
                  icon={<Cpu size={34} />}
                  title={allMachines.length === 0 ? "ยังไม่มีตู้ในระบบ" : "ไม่พบตู้ที่ค้นหา/กรอง"}
                  sub={allMachines.length === 0 ? "กด “เพิ่มตู้” ด้านบนเพื่อลงทะเบียนตู้เข้าสาขา" : "ลองเปลี่ยนคำค้นหรือสาขาที่กรอง"}
                />
              ) : (
                <div>
                  {filteredMachines.map((m) => {
                    const dot = machineDot(m);
                    return (
                      <div key={m.id} className="co-rowh" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderBottom: "1px solid #F4F5F7", flexWrap: "wrap" }}>
                        <span title={dot.label} style={{ width: 11, height: 11, borderRadius: 4, background: dot.bg, flex: "0 0 11px", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.2)" }} />
                        <div style={{ flex: 1, minWidth: 150 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                            <span className="num">{m.code}</span>
                            {m.nickname && <span style={{ fontSize: 12.5, fontWeight: 500, color: "#6B7280" }}>{m.nickname}</span>}
                            <Pill tone={m.kind === "EXCHANGER" ? "amber" : "brand"}>{m.kind === "EXCHANGER" ? "ตู้แลกเหรียญ" : "ตู้คีบ"}</Pill>
                            {m.isActive && m.awaitingSetup && <Pill tone="neutral">⚪ รอตั้งค่า</Pill>}
                            {!m.isActive && <Pill tone="neutral">ปลดระวาง</Pill>}
                          </div>
                          <div style={{ fontSize: 11.5, color: "#9AA1AB", marginTop: 1 }}>อยู่สาขา {m.branchName} ({m.branchCode})</div>
                        </div>
                        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                          <GhostBtn onClick={() => setModal({ t: "editMachine", m })}><Pencil size={13} /> แก้</GhostBtn>
                          <GhostBtn onClick={() => setModal({ t: "reassignMachine", m })}><Truck size={13} /> ย้ายสาขา</GhostBtn>
                          {m.isActive && <GhostBtn tone="danger" onClick={() => setModal({ t: "retireMachine", m })}><PowerOff size={13} /> ปลดตู้</GhostBtn>}
                          <GhostBtn onClick={() => setModal({ t: "detail", m, branchName: m.branchName })}><History size={13} /> ดูประวัติ <ChevronRight size={13} /></GhostBtn>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          {/* ══════════ คลังประจำสาขา ══════════ */}
          <div style={{ marginTop: 18 }}>
            <Card title="คลังประจำสาขา" sub="คลังกลางของแต่ละสาขา — มูลค่าคงเหลือ · จำนวนสินค้า · ใกล้หมด (คลังห้องที่ 2 เป็นเฟสถัดไป)" pad={false}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
                {branches.map((b) => {
                  const s = b.stock;
                  const hasStock = s != null && s.skuCount > 0;
                  return (
                    <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", borderBottom: "1px solid #F4F5F7" }}>
                      <IconBox tone="neutral" size={38} radius={10} bg="#EEF0FE" color={BRAND}><PackageOpen size={17} /></IconBox>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{b.name}</div>
                        {hasStock ? (
                          <div style={{ fontSize: 11.5, color: "#6B7280", marginTop: 2, display: "flex", gap: 12, flexWrap: "wrap" }}>
                            <span>มูลค่า <b className="num" style={{ color: "#454B54" }}>{baht(s!.inventoryValueCents)}</b></span>
                            <span><b className="num" style={{ color: "#454B54" }}>{num(s!.skuCount)}</b> รายการ</span>
                            <span style={{ color: s!.lowCount > 0 ? "#B45309" : "#9AA1AB" }}>{s!.lowCount > 0 ? <>ใกล้หมด <b className="num">{num(s!.lowCount)}</b></> : "ครบ"}</span>
                          </div>
                        ) : (
                          <div style={{ fontSize: 11.5, color: "#9AA1AB", marginTop: 2 }}>ยังไม่มีสินค้าในคลังสาขานี้</div>
                        )}
                      </div>
                      <Link href={`/clawfleet/os/stock?branch=${encodeURIComponent(b.id)}`} className="co-tap" style={{ textDecoration: "none", border: "1px solid #E3E6EA", background: "#fff", color: "#454B54", fontSize: 12, fontWeight: 600, padding: "7px 12px", borderRadius: 9, display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
                        เปิดคลัง <ArrowRight size={13} />
                      </Link>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </>
      )}

      {/* ═══════════ modals ═══════════ */}
      {modal.t === "createBranch" && <CreateBranchModal onClose={close} onDone={refresh} />}
      {modal.t === "renameBranch" && <RenameBranchModal b={modal.b} onClose={close} onDone={refresh} />}
      {modal.t === "deleteBranch" && <DeleteBranchModal b={modal.b} onClose={close} onDone={refresh} />}
      {modal.t === "createMachine" && <CreateMachineModal branches={branches} presetBranchId={modal.branchId} onClose={close} onDone={refresh} />}
      {modal.t === "editMachine" && <EditMachineModal m={modal.m} onClose={close} onDone={refresh} />}
      {modal.t === "reassignMachine" && <ReassignMachineModal m={modal.m} branchOptions={branchOptions} onClose={close} onDone={refresh} />}
      {modal.t === "retireMachine" && <RetireMachineModal m={modal.m} onClose={close} onDone={refresh} />}
      {modal.t === "detail" && <MachineDetailPanel m={modal.m} branchName={modal.branchName} onClose={close} />}
    </div>
  );
}

/* ───────────────────────── search box (ตรงกับ tokens) ───────────────────────── */
function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div style={{ position: "relative", minWidth: 180 }}>
      <Search size={14} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#9AA1AB" }} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ ...FIELD, padding: "8px 12px 8px 32px", fontSize: 12.5 }} />
    </div>
  );
}

/* ═══════════════════════════ CRUD modals ═══════════════════════════ */

function ModalFooter({ onSubmit, onCancel, pending, submitLabel, danger }: { onSubmit: () => void; onCancel: () => void; pending: boolean; submitLabel: string; danger?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 10, padding: "14px 20px" }}>
      <button type="button" onClick={onSubmit} disabled={pending}
        style={{ flex: 1, border: "none", cursor: pending ? "wait" : "pointer", background: pending ? (danger ? "#E0A6A0" : "#A5A0EC") : (danger ? "#DB5040" : BRAND), color: "#fff", fontSize: 13.5, fontWeight: 700, padding: "11px 0", borderRadius: 10 }}>
        {pending ? "กำลังบันทึก…" : submitLabel}
      </button>
      <button type="button" onClick={onCancel} disabled={pending}
        style={{ border: "1px solid #E3E6EA", background: "#fff", cursor: pending ? "not-allowed" : "pointer", color: "#6B7280", fontSize: 13.5, fontWeight: 600, padding: "11px 20px", borderRadius: 10 }}>
        ยกเลิก
      </button>
    </div>
  );
}

/* ── สร้างสาขา ── */
function CreateBranchModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [province, setProvince] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit() {
    setErr(null);
    if (!name.trim()) return setErr("กรอกชื่อสาขา");
    if (!code.trim()) return setErr("กรอกรหัสสาขา (เช่น RS)");
    start(async () => {
      const res = await createBranch({ name: name.trim(), code: code.trim(), province: province.trim() || undefined });
      if (!res.ok) return setErr(res.error);
      onClose(); onDone();
    });
  }
  return (
    <Modal open onClose={() => !pending && onClose()} width={480} title="เพิ่มสาขาใหม่" sub="สร้างสาขาตู้คีบ · รหัสสาขาห้ามซ้ำ"
      footer={<ModalFooter onSubmit={submit} onCancel={() => !pending && onClose()} pending={pending} submitLabel="สร้างสาขา" />}>
      <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div><label style={LABEL}>ชื่อสาขา</label><input autoFocus value={name} onChange={(e) => { setName(e.target.value); setErr(null); }} placeholder="เช่น รังสิต" style={FIELD} /></div>
        <div><label style={LABEL}>รหัสสาขา (ย่อ · ห้ามซ้ำ)</label><input value={code} onChange={(e) => { setCode(e.target.value); setErr(null); }} placeholder="เช่น RS" style={FIELD} /></div>
        <div><label style={LABEL}>จังหวัด (ไม่บังคับ)</label><input value={province} onChange={(e) => setProvince(e.target.value)} placeholder="เช่น ปทุมธานี" style={FIELD} /></div>
        {err && <ErrBox msg={err} />}
      </div>
    </Modal>
  );
}

/* ── แก้ชื่อ/รหัสสาขา ── */
function RenameBranchModal({ b, onClose, onDone }: { b: ManageBranchVM; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(b.name);
  const [code, setCode] = useState(b.code);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit() {
    setErr(null);
    if (!name.trim()) return setErr("กรอกชื่อสาขา");
    if (!code.trim()) return setErr("กรอกรหัสสาขา");
    start(async () => {
      const res = await renameBranch(b.id, { name: name.trim(), code: code.trim() });
      if (!res.ok) return setErr(res.error);
      onClose(); onDone();
    });
  }
  return (
    <Modal open onClose={() => !pending && onClose()} width={480} title="แก้ชื่อสาขา" sub={`สาขาเดิม: ${b.name} (${b.code})`}
      footer={<ModalFooter onSubmit={submit} onCancel={() => !pending && onClose()} pending={pending} submitLabel="บันทึก" />}>
      <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div><label style={LABEL}>ชื่อสาขา</label><input autoFocus value={name} onChange={(e) => { setName(e.target.value); setErr(null); }} style={FIELD} /></div>
        <div><label style={LABEL}>รหัสสาขา</label><input value={code} onChange={(e) => { setCode(e.target.value); setErr(null); }} style={FIELD} /></div>
        {err && <ErrBox msg={err} />}
      </div>
    </Modal>
  );
}

/* ── ลบสาขา (destructive confirm) ── */
function DeleteBranchModal({ b, onClose, onDone }: { b: ManageBranchVM; onClose: () => void; onDone: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const hasMachines = b.machineCount > 0;
  function submit() {
    setErr(null);
    start(async () => {
      const res = await deleteBranch(b.id);
      if (!res.ok) return setErr(res.error);
      onClose(); onDone();
    });
  }
  return (
    <Modal open onClose={() => !pending && onClose()} width={470} title="ลบสาขา" sub={`${b.name} (${b.code})`}
      footer={<ModalFooter onSubmit={submit} onCancel={() => !pending && onClose()} pending={pending} submitLabel="ยืนยันลบสาขา" danger />}>
      <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        {hasMachines ? (
          <div style={{ fontSize: 12.5, color: "#B45309", background: "#FCF6EC", border: "1px solid #F0E2BE", borderRadius: 9, padding: "11px 13px", display: "flex", gap: 8 }}>
            <AlertTriangle size={16} style={{ flex: "0 0 16px", marginTop: 1 }} />
            <span>สาขานี้มีตู้อยู่ <b className="num">{b.machineCount}</b> ตู้ — ระบบจะ <b>ปิดใช้งานสาขา</b> (soft) แทนการลบถาวร เพื่อไม่ให้ประวัติการเก็บเงิน/สต๊อกพัง</span>
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: "#6B7280", background: "#F8F9FB", borderRadius: 9, padding: "11px 13px" }}>
            สาขานี้ยังไม่มีตู้และไม่มีประวัติ — จะถูก <b>ลบถาวร</b> ออกจากระบบ
          </div>
        )}
        {err && <ErrBox msg={err} />}
      </div>
    </Modal>
  );
}

/* ── สร้างตู้ ── */
function CreateMachineModal({ branches, presetBranchId, onClose, onDone }: { branches: ManageBranchVM[]; presetBranchId?: string; onClose: () => void; onDone: () => void }) {
  const [branchId, setBranchId] = useState(presetBranchId ?? branches[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [kind, setKind] = useState<MachineKind>("CLAW");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit() {
    setErr(null);
    if (!branchId) return setErr("เลือกสาขา");
    if (!code.trim()) return setErr("กรอกรหัสตู้ (เช่น CW-001)");
    start(async () => {
      const res = await createCfMachine({ branchId, code: code.trim(), nickname: nickname.trim() || undefined, kind });
      if (!res.ok) return setErr(res.error);
      onClose(); onDone();
    });
  }
  return (
    <Modal open onClose={() => !pending && onClose()} width={500} title="เพิ่มตู้ใหม่" sub="ตู้ใหม่จะขึ้นสถานะ ⚪ รอตั้งค่าครั้งแรก จนกว่าจะเก็บเงินรอบแรก (ตั้ง baseline)"
      footer={<ModalFooter onSubmit={submit} onCancel={() => !pending && onClose()} pending={pending} submitLabel="เพิ่มตู้" />}>
      <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={LABEL}>สาขา</label>
          <select value={branchId} onChange={(e) => { setBranchId(e.target.value); setErr(null); }} style={FIELD}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
          </select>
        </div>
        <div><label style={LABEL}>รหัสตู้ (ห้ามซ้ำ)</label><input autoFocus value={code} onChange={(e) => { setCode(e.target.value); setErr(null); }} placeholder="เช่น CW-001" style={FIELD} /></div>
        <div><label style={LABEL}>ชื่อเล่นตู้ (ไม่บังคับ)</label><input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="เช่น ตู้หน้าประตู" style={FIELD} /></div>
        <div>
          <label style={LABEL}>ประเภทตู้</label>
          <div style={{ display: "flex", gap: 9 }}>
            {(["CLAW", "EXCHANGER"] as MachineKind[]).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                style={{ flex: 1, cursor: "pointer", padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 700, border: `1.5px solid ${kind === k ? BRAND : "#E3E6EA"}`, background: kind === k ? "#EEF0FE" : "#fff", color: kind === k ? BRAND : "#6B7280" }}>
                {k === "CLAW" ? "ตู้คีบ" : "ตู้แลกเหรียญ"}
              </button>
            ))}
          </div>
        </div>
        {err && <ErrBox msg={err} />}
      </div>
    </Modal>
  );
}

/* ── แก้ตู้ (ชื่อ/รหัส/ประเภท) ── */
function EditMachineModal({ m, onClose, onDone }: { m: ManageMachineVM; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState(m.code);
  const [nickname, setNickname] = useState(m.nickname ?? "");
  const [kind, setKind] = useState<MachineKind>(m.kind);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit() {
    setErr(null);
    if (!code.trim()) return setErr("กรอกรหัสตู้");
    start(async () => {
      const res = await renameCfMachine(m.id, { code: code.trim(), nickname: nickname.trim(), kind });
      if (!res.ok) return setErr(res.error);
      onClose(); onDone();
    });
  }
  return (
    <Modal open onClose={() => !pending && onClose()} width={500} title="แก้ตู้" sub={`ตู้เดิม: ${m.code}${m.nickname ? ` (${m.nickname})` : ""}`}
      footer={<ModalFooter onSubmit={submit} onCancel={() => !pending && onClose()} pending={pending} submitLabel="บันทึก" />}>
      <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div><label style={LABEL}>รหัสตู้</label><input autoFocus value={code} onChange={(e) => { setCode(e.target.value); setErr(null); }} style={FIELD} /></div>
        <div><label style={LABEL}>ชื่อเล่นตู้ (เว้นว่างได้)</label><input value={nickname} onChange={(e) => setNickname(e.target.value)} style={FIELD} /></div>
        <div>
          <label style={LABEL}>ประเภทตู้</label>
          <div style={{ display: "flex", gap: 9 }}>
            {(["CLAW", "EXCHANGER"] as MachineKind[]).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                style={{ flex: 1, cursor: "pointer", padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 700, border: `1.5px solid ${kind === k ? BRAND : "#E3E6EA"}`, background: kind === k ? "#EEF0FE" : "#fff", color: kind === k ? BRAND : "#6B7280" }}>
                {k === "CLAW" ? "ตู้คีบ" : "ตู้แลกเหรียญ"}
              </button>
            ))}
          </div>
        </div>
        {err && <ErrBox msg={err} />}
      </div>
    </Modal>
  );
}

/* ── ย้ายสาขา (reuse pattern ReassignMachineCard) ── */
function ReassignMachineModal({ m, branchOptions, onClose, onDone }: { m: ManageMachineVM; branchOptions: BranchOption[]; onClose: () => void; onDone: () => void }) {
  const [toBranchId, setToBranchId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // สาขาปัจจุบันของตู้ (จาก branchId บน VM ที่ flatten มา) — ตัดออกจากตัวเลือก
  const currentBranchId = (m as ManageMachineVM & { branchId?: string }).branchId;
  function submit() {
    setErr(null);
    if (!toBranchId) return setErr("เลือกสาขาปลายทาง");
    start(async () => {
      const res = await reassignCfMachineBranch(m.id, toBranchId);
      if (!res.ok) return setErr(res.error);
      onClose(); onDone();
    });
  }
  return (
    <Modal open onClose={() => !pending && onClose()} width={500} title="ย้ายตู้ไปสาขาอื่น" sub="ประวัติเก่ายังผูกสาขาเดิม — ย้ายมีผลนับจากนี้ไป"
      footer={<ModalFooter onSubmit={submit} onCancel={() => !pending && onClose()} pending={pending} submitLabel="ยืนยันย้ายตู้" />}>
      <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 12.5, color: "#6B7280" }}>ตู้ <b className="num" style={{ color: "#454B54" }}>{m.code}</b>{m.nickname ? ` (${m.nickname})` : ""}</div>
        <div>
          <label style={LABEL}>สาขาปลายทาง</label>
          <select autoFocus value={toBranchId} onChange={(e) => { setToBranchId(e.target.value); setErr(null); }} style={FIELD}>
            <option value="">— เลือกสาขา —</option>
            {branchOptions.filter((b) => b.id !== currentBranchId).map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
          </select>
        </div>
        <div style={{ fontSize: 11.5, color: "#B45309", background: "#FCF6EC", border: "1px solid #F0E2BE", borderRadius: 9, padding: "9px 12px" }}>
          ตู้จะหลุดจากกลุ่มของสาขาเดิม · ประวัติการเก็บเงิน/สต๊อกเดิมยังคงอยู่สาขาเดิม (ย้ายมีผลนับจากนี้ไป)
        </div>
        {err && <ErrBox msg={err} />}
      </div>
    </Modal>
  );
}

/* ── ปลดระวางตู้ (destructive confirm) ── */
function RetireMachineModal({ m, onClose, onDone }: { m: ManageMachineVM; onClose: () => void; onDone: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit() {
    setErr(null);
    start(async () => {
      const res = await retireCfMachine(m.id);
      if (!res.ok) return setErr(res.error);
      onClose(); onDone();
    });
  }
  return (
    <Modal open onClose={() => !pending && onClose()} width={460} title="ปลดระวางตู้" sub={`${m.code}${m.nickname ? ` (${m.nickname})` : ""}`}
      footer={<ModalFooter onSubmit={submit} onCancel={() => !pending && onClose()} pending={pending} submitLabel="ยืนยันปลดตู้" danger />}>
      <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 12.5, color: "#6B7280", background: "#F8F9FB", borderRadius: 9, padding: "11px 13px" }}>
          ปลดระวาง = <b>ปิดใช้งานตู้</b> (ไม่ลบประวัติ) — ตู้จะไม่ขึ้นในรายการเก็บเงิน/รายงานอีก แต่ประวัติเดิมยังอยู่ครบ ตรวจย้อนหลังได้
        </div>
        {err && <ErrBox msg={err} />}
      </div>
    </Modal>
  );
}

/* ═══════════════════════ machine detail panel (read-only · on-demand load) ═══════════════════════ */
function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" }) + " " + d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}
const REPAIR_STATUS_LABEL: Record<string, string> = { OPEN: "เปิดใหม่", IN_PROGRESS: "กำลังซ่อม", RESOLVED: "ปิดงานแล้ว", CANCELLED: "ยกเลิก" };

function MachineDetailPanel({ m, branchName, onClose }: { m: ManageMachineVM; branchName: string; onClose: () => void }) {
  const [data, setData] = useState<MachineDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // โหลด detail ตอนเปิด (on-demand · ไม่ preload ทุกตู้ตอนเข้าหน้า)
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    loadMachineDetail(m.id)
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch(() => { if (alive) { setErr("โหลดรายละเอียดตู้ไม่สำเร็จ"); setLoading(false); } });
    return () => { alive = false; };
  }, [m.id]);

  return (
    <Modal open onClose={onClose} width={620}
      title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Cpu size={17} color={BRAND} /> {m.code}{m.nickname ? ` · ${m.nickname}` : ""}</span>}
      sub={`สาขา ${branchName} · ${m.kind === "EXCHANGER" ? "ตู้แลกเหรียญ" : "ตู้คีบ"}`}
      badge={m.isActive && m.awaitingSetup ? <Pill tone="neutral">⚪ รอตั้งค่าครั้งแรก</Pill> : !m.isActive ? <Pill tone="neutral">ปลดระวาง</Pill> : <Pill tone="green">ใช้งาน</Pill>}>
      <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
        {loading ? (
          <div style={{ fontSize: 12.5, color: "#9AA1AB", textAlign: "center", padding: "24px 0" }}>กำลังโหลดรายละเอียดตู้…</div>
        ) : err ? (
          <ErrBox msg={err} />
        ) : data ? (
          <>
            {/* baseline state */}
            <Section title="สถานะตั้งค่าครั้งแรก (baseline)">
              {data.baseline.locked ? (
                <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5 }}>
                  <Pill tone="green">ล็อกแล้ว</Pill>
                  <span style={{ color: "#6B7280" }}>ตั้งค่าเมื่อ {data.baseline.appliedAt ? fmtDate(data.baseline.appliedAt.toISOString?.() ?? String(data.baseline.appliedAt)) : "—"}</span>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5 }}>
                  <Pill tone="neutral">⚪ ยังไม่ล็อก</Pill>
                  <span style={{ color: "#9AA1AB" }}>รอเก็บเงินรอบแรก (แม่บ้านตั้ง baseline ในมือถือ)</span>
                </div>
              )}
            </Section>

            {/* loadout */}
            <Section title={`สินค้าในตู้ตอนนี้ (${data.loadout.length})`}>
              {data.loadout.length === 0 ? (
                <Muted>ยังไม่มีการตั้งสินค้า/ราคาให้ตู้นี้</Muted>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {data.loadout.map((l) => (
                    <div key={l.productId} style={{ display: "flex", alignItems: "center", gap: 11, background: "#F8F9FB", borderRadius: 10, padding: "9px 11px" }}>
                      <span style={{ width: 38, height: 38, flex: "0 0 38px", borderRadius: 8, background: "#EAECF1", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA1AB" }}>
                        {l.imageUrl ? <img src={l.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Package size={16} />}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.productName}</div>
                        <div style={{ fontSize: 11, color: "#9AA1AB" }}>ตั้งเมื่อ {fmtDate(l.setAt.toISOString?.() ?? String(l.setAt))}</div>
                      </div>
                      <span className="num" style={{ fontSize: 12.5, fontWeight: 700, color: "#454B54" }}>{l.pricePerPlayCoins} เหรียญ/ครั้ง</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* recent collections */}
            <Section title="รอบเก็บเงินล่าสุด">
              {data.collections.length === 0 ? (
                <Muted>ยังไม่มีรอบเก็บเงินของตู้นี้</Muted>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {data.collections.map((c) => (
                    <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #F4F5F7", paddingBottom: 7 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          {c.isBaseline ? <Pill tone="brand">ตั้งค่าครั้งแรก</Pill> : c.eventType === "INITIAL" ? <Pill tone="neutral">เริ่มต้น</Pill> : null}
                          <span className="num">{baht(c.cashCountedCents)}</span>
                          {c.shortReason && <Pill tone="amber">ขาด: {c.shortReason}</Pill>}
                        </div>
                        <div style={{ fontSize: 11, color: "#9AA1AB" }}>{fmtDate(c.collectedAt)} · โดย {c.collectedByName}</div>
                      </div>
                      <span className="num" style={{ fontSize: 11, color: "#9AA1AB" }}>มิเตอร์ {num(c.coinMeterBefore)}→{num(c.coinMeterAfter)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* repair history */}
            <Section title="ประวัติแจ้งซ่อม">
              {data.repairs.length === 0 ? (
                <Muted>ไม่มีประวัติแจ้งซ่อม</Muted>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {data.repairs.map((r) => (
                    <div key={r.id} style={{ background: "#F8F9FB", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                        <Pill tone={r.status === "RESOLVED" ? "green" : r.status === "CANCELLED" ? "neutral" : "amber"}>{REPAIR_STATUS_LABEL[r.status] ?? r.status}</Pill>
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{r.symptom}</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#9AA1AB", marginTop: 3 }}>
                        แจ้ง {fmtDate(r.reportedAt)} · โดย {r.reportedByName}
                        {r.resolvedAt ? ` · ปิดงาน ${fmtDate(r.resolvedAt)}${r.resolvedByName ? ` โดย ${r.resolvedByName}` : ""}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: "#9AA1AB", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 9 }}>{title}</div>
      {children}
    </div>
  );
}
function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12.5, color: "#9AA1AB" }}>{children}</div>;
}
