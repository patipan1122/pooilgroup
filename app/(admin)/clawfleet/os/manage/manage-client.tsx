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
import { useRouter, useSearchParams } from "next/navigation";
import {
  Store, Cpu, Plus, Pencil, Trash2, Truck, PackageOpen, ChevronRight, Search,
  AlertTriangle, PowerOff, History, ArrowRight, Package, Warehouse, Star, Send,
  ArrowLeft, ImageOff, Camera,
} from "lucide-react";
import { Card, Modal, Pill, IconBox, EmptyState } from "@/components/clawfleet/os/kit";
import { baht, num, type Tone } from "@/components/clawfleet/os/format";
import {
  createBranch, renameBranch, deleteBranch,
  createCfMachine, renameCfMachine, retireCfMachine, reassignCfMachineBranch,
} from "@/lib/clawfleet/actions";
import {
  createWarehouse, renameWarehouse, setMainWarehouse, deactivateWarehouse, transferBetweenWarehouses,
} from "@/lib/clawfleet/stock-actions";
import { loadMachineDetail } from "./manage-detail-action";
import type { MachineDetailData } from "@/lib/clawfleet/manage-queries";
import { setCfMachinePhoto } from "@/lib/clawfleet/machine-photo-actions";
import { PhotoCaptureButton } from "@/components/clawfleet/photo-capture-button";

/* ───────────────────────── types (view-models จาก server) ───────────────────────── */
export type MachineKind = "CLAW" | "EXCHANGER";
export type ManageMachineVM = {
  id: string;
  code: string;
  nickname: string | null;
  kind: MachineKind;
  isActive: boolean;
  awaitingSetup: boolean; // ⚪ ยังไม่ตั้งค่าครั้งแรก (baseline)
  photoUrl: string | null; // N4 — รูปตู้ (thumbnail + lightbox) · null = ยังไม่มีรูป
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
// คลังหลายห้องต่อสาขา (warehouse) + สินค้าต่อสาขา (สำหรับ modal โอนของ)
export type WarehouseVM = { id: string; name: string; isMain: boolean; isActive: boolean };
export type TransferProductVM = { id: string; name: string; onHand: number };

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

/* ═══════════════════════════════ modal state (shared by ROOT) ═══════════════════════════════ */
type ModalState =
  | { t: "none" }
  | { t: "createBranch" }
  | { t: "renameBranch"; b: ManageBranchVM }
  | { t: "deleteBranch"; b: ManageBranchVM }
  | { t: "createMachine"; branchId?: string }
  | { t: "editMachine"; m: ManageMachineVM }
  | { t: "reassignMachine"; m: ManageMachineVM }
  | { t: "retireMachine"; m: ManageMachineVM }
  | { t: "detail"; m: ManageMachineVM; branchName: string }
  | { t: "photo"; m: ManageMachineVM } // N4 — lightbox รูปตู้
  // ── คลังหลายห้อง (warehouse) ──
  | { t: "whCreate"; branchId: string; branchName: string }
  | { t: "whRename"; id: string; current: string; branchName: string }
  | { t: "whDeactivate"; id: string; name: string; branchName: string }
  | { t: "whTransfer"; branchId: string; branchName: string };

/* ═══════════════════════════════ ROOT — two-pane master-detail ═══════════════════════════════ */
export function ManageClient({
  branches,
  machineOptions,
  branchOptions,
  warehousesByBranch,
  productsByBranch,
  orgId,
  isAdmin = true,
}: {
  branches: ManageBranchVM[];
  machineOptions: MachineOption[];
  branchOptions: BranchOption[];
  warehousesByBranch: Record<string, WarehouseVM[]>;
  productsByBranch: Record<string, TransferProductVM[]>;
  /** org ของผู้ใช้ — ส่งต่อให้ PhotoCaptureButton (แนบรูปตู้ขึ้น R2) */
  orgId: string;
  /** หน้านี้อยู่หลัง admin-gate อยู่แล้ว (page redirect ผู้ที่ไม่ใช่แอดมิน) — prop นี้ gate ปุ่ม CRUD ให้ชัด */
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isEmpty = branches.length === 0;

  const [modal, setModal] = useState<ModalState>({ t: "none" });
  const close = () => setModal({ t: "none" });
  const refresh = () => router.refresh();

  // ── ตั้งคลังหลัก (inline · ไม่ต้อง modal) — mirror useTransition + router.refresh ──
  const [settingMainId, setSettingMainId] = useState<string | null>(null);
  const [, startSetMain] = useTransition();
  function onSetMain(warehouseId: string) {
    setSettingMainId(warehouseId);
    startSetMain(async () => {
      const res = await setMainWarehouse({ warehouseId });
      setSettingMainId(null);
      if (res.ok) router.refresh();
      // ถ้า error (เช่นคลังถูกปิดใช้) — เงียบ ๆ ไม่ให้ล้ม; แถวยังเดิม (การกดตั้งหลักบนห้อง active ปกติผ่านเสมอ)
    });
  }

  // ── search (LEFT pane: ค้นหาสาขา) ──
  const [branchQ, setBranchQ] = useState("");
  const filteredBranches = useMemo(() => {
    const q = branchQ.trim().toLowerCase();
    if (!q) return branches;
    return branches.filter((b) => b.name.toLowerCase().includes(q) || b.code.toLowerCase().includes(q));
  }, [branches, branchQ]);

  // ── selected branch — persist ใน URL (?b=<branchId>) เพื่อ refresh/back คงไว้ ──
  const urlBranchId = searchParams.get("b");
  // สาขาที่เลือก: ตาม URL ถ้ายังมีจริง · ไม่งั้น default = สาขาแรก
  const selectedBranch = useMemo(() => {
    if (urlBranchId) {
      const hit = branches.find((b) => b.id === urlBranchId);
      if (hit) return hit;
    }
    return branches[0] ?? null;
  }, [branches, urlBranchId]);
  const selectedId = selectedBranch?.id ?? null;

  // เขียน default-select ลง URL ครั้งแรก (ให้ back/refresh คงค่า) — replace ไม่ให้ประวัติเพี้ยน
  useEffect(() => {
    if (isEmpty || !selectedId) return;
    if (urlBranchId !== selectedId) {
      const p = new URLSearchParams(Array.from(searchParams.entries()));
      p.set("b", selectedId);
      router.replace(`?${p.toString()}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function selectBranch(id: string) {
    const p = new URLSearchParams(Array.from(searchParams.entries()));
    p.set("b", id);
    router.replace(`?${p.toString()}`, { scroll: false });
  }

  // mobile master-detail: <lg โชว์ list ก่อน · แตะสาขา → โชว์ detail + ปุ่มกลับ
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");

  // machines ของสาขาที่เลือก (+ ชื่อ/รหัสสาขา สำหรับ reassign modal ที่อ่าน branchId)
  const selectedMachines = useMemo(() => {
    if (!selectedBranch) return [];
    return selectedBranch.machines.map((m) => ({ ...m, branchId: selectedBranch.id, branchName: selectedBranch.name, branchCode: selectedBranch.code }));
  }, [selectedBranch]);

  return (
    <div>
      {/* ── header (บาง · content-first) ── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.3px" }}>จัดการ · ตู้ / สาขา / คลัง</div>
          <div style={{ fontSize: 12.5, color: "#9AA1AB", marginTop: 2 }}>เลือกสาขาทางซ้าย → จัดการตู้ · คลัง ของสาขานั้นทางขวา</div>
        </div>
      </div>

      {isEmpty ? (
        <Card>
          <EmptyState
            icon={<Store size={40} />}
            title="ยังไม่มีสาขาในระบบ"
            sub="เริ่มจากกด “เพิ่มสาขา” แล้วค่อยเพิ่มตู้เข้าไปในแต่ละสาขา — ทุกอย่างจัดการที่หน้านี้ที่เดียว"
          />
          {isAdmin && (
            <div style={{ display: "flex", justifyContent: "center", paddingBottom: 8 }}>
              <PrimaryBtn onClick={() => setModal({ t: "createBranch" })}><Plus size={15} /> เพิ่มสาขา</PrimaryBtn>
            </div>
          )}
        </Card>
      ) : (
        <div className="co-manage-split" style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          {/* ══════════ LEFT — รายการสาขา (master) ══════════ */}
          <div
            className="co-manage-left"
            style={{
              flex: "0 0 320px",
              alignSelf: "flex-start",
              position: "sticky",
              top: 16,
              maxHeight: "calc(100vh - 32px)",
              display: mobileView === "detail" ? undefined : "flex",
              flexDirection: "column",
            }}
          >
            <section className="co-card" style={{ display: "flex", flexDirection: "column", overflow: "hidden", maxHeight: "calc(100vh - 32px)" }}>
              {/* หัว: ปุ่มเพิ่มสาขา + ค้นหา */}
              <div style={{ padding: "13px 14px", borderBottom: "1px solid #F0F1F4", display: "flex", flexDirection: "column", gap: 10, background: "#fff" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "#454B54" }}>สาขา <span className="num" style={{ color: "#9AA1AB", fontWeight: 600 }}>({num(branches.length)})</span></div>
                  {isAdmin && <PrimaryBtn onClick={() => setModal({ t: "createBranch" })}><Plus size={14} /> เพิ่มสาขา</PrimaryBtn>}
                </div>
                <SearchBox value={branchQ} onChange={setBranchQ} placeholder="ค้นหาสาขา…" />
              </div>
              {/* รายชื่อสาขา (scrollable) */}
              <div style={{ overflowY: "auto", flex: 1 }}>
                {filteredBranches.length === 0 ? (
                  <EmptyState title="ไม่พบสาขา" sub="ลองพิมพ์ชื่อหรือรหัสสาขาอื่น" />
                ) : (
                  filteredBranches.map((b) => {
                    const active = b.id === selectedId;
                    const nWh = (warehousesByBranch[b.id] ?? []).filter((w) => w.isActive).length;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => { selectBranch(b.id); setMobileView("detail"); }}
                        className="co-tap"
                        style={{
                          width: "100%", textAlign: "left", border: "none", cursor: "pointer",
                          display: "flex", alignItems: "center", gap: 11, padding: "12px 14px",
                          borderBottom: "1px solid #F4F5F7",
                          borderLeft: `3px solid ${active ? BRAND : "transparent"}`,
                          background: active ? "#EEF0FE" : "#fff",
                        }}
                      >
                        <IconBox tone="neutral" size={38} radius={9} bg={active ? "#fff" : "#F1F2F7"} color={BRAND}>
                          <span className="num" style={{ fontSize: 12.5, fontWeight: 700 }}>{b.code}</span>
                        </IconBox>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: active ? "#312E9E" : "#1A1D21", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</div>
                          <div style={{ fontSize: 11.5, color: "#9AA1AB", marginTop: 1 }}>
                            <span className="num">{b.machineCount}</span> ตู้{nWh > 0 ? <> · <span className="num">{nWh}</span> คลัง</> : ""}
                          </div>
                        </div>
                        <ChevronRight size={15} color={active ? BRAND : "#C3C8D0"} />
                      </button>
                    );
                  })
                )}
              </div>
            </section>
          </div>

          {/* ══════════ RIGHT — รายละเอียดสาขาที่เลือก (detail) ══════════ */}
          <div
            className="co-manage-right"
            style={{ flex: 1, minWidth: 0, display: mobileView === "list" ? undefined : "block" }}
          >
            {selectedBranch ? (
              <BranchDetailPane
                branch={selectedBranch}
                machines={selectedMachines}
                warehouses={warehousesByBranch[selectedBranch.id] ?? []}
                isAdmin={isAdmin}
                settingMainId={settingMainId}
                onBack={() => setMobileView("list")}
                setModal={setModal}
                onSetMain={onSetMain}
              />
            ) : (
              <Card><EmptyState title="เลือกสาขาทางซ้าย" sub="แตะสาขาเพื่อดูตู้และคลังของสาขานั้น" /></Card>
            )}
          </div>
        </div>
      )}

      {/* mobile master-detail toggle — ซ่อน left/right ตามมุมมองบนจอเล็ก */}
      <style>{`
        .co-manage-left { display: block; }
        @media (min-width: 1024px) {
          .co-manage-left, .co-manage-right { display: block !important; }
        }
        @media (max-width: 1023px) {
          .co-manage-split { flex-direction: column; }
          .co-manage-left { flex: 1 1 auto !important; position: static !important; max-height: none !important; width: 100%; ${mobileView === "detail" ? "display: none !important;" : ""} }
          .co-manage-left > section { max-height: 70vh !important; }
          .co-manage-right { width: 100%; ${mobileView === "list" ? "display: none !important;" : ""} }
        }
      `}</style>

      {/* ═══════════ modals (reuse — ทั้งหมดย้ายมาไม่แก้ logic) ═══════════ */}
      {modal.t === "createBranch" && <CreateBranchModal onClose={close} onDone={refresh} />}
      {modal.t === "renameBranch" && <RenameBranchModal b={modal.b} onClose={close} onDone={refresh} />}
      {modal.t === "deleteBranch" && <DeleteBranchModal b={modal.b} onClose={close} onDone={refresh} />}
      {modal.t === "createMachine" && <CreateMachineModal branches={branches} presetBranchId={modal.branchId} onClose={close} onDone={refresh} />}
      {modal.t === "editMachine" && <EditMachineModal m={modal.m} onClose={close} onDone={refresh} />}
      {modal.t === "reassignMachine" && <ReassignMachineModal m={modal.m} branchOptions={branchOptions} onClose={close} onDone={refresh} />}
      {modal.t === "retireMachine" && <RetireMachineModal m={modal.m} onClose={close} onDone={refresh} />}
      {modal.t === "detail" && <MachineDetailPanel m={modal.m} branchName={modal.branchName} onClose={close} />}
      {modal.t === "photo" && <MachinePhotoLightbox m={modal.m} orgId={orgId} isAdmin={isAdmin} onClose={close} onDone={refresh} />}
      {/* ── warehouse modals ── */}
      {modal.t === "whCreate" && <CreateWarehouseModal branchId={modal.branchId} branchName={modal.branchName} onClose={close} onDone={refresh} />}
      {modal.t === "whRename" && <RenameWarehouseModal id={modal.id} current={modal.current} branchName={modal.branchName} onClose={close} onDone={refresh} />}
      {modal.t === "whDeactivate" && <DeactivateWarehouseModal id={modal.id} name={modal.name} branchName={modal.branchName} onClose={close} onDone={refresh} />}
      {modal.t === "whTransfer" && (
        <TransferWarehouseModal
          fromBranchId={modal.branchId}
          fromBranchName={modal.branchName}
          branches={branches}
          warehousesByBranch={warehousesByBranch}
          products={productsByBranch[modal.branchId] ?? []}
          onClose={close}
          onDone={refresh}
        />
      )}
    </div>
  );
}

/* machine VM ที่มี branch context (ใช้ใน right pane · reassign อ่าน branchId) */
type MachineWithBranch = ManageMachineVM & { branchId: string; branchName: string; branchCode: string };

/* ═══════════════════════ RIGHT PANE — รายละเอียดสาขาที่เลือก ═══════════════════════ */
function BranchDetailPane({
  branch, machines, warehouses, isAdmin, settingMainId, onBack, setModal, onSetMain,
}: {
  branch: ManageBranchVM;
  machines: MachineWithBranch[];
  warehouses: WarehouseVM[];
  isAdmin: boolean;
  settingMainId: string | null;
  onBack: () => void;
  setModal: (m: ModalState) => void;
  onSetMain: (id: string) => void;
}) {
  const s = branch.stock;
  const hasStock = s != null && s.skuCount > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── 1. หัวสาขา + KPIs + action ── */}
      <Card pad>
        {/* ปุ่มกลับ (เฉพาะมือถือ) */}
        <button type="button" onClick={onBack} className="co-tap co-manage-back"
          style={{ display: "none", alignItems: "center", gap: 6, border: "1px solid #E3E6EA", background: "#fff", color: "#5A6270", fontSize: 12.5, fontWeight: 600, padding: "7px 12px", borderRadius: 9, cursor: "pointer", marginBottom: 13 }}>
          <ArrowLeft size={14} /> กลับไปรายชื่อสาขา
        </button>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 13, flexWrap: "wrap" }}>
          <IconBox tone="neutral" size={46} radius={12} bg="#EEF0FE" color={BRAND}>
            <span className="num" style={{ fontSize: 15, fontWeight: 700 }}>{branch.code}</span>
          </IconBox>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.3px" }}>{branch.name}</div>
            <div style={{ fontSize: 12, color: "#9AA1AB", marginTop: 2 }}>
              รหัส <span className="num">{branch.code}</span> · {branch.area}{branch.manager && branch.manager !== "—" ? ` · ผจก. ${branch.manager}` : ""}
            </div>
          </div>
          {isAdmin && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <GhostBtn onClick={() => setModal({ t: "renameBranch", b: branch })}><Pencil size={13} /> แก้ชื่อสาขา</GhostBtn>
              <GhostBtn tone="danger" onClick={() => setModal({ t: "deleteBranch", b: branch })}><Trash2 size={13} /> ลบสาขา</GhostBtn>
            </div>
          )}
        </div>
        {/* KPI แถวเดียว */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 15 }}>
          <MiniStat icon={<Cpu size={14} />} label="ตู้ในสาขา" value={`${num(branch.machineCount)} ตู้`} />
          <MiniStat icon={<Warehouse size={14} />} label="คลัง (ห้อง)" value={`${num(warehouses.filter((w) => w.isActive).length)} ห้อง`} />
          {hasStock ? (
            <MiniStat icon={<PackageOpen size={14} />} label="มูลค่าคงเหลือ" value={baht(s!.inventoryValueCents)}
              sub={s!.lowCount > 0 ? `ใกล้หมด ${num(s!.lowCount)} รายการ` : `${num(s!.skuCount)} รายการ`}
              subColor={s!.lowCount > 0 ? "#B45309" : "#9AA1AB"} />
          ) : (
            <MiniStat icon={<PackageOpen size={14} />} label="มูลค่าคงเหลือ" value="—" sub="ยังไม่มีสินค้า" subColor="#9AA1AB" />
          )}
        </div>
      </Card>

      {/* ── 2. ตู้ (machines) ── */}
      <Card
        title="ตู้"
        sub="ตู้ในสาขานี้ · แตะรูปเพื่อดูใหญ่ · แก้ · ย้ายสาขา · ปลด · ประวัติ"
        right={isAdmin ? <PrimaryBtn onClick={() => setModal({ t: "createMachine", branchId: branch.id })}><Plus size={14} /> เพิ่มตู้</PrimaryBtn> : undefined}
        pad={false}
      >
        {machines.length === 0 ? (
          <EmptyState
            icon={<Cpu size={34} />}
            title="ยังไม่มีตู้ในสาขานี้"
            sub={isAdmin ? "กด “เพิ่มตู้” เพื่อลงทะเบียนตู้เข้าสาขานี้" : "ยังไม่มีตู้ในสาขานี้"}
          />
        ) : (
          <div>
            {machines.map((m) => {
              const dot = machineDot(m);
              return (
                <div key={m.id} className="co-rowh" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: "1px solid #F4F5F7", flexWrap: "wrap" }}>
                  {/* รูปตู้ (N4) — thumbnail คลิกเปิด lightbox */}
                  <MachineThumb m={m} onClick={() => setModal({ t: "photo", m })} />
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      <span title={dot.label} style={{ width: 9, height: 9, borderRadius: 3, background: dot.bg, flex: "0 0 9px" }} />
                      <span className="num">{m.code}</span>
                      {m.nickname && <span style={{ fontSize: 12.5, fontWeight: 500, color: "#6B7280" }}>{m.nickname}</span>}
                      <Pill tone={m.kind === "EXCHANGER" ? "amber" : "brand"}>{m.kind === "EXCHANGER" ? "ตู้แลกเหรียญ" : "ตู้คีบ"}</Pill>
                      {m.isActive && m.awaitingSetup && <Pill tone="neutral">⚪ รอตั้งค่า</Pill>}
                      {!m.isActive && <Pill tone="neutral">ปลดระวาง</Pill>}
                    </div>
                    <div style={{ fontSize: 11.5, color: "#9AA1AB", marginTop: 2 }}>{dot.label}</div>
                  </div>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                    {isAdmin && <GhostBtn onClick={() => setModal({ t: "editMachine", m })}><Pencil size={13} /> แก้</GhostBtn>}
                    {isAdmin && <GhostBtn onClick={() => setModal({ t: "reassignMachine", m })}><Truck size={13} /> ย้ายสาขา</GhostBtn>}
                    {isAdmin && m.isActive && <GhostBtn tone="danger" onClick={() => setModal({ t: "retireMachine", m })}><PowerOff size={13} /> ปลดตู้</GhostBtn>}
                    <GhostBtn onClick={() => setModal({ t: "detail", m, branchName: m.branchName })}><History size={13} /> ดูประวัติ <ChevronRight size={13} /></GhostBtn>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── 3. คลัง (warehouses) — scoped สาขาที่เลือก ── */}
      <Card
        title="คลัง (ห้องเก็บของ)"
        sub="⭐ คลังหลัก = ห้องรับของเข้าค่าเริ่มต้น · โอนของข้ามห้อง/ข้ามสาขาได้"
        right={
          <Link href={`/clawfleet/os/stock?branch=${encodeURIComponent(branch.id)}`} className="co-tap" style={{ textDecoration: "none", border: "1px solid #E3E6EA", background: "#fff", color: "#454B54", fontSize: 12, fontWeight: 600, padding: "7px 12px", borderRadius: 9, display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
            เปิดคลัง <ArrowRight size={13} />
          </Link>
        }
        pad={false}
      >
        {isAdmin ? (
          <BranchWarehousePanel
            branch={branch}
            warehouses={warehouses}
            onCreate={() => setModal({ t: "whCreate", branchId: branch.id, branchName: branch.name })}
            onRename={(w) => setModal({ t: "whRename", id: w.id, current: w.name, branchName: branch.name })}
            onDeactivate={(w) => setModal({ t: "whDeactivate", id: w.id, name: w.name, branchName: branch.name })}
            onSetMain={(w) => onSetMain(w.id)}
            onTransfer={() => setModal({ t: "whTransfer", branchId: branch.id, branchName: branch.name })}
            settingMainId={settingMainId}
          />
        ) : (
          <div style={{ padding: "14px 20px", fontSize: 12.5, color: "#9AA1AB" }}>
            {warehouses.filter((w) => w.isActive).length} ห้องที่ใช้งาน — จัดการคลังต้องเป็นแอดมิน
          </div>
        )}
      </Card>

      {/* back button visibility (mobile only) */}
      <style>{`@media (max-width: 1023px) { .co-manage-back { display: inline-flex !important; } }`}</style>
    </div>
  );
}

/* mini KPI chip สำหรับหัวสาขา */
function MiniStat({ icon, label, value, sub, subColor }: { icon: React.ReactNode; label: string; value: string; sub?: string; subColor?: string }) {
  return (
    <div style={{ flex: "1 1 130px", minWidth: 120, background: "#F8F9FB", borderRadius: 11, padding: "11px 13px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#9AA1AB", fontWeight: 500, marginBottom: 5 }}>
        <span style={{ color: BRAND, display: "inline-flex" }}>{icon}</span> {label}
      </div>
      <div className="num" style={{ fontSize: 17, fontWeight: 700, color: "#1A1D21" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: subColor ?? "#9AA1AB", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/* รูปตู้ thumbnail (N4) — คลิกเปิด lightbox · ไม่มีรูป = tile กล้อง */
function MachineThumb({ m, onClick }: { m: ManageMachineVM; onClick: () => void }) {
  const has = !!m.photoUrl;
  return (
    <button
      type="button"
      onClick={onClick}
      className="co-tap"
      title={has ? "ดูรูปตู้" : "ยังไม่มีรูปตู้"}
      style={{
        width: 48, height: 48, flex: "0 0 48px", borderRadius: 11, overflow: "hidden",
        border: "1px solid #E8EAED", background: has ? "#EAECF1" : "#F1F2F7", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA1AB", padding: 0,
      }}
    >
      {has ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.photoUrl!} alt={`รูปตู้ ${m.code}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <Camera size={18} />
      )}
    </button>
  );
}

/* lightbox + จัดการรูปตู้ (N4) — ดูรูปใหญ่ + แนบ/เปลี่ยน/ลบรูป (แอดมิน).
 * upload: reuse PhotoCaptureButton (resize→WebP→POST /api/clawfleet/upload→R2 public url)
 * แล้ว onChange(url) → setCfMachinePhoto(id, url) → refresh. ลบ = setCfMachinePhoto(id, null). */
function MachinePhotoLightbox({
  m, orgId, isAdmin, onClose, onDone,
}: {
  m: ManageMachineVM;
  orgId: string;
  isAdmin: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false); // true ระหว่างเขียนรูปลง DB (upload/ลบ)
  const [pending, start] = useTransition();

  // upload สำเร็จ (ได้ url จาก R2) → ผูก url เข้าตู้ในฐานข้อมูล
  function onUploaded(url: string) {
    setErr(null);
    setSaving(true);
    start(async () => {
      const res = await setCfMachinePhoto(m.id, url);
      setSaving(false);
      if (!res.ok) return setErr(res.error);
      onDone(); // refresh → thumbnail + lightbox เห็นรูปใหม่
    });
  }
  // ลบรูปตู้ (photoUrl = null)
  function onRemove() {
    setErr(null);
    setSaving(true);
    start(async () => {
      const res = await setCfMachinePhoto(m.id, null);
      setSaving(false);
      if (!res.ok) return setErr(res.error);
      onDone();
    });
  }

  const busy = saving || pending;

  return (
    <Modal open onClose={() => !busy && onClose()} width={640}
      title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Camera size={16} color={BRAND} /> รูปตู้ · {m.code}{m.nickname ? ` (${m.nickname})` : ""}</span>}
      sub={m.kind === "EXCHANGER" ? "ตู้แลกเหรียญ" : "ตู้คีบ"}>
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        {m.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.photoUrl} alt={`รูปตู้ ${m.code}`} style={{ width: "100%", height: "auto", maxHeight: "62vh", objectFit: "contain", borderRadius: 12, background: "#F8F9FB", display: "block", margin: "0 auto" }} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "40px 20px", color: "#9AA1AB", background: "#F8F9FB", borderRadius: 12 }}>
            <ImageOff size={38} style={{ opacity: 0.6 }} />
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "#5A6270" }}>ยังไม่มีรูปตู้</div>
            <div style={{ fontSize: 12, textAlign: "center", maxWidth: 340 }}>แนบรูปตู้ได้เลยด้านล่าง — หรือรูปจะถูกบันทึกอัตโนมัติเมื่อแม่บ้านถ่ายรูปตู้ตอนตั้งค่าครั้งแรก (baseline) ในมือถือ</div>
          </div>
        )}

        {/* ── แนบ/เปลี่ยน/ลบ รูป (แอดมินเท่านั้น · server assert ซ้ำ) ── */}
        {isAdmin ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <PhotoCaptureButton
              // key = photoUrl → รีเซ็ต state ปุ่มเมื่อรูปเปลี่ยน (ให้กด "เปลี่ยนรูป" ซ้ำได้)
              key={m.photoUrl ?? "none"}
              label={m.photoUrl ? "เปลี่ยนรูปตู้" : "แนบรูปตู้"}
              value="" // จัดการ persist เอง (onChange) — ไม่ให้ปุ่มถือ url ค้าง
              onChange={onUploaded}
              orgId={orgId}
              machineCode={m.code}
              // ไม่ผูกกับรอบเก็บเงินจริง (ไม่ใช่ uuid session) → route ไม่ล็อกสิทธิ์รอบ · คีย์รูปแยกเส้นทาง
              eventScopeId={`machine-photo-${m.id}`}
              phase="machine"
            />
            {m.photoUrl && (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <GhostBtn tone="danger" onClick={onRemove} disabled={busy}>
                  <Trash2 size={13} /> {busy ? "กำลังบันทึก…" : "ลบรูปนี้"}
                </GhostBtn>
              </div>
            )}
            {saving && <div style={{ fontSize: 12, color: "#6B7280" }}>กำลังบันทึกรูปเข้าตู้…</div>}
            {err && <ErrBox msg={err} />}
          </div>
        ) : (
          !m.photoUrl && <div style={{ fontSize: 12, color: "#9AA1AB" }}>การแนบรูปตู้ต้องเป็นแอดมิน</div>
        )}
      </div>
    </Modal>
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

/* ═══════════════════════ warehouse panel (per-branch · หลายห้อง) ═══════════════════════ */
function BranchWarehousePanel({
  branch, warehouses, onCreate, onRename, onDeactivate, onSetMain, onTransfer, settingMainId,
}: {
  branch: ManageBranchVM;
  warehouses: WarehouseVM[];
  onCreate: () => void;
  onRename: (w: WarehouseVM) => void;
  onDeactivate: (w: WarehouseVM) => void;
  onSetMain: (w: WarehouseVM) => void;
  onTransfer: () => void;
  settingMainId: string | null;
}) {
  const activeWarehouses = warehouses.filter((w) => w.isActive);
  return (
    <div style={{ padding: "14px 20px", borderBottom: "1px solid #F4F5F7" }}>
      {/* หัวแถวสาขา + ปุ่มเพิ่มคลัง/โอนของ */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: warehouses.length > 0 ? 11 : 0 }}>
        <IconBox tone="neutral" size={38} radius={10} bg="#EEF0FE" color={BRAND}><Warehouse size={17} /></IconBox>
        <div style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{branch.name} <span style={{ fontSize: 11.5, fontWeight: 500, color: "#9AA1AB" }}>({branch.code})</span></div>
          <div style={{ fontSize: 11.5, color: "#9AA1AB", marginTop: 1 }}>
            <span className="num">{activeWarehouses.length}</span> ห้องที่ใช้งาน{warehouses.length > activeWarehouses.length ? <> · <span className="num">{num(warehouses.length - activeWarehouses.length)}</span> ปิดใช้</> : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <GhostBtn onClick={onTransfer}><Send size={13} /> โอนของ</GhostBtn>
          <PrimaryBtn onClick={onCreate}><Plus size={14} /> เพิ่มคลัง</PrimaryBtn>
        </div>
      </div>

      {/* รายการห้องในสาขานี้ */}
      {warehouses.length === 0 ? (
        <div style={{ fontSize: 12, color: "#9AA1AB", background: "#F8F9FB", borderRadius: 9, padding: "10px 13px" }}>
          ยังไม่มีคลังในสาขานี้ — กด “เพิ่มคลัง” เพื่อสร้างห้องเก็บของ (ห้องแรกจะเป็นคลังหลักอัตโนมัติ)
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {warehouses.map((w) => {
            const inactive = !w.isActive;
            return (
              <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "#F8F9FB", borderRadius: 10, padding: "9px 12px", flexWrap: "wrap", opacity: inactive ? 0.65 : 1 }}>
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, flex: "0 0 26px", borderRadius: 7, background: w.isMain ? "#FEF6E0" : "#EEF0F3", color: w.isMain ? "#B7791F" : "#9AA1AB" }}>
                  {w.isMain ? <Star size={13} fill="#F0B429" color="#F0B429" /> : <PackageOpen size={13} />}
                </span>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                    {w.name}
                    {w.isMain && <Pill tone="amber">⭐ คลังหลัก</Pill>}
                    {inactive && <Pill tone="neutral">ปิดใช้</Pill>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  <GhostBtn onClick={() => onRename(w)}><Pencil size={12} /> แก้ชื่อ</GhostBtn>
                  {!w.isMain && w.isActive && (
                    <GhostBtn onClick={() => onSetMain(w)} disabled={settingMainId === w.id}>
                      <Star size={12} /> {settingMainId === w.id ? "กำลังตั้ง…" : "ตั้งเป็นคลังหลัก"}
                    </GhostBtn>
                  )}
                  {!w.isMain && w.isActive && (
                    <GhostBtn tone="danger" onClick={() => onDeactivate(w)}><PowerOff size={12} /> ปิดใช้</GhostBtn>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
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

/* ═══════════════════════ warehouse modals ═══════════════════════ */

/* ── เพิ่มคลัง ── */
function CreateWarehouseModal({ branchId, branchName, onClose, onDone }: { branchId: string; branchName: string; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit() {
    setErr(null);
    if (!name.trim()) return setErr("ใส่ชื่อคลัง");
    start(async () => {
      const res = await createWarehouse({ branchId, name: name.trim() });
      if (!res.ok) return setErr(res.error);
      onClose(); onDone();
    });
  }
  return (
    <Modal open onClose={() => !pending && onClose()} width={470} title="เพิ่มคลัง (ห้องเก็บของ)" sub={`สาขา ${branchName}`}
      footer={<ModalFooter onSubmit={submit} onCancel={() => !pending && onClose()} pending={pending} submitLabel="เพิ่มคลัง" />}>
      <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div><label style={LABEL}>ชื่อคลัง</label><input autoFocus value={name} onChange={(e) => { setName(e.target.value); setErr(null); }} placeholder="เช่น ห้องหลังร้าน · ตู้เย็น · ชั้น 2" style={FIELD} /></div>
        <div style={{ fontSize: 11.5, color: "#6B7280", background: "#F8F9FB", borderRadius: 9, padding: "9px 12px" }}>
          คลังหลัก (⭐) มีได้ห้องเดียวต่อสาขา · ห้องใหม่จะเป็นห้องธรรมดา ต้องกด “ตั้งเป็นคลังหลัก” ถ้าอยากให้เป็นห้องรับของเข้าค่าเริ่มต้น
        </div>
        {err && <ErrBox msg={err} />}
      </div>
    </Modal>
  );
}

/* ── แก้ชื่อคลัง ── */
function RenameWarehouseModal({ id, current, branchName, onClose, onDone }: { id: string; current: string; branchName: string; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(current);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit() {
    setErr(null);
    if (!name.trim()) return setErr("ใส่ชื่อคลัง");
    start(async () => {
      const res = await renameWarehouse({ warehouseId: id, name: name.trim() });
      if (!res.ok) return setErr(res.error);
      onClose(); onDone();
    });
  }
  return (
    <Modal open onClose={() => !pending && onClose()} width={470} title="แก้ชื่อคลัง" sub={`สาขา ${branchName} · เดิม: ${current}`}
      footer={<ModalFooter onSubmit={submit} onCancel={() => !pending && onClose()} pending={pending} submitLabel="บันทึก" />}>
      <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div><label style={LABEL}>ชื่อคลัง</label><input autoFocus value={name} onChange={(e) => { setName(e.target.value); setErr(null); }} style={FIELD} /></div>
        {err && <ErrBox msg={err} />}
      </div>
    </Modal>
  );
}

/* ── ปิดใช้คลัง (destructive confirm · surface server guard error) ── */
function DeactivateWarehouseModal({ id, name, branchName, onClose, onDone }: { id: string; name: string; branchName: string; onClose: () => void; onDone: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit() {
    setErr(null);
    start(async () => {
      // server กันเอง: ปิดคลังหลักไม่ได้ · ปิดคลังที่ยังมีของค้างไม่ได้ (ต้องโอนออกก่อน) → แสดง error ตรง ๆ
      const res = await deactivateWarehouse({ warehouseId: id });
      if (!res.ok) return setErr(res.error);
      onClose(); onDone();
    });
  }
  return (
    <Modal open onClose={() => !pending && onClose()} width={460} title="ปิดใช้คลัง" sub={`สาขา ${branchName} · ${name}`}
      footer={<ModalFooter onSubmit={submit} onCancel={() => !pending && onClose()} pending={pending} submitLabel="ยืนยันปิดใช้คลัง" danger />}>
      <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 12.5, color: "#6B7280", background: "#F8F9FB", borderRadius: 9, padding: "11px 13px" }}>
          ปิดใช้ = ห้องนี้จะไม่ขึ้นให้เลือกตอนรับของ/นับสต๊อก/เติมตู้อีก แต่ประวัติเดิมยังอยู่ครบ · ปิดได้เฉพาะห้องที่ <b>ไม่ใช่คลังหลัก</b> และ <b>ไม่มีของค้าง</b> (โอนออกให้หมดก่อน)
        </div>
        {err && <ErrBox msg={err} />}
      </div>
    </Modal>
  );
}

/* ── โอนของระหว่างคลัง (ในสาขา ห้อง→ห้อง · ข้ามสาขา → คลังหลักปลายทางอัตโนมัติ) ── */
function TransferWarehouseModal({
  fromBranchId, fromBranchName, branches, warehousesByBranch, products, onClose, onDone,
}: {
  fromBranchId: string;
  fromBranchName: string;
  branches: ManageBranchVM[];
  warehousesByBranch: Record<string, WarehouseVM[]>;
  products: TransferProductVM[];
  onClose: () => void;
  onDone: () => void;
}) {
  const fromWarehouses = (warehousesByBranch[fromBranchId] ?? []).filter((w) => w.isActive);
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [fromWarehouseId, setFromWarehouseId] = useState(fromWarehouses.find((w) => w.isMain)?.id ?? fromWarehouses[0]?.id ?? "");
  // ปลายทาง: "same" = ห้องอื่นในสาขาเดียวกัน · "cross" = สาขาอื่น (เข้าคลังหลักปลายทางอัตโนมัติ)
  const [destMode, setDestMode] = useState<"same" | "cross">("same");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [toBranchId, setToBranchId] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // ห้องปลายทางในสาขาเดียวกัน (ตัดห้องต้นทางออก · เฉพาะ active)
  const sameBranchDestOptions = fromWarehouses.filter((w) => w.id !== fromWarehouseId);
  // สาขาอื่น (ตัดสาขาต้นทางออก)
  const otherBranches = branches.filter((b) => b.id !== fromBranchId);
  const selectedProduct = products.find((p) => p.id === productId);

  function submit() {
    setErr(null);
    if (!productId) return setErr("เลือกสินค้าที่จะโอน");
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) return setErr("ใส่จำนวนที่จะโอน (มากกว่า 0)");
    if (!fromWarehouseId) return setErr("เลือกคลังต้นทาง");
    if (destMode === "same") {
      if (!toWarehouseId) return setErr("เลือกคลังปลายทาง");
      if (toWarehouseId === fromWarehouseId) return setErr("คลังต้นทางและปลายทางต้องต่างกัน");
    } else {
      if (!toBranchId) return setErr("เลือกสาขาปลายทาง");
    }
    start(async () => {
      const res = await transferBetweenWarehouses({
        fromBranchId,
        fromWarehouseId,
        toBranchId: destMode === "same" ? fromBranchId : toBranchId,
        // ข้ามสาขา → ไม่ส่ง toWarehouseId → server เข้าคลังหลักสาขาปลายทางอัตโนมัติ
        toWarehouseId: destMode === "same" ? toWarehouseId : undefined,
        productId,
        qty: q,
        note: note.trim() || undefined,
      });
      if (!res.ok) return setErr(res.error);
      onClose(); onDone();
    });
  }

  return (
    <Modal open onClose={() => !pending && onClose()} width={520} title="โอนของระหว่างคลัง" sub={`ต้นทาง: สาขา ${fromBranchName}`}
      footer={<ModalFooter onSubmit={submit} onCancel={() => !pending && onClose()} pending={pending} submitLabel="ยืนยันโอน" />}>
      <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        {/* สินค้า */}
        <div>
          <label style={LABEL}>สินค้า</label>
          {products.length === 0 ? (
            <div style={{ fontSize: 12, color: "#9AA1AB", background: "#F8F9FB", borderRadius: 9, padding: "10px 12px" }}>สาขานี้ยังไม่มีสินค้าในคลังให้โอน</div>
          ) : (
            <select autoFocus value={productId} onChange={(e) => { setProductId(e.target.value); setErr(null); }} style={FIELD}>
              <option value="">— เลือกสินค้า —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} (คงเหลือสาขา {p.onHand})</option>)}
            </select>
          )}
        </div>
        {/* จำนวน */}
        <div>
          <label style={LABEL}>จำนวนที่โอน{selectedProduct ? ` (คงเหลือสาขา ${selectedProduct.onHand})` : ""}</label>
          <input inputMode="numeric" value={qty} onChange={(e) => { setQty(e.target.value.replace(/[^0-9]/g, "")); setErr(null); }} placeholder="เช่น 10" style={FIELD} />
        </div>
        {/* คลังต้นทาง */}
        <div>
          <label style={LABEL}>คลังต้นทาง (ในสาขา {fromBranchName})</label>
          <select value={fromWarehouseId} onChange={(e) => { setFromWarehouseId(e.target.value); setErr(null); }} style={FIELD}>
            {fromWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}{w.isMain ? " ⭐" : ""}</option>)}
          </select>
        </div>
        {/* ปลายทาง: toggle ห้องในสาขา / สาขาอื่น */}
        <div>
          <label style={LABEL}>โอนไปที่</label>
          <div style={{ display: "flex", gap: 9, marginBottom: 10 }}>
            {([["same", "ห้องอื่นในสาขานี้"], ["cross", "ไปสาขาอื่น"]] as const).map(([mode, label]) => (
              <button key={mode} type="button" onClick={() => { setDestMode(mode); setErr(null); }}
                style={{ flex: 1, cursor: "pointer", padding: "9px 0", borderRadius: 10, fontSize: 12.5, fontWeight: 700, border: `1.5px solid ${destMode === mode ? BRAND : "#E3E6EA"}`, background: destMode === mode ? "#EEF0FE" : "#fff", color: destMode === mode ? BRAND : "#6B7280" }}>
                {label}
              </button>
            ))}
          </div>
          {destMode === "same" ? (
            <select value={toWarehouseId} onChange={(e) => { setToWarehouseId(e.target.value); setErr(null); }} style={FIELD}>
              <option value="">— เลือกคลังปลายทาง —</option>
              {sameBranchDestOptions.map((w) => <option key={w.id} value={w.id}>{w.name}{w.isMain ? " ⭐" : ""}</option>)}
            </select>
          ) : (
            <>
              <select value={toBranchId} onChange={(e) => { setToBranchId(e.target.value); setErr(null); }} style={FIELD}>
                <option value="">— เลือกสาขาปลายทาง —</option>
                {otherBranches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
              </select>
              {/* ปลายทางข้ามสาขา = คลังหลักอัตโนมัติ (disabled hint) */}
              <input disabled value="เข้าคลังหลักของสาขาปลายทางอัตโนมัติ"
                style={{ ...FIELD, marginTop: 8, background: "#F8F9FB", color: "#9AA1AB", cursor: "not-allowed" }} />
            </>
          )}
        </div>
        {/* หมายเหตุ */}
        <div><label style={LABEL}>หมายเหตุ (ไม่บังคับ)</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น เกลี่ยของหน้าเทศกาล" style={FIELD} /></div>
        {err && <ErrBox msg={err} />}
      </div>
    </Modal>
  );
}
