"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Plus, X, Trash2, GripVertical, Pencil, Check } from "lucide-react";
import {
  actSaveBuilding,
  actDeleteBuilding,
  actReorderBuildings,
  actMoveUnitToBuilding,
} from "../../_actions";

type Bld = { id: string; name: string; zone: string | null; sortOrder: number };
type Unit = { id: string; code: string; name: string | null; buildingId: string | null; status: string };

const UNASSIGNED = "__none__";

/**
 * จัดการอาคาร/โซนเอง — สร้าง/เปลี่ยนชื่อ/ลบ/ลากเรียงอาคาร + ลากย้ายห้องเข้าอาคาร.
 * ลากด้วย HTML5 drag ในตัว (ไม่ลง package) · มี dropdown สำรองสำหรับย้ายห้องเผื่อลากไม่ถนัด.
 */
export default function BuildingManager({
  projectId,
  buildings: initialBuildings,
  units: initialUnits,
}: {
  projectId: string;
  buildings: Bld[];
  units: Unit[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [buildings, setBuildings] = useState<Bld[]>(initialBuildings);
  const [units, setUnits] = useState<Unit[]>(initialUnits);
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editZone, setEditZone] = useState("");
  const [dragBld, setDragBld] = useState<string | null>(null);
  const [dragUnit, setDragUnit] = useState<string | null>(null);
  const [overBld, setOverBld] = useState<string | null>(null);

  function resync() {
    router.refresh();
  }

  function unitsOf(bid: string | null) {
    return units.filter((u) => (bid === UNASSIGNED ? u.buildingId == null : u.buildingId === bid));
  }

  // ── create ──
  function createBuilding() {
    const name = newName.trim();
    if (!name) return;
    start(async () => {
      try {
        const res = await actSaveBuilding({ projectId, name });
        setBuildings((b) => [...b, { id: res.id, name, zone: null, sortOrder: (b.at(-1)?.sortOrder ?? 0) + 1 }]);
        setNewName("");
        toast.success(`สร้างอาคาร "${name}" แล้ว`);
        resync();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "สร้างไม่สำเร็จ");
      }
    });
  }

  // ── rename / zone ──
  function startEdit(b: Bld) {
    setEditId(b.id);
    setEditName(b.name);
    setEditZone(b.zone ?? "");
  }
  function saveEdit() {
    if (!editId) return;
    const name = editName.trim();
    if (!name) return toast.error("ชื่ออาคารห้ามว่าง");
    start(async () => {
      try {
        await actSaveBuilding({ id: editId, projectId, name, zone: editZone.trim() || undefined });
        setBuildings((bs) => bs.map((b) => (b.id === editId ? { ...b, name, zone: editZone.trim() || null } : b)));
        setEditId(null);
        toast.success("บันทึกชื่ออาคารแล้ว");
        resync();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  // ── delete ──
  function deleteBuilding(b: Bld) {
    const n = unitsOf(b.id).length;
    if (!confirm(n > 0 ? `ลบอาคาร "${b.name}"? ห้อง ${n} ห้องจะย้ายไป "ไม่ระบุอาคาร" (ไม่ลบห้อง)` : `ลบอาคาร "${b.name}"?`)) return;
    start(async () => {
      try {
        await actDeleteBuilding(b.id);
        setUnits((us) => us.map((u) => (u.buildingId === b.id ? { ...u, buildingId: null } : u)));
        setBuildings((bs) => bs.filter((x) => x.id !== b.id));
        toast.success("ลบอาคารแล้ว");
        resync();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
      }
    });
  }

  // ── reorder buildings (drag) ──
  function onBldDrop(targetId: string) {
    if (!dragBld || dragBld === targetId) return;
    const arr = [...buildings];
    const from = arr.findIndex((b) => b.id === dragBld);
    const to = arr.findIndex((b) => b.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    setBuildings(arr);
    setDragBld(null);
    const orderedIds = arr.map((b) => b.id);
    start(async () => {
      try {
        await actReorderBuildings(projectId, orderedIds);
        resync();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "เรียงลำดับไม่สำเร็จ");
        resync();
      }
    });
  }

  // ── move unit to building ──
  function moveUnit(unitId: string, buildingId: string | null) {
    setUnits((us) => us.map((u) => (u.id === unitId ? { ...u, buildingId } : u)));
    start(async () => {
      try {
        await actMoveUnitToBuilding(unitId, buildingId);
        resync();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ย้ายห้องไม่สำเร็จ");
        resync();
      }
    });
  }

  const inputStyle: React.CSSProperties = {
    height: 38,
    padding: "0 10px",
    borderRadius: 9,
    border: "1px solid var(--rs-border)",
    background: "var(--rs-bg-2)",
    color: "var(--rs-text)",
    fontSize: 14,
  };

  const unassignedCount = unitsOf(UNASSIGNED).length;

  return (
    <>
      <button className="rs-btn rs-btn-ghost" onClick={() => setOpen(true)}>
        <Building2 className="h-4 w-4" /> จัดการอาคาร
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="rs-card w-full sm:max-w-3xl max-h-[90vh] flex flex-col rounded-b-none sm:rounded-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b" style={{ borderColor: "var(--rs-border)" }}>
              <div className="flex items-center gap-2 font-bold text-lg" style={{ color: "var(--rs-text)" }}>
                <Building2 className="h-5 w-5" style={{ color: "var(--rs-brand)" }} /> จัดการอาคาร / โซน
              </div>
              <button onClick={() => setOpen(false)} disabled={pending} className="-mr-2 inline-flex size-11 sm:size-9 items-center justify-center rounded-lg hover:bg-black/5" aria-label="ปิด">
                <X className="h-5 w-5" style={{ color: "var(--rs-text-2)" }} />
              </button>
            </div>

            <div className="px-5 py-4 overflow-y-auto flex-1 space-y-3">
              <p className="text-[12.5px]" style={{ color: "var(--rs-text-3)" }}>
                ลากที่จับ <GripVertical className="inline h-3.5 w-3.5" /> เพื่อเรียงลำดับอาคาร · ลากชิปห้องไปวางในอาคารที่ต้องการ (หรือใช้เมนูเลือกอาคารบนชิป)
              </p>

              {/* create */}
              <div className="flex flex-wrap gap-2">
                <input
                  style={{ ...inputStyle }}
                  className="min-w-0 flex-1 basis-[180px]"
                  placeholder="ชื่ออาคารใหม่ (เช่น A4, อาคารหน้า)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createBuilding()}
                />
                <button className="rs-btn min-h-[44px] sm:min-h-0 shrink-0" onClick={createBuilding} disabled={pending || !newName.trim()}>
                  <Plus className="h-4 w-4" /> สร้างอาคาร
                </button>
              </div>

              {/* buildings */}
              {buildings.map((b) => {
                const roomsHere = unitsOf(b.id);
                return (
                  <div
                    key={b.id}
                    draggable={editId !== b.id}
                    onDragStart={() => setDragBld(b.id)}
                    onDragEnd={() => setDragBld(null)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setOverBld(b.id);
                    }}
                    onDragLeave={() => setOverBld((o) => (o === b.id ? null : o))}
                    onDrop={(e) => {
                      e.preventDefault();
                      setOverBld(null);
                      if (dragUnit) {
                        moveUnit(dragUnit, b.id);
                        setDragUnit(null);
                      } else if (dragBld) {
                        onBldDrop(b.id);
                      }
                    }}
                    className="rounded-xl border p-3"
                    style={{
                      borderColor: overBld === b.id ? "var(--rs-brand)" : "var(--rs-border)",
                      background: overBld === b.id ? "var(--rs-brand-50)" : "#fff",
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <GripVertical className="h-4 w-4 shrink-0 cursor-grab" style={{ color: "var(--rs-text-3)" }} />
                      {editId === b.id ? (
                        <>
                          <input style={{ ...inputStyle }} className="min-w-0 flex-1 basis-[140px]" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="ชื่ออาคาร" />
                          <input style={{ ...inputStyle }} className="min-w-0 basis-[90px] flex-1 sm:flex-none sm:basis-[110px]" value={editZone} onChange={(e) => setEditZone(e.target.value)} placeholder="โซน" />
                          <button className="rs-btn !h-11 !px-3 sm:!h-9 sm:!px-2.5" onClick={saveEdit} disabled={pending} aria-label="บันทึก">
                            <Check className="h-4 w-4" />
                          </button>
                          <button className="rs-btn rs-btn-ghost !h-11 !px-3 sm:!h-9 sm:!px-2.5" onClick={() => setEditId(null)} aria-label="ยกเลิก">
                            <X className="h-4 w-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="flex-1 min-w-0">
                            <span className="font-bold" style={{ color: "var(--rs-text)" }}>{b.name}</span>
                            {b.zone ? <span className="ml-1.5 text-[12px]" style={{ color: "var(--rs-text-3)" }}>· โซน {b.zone}</span> : null}
                            <span className="ml-1.5 text-[12px]" style={{ color: "var(--rs-text-3)" }}>· {roomsHere.length} ห้อง</span>
                          </div>
                          <button className="rs-btn rs-btn-ghost !size-11 !p-0 sm:!h-8 sm:!w-auto sm:!px-2" onClick={() => startEdit(b)} title="แก้ชื่อ/โซน" aria-label="แก้ชื่อ/โซน">
                            <Pencil className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                          </button>
                          <button className="rs-btn rs-btn-ghost !size-11 !p-0 sm:!h-8 sm:!w-auto sm:!px-2" style={{ color: "var(--rs-danger)" }} onClick={() => deleteBuilding(b)} title="ลบอาคาร" aria-label="ลบอาคาร">
                            <Trash2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                          </button>
                        </>
                      )}
                    </div>

                    {/* rooms in this building */}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {roomsHere.length === 0 ? (
                        <span className="text-[12px]" style={{ color: "var(--rs-text-3)" }}>— ลากห้องมาวางที่นี่ —</span>
                      ) : (
                        roomsHere.map((u) => <RoomChip key={u.id} u={u} buildings={buildings} onDragStart={() => setDragUnit(u.id)} onMove={moveUnit} />)
                      )}
                    </div>
                  </div>
                );
              })}

              {/* unassigned bucket */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverBld(UNASSIGNED);
                }}
                onDragLeave={() => setOverBld((o) => (o === UNASSIGNED ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOverBld(null);
                  if (dragUnit) {
                    moveUnit(dragUnit, null);
                    setDragUnit(null);
                  }
                }}
                className="rounded-xl border border-dashed p-3"
                style={{
                  borderColor: overBld === UNASSIGNED ? "var(--rs-brand)" : "var(--rs-border)",
                  background: overBld === UNASSIGNED ? "var(--rs-brand-50)" : "var(--rs-bg-2)",
                }}
              >
                <div className="text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text-2)" }}>
                  ไม่ระบุอาคาร <span style={{ color: "var(--rs-text-3)" }}>· {unassignedCount} ห้อง</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {unassignedCount === 0 ? (
                    <span className="text-[12px]" style={{ color: "var(--rs-text-3)" }}>— ทุกห้องอยู่ในอาคารแล้ว —</span>
                  ) : (
                    unitsOf(UNASSIGNED).map((u) => <RoomChip key={u.id} u={u} buildings={buildings} onDragStart={() => setDragUnit(u.id)} onMove={moveUnit} />)
                  )}
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t text-right" style={{ borderColor: "var(--rs-border)" }}>
              <button className="rs-btn" onClick={() => setOpen(false)}>เสร็จสิ้น</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function RoomChip({
  u,
  buildings,
  onDragStart,
  onMove,
}: {
  u: Unit;
  buildings: Bld[];
  onDragStart: () => void;
  onMove: (unitId: string, buildingId: string | null) => void;
}) {
  return (
    <span
      draggable
      onDragStart={onDragStart}
      className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[12px] cursor-grab"
      style={{ borderColor: "var(--rs-border)", background: "#fff", color: "var(--rs-text)" }}
      title={u.name || u.code}
    >
      <GripVertical className="h-3 w-3" style={{ color: "var(--rs-text-3)" }} />
      <b>{u.code}</b>
      {u.name ? <span style={{ color: "var(--rs-text-3)" }} className="max-w-[90px] truncate">{u.name}</span> : null}
      {/* dropdown สำรอง (เผื่อลากไม่ถนัดบนมือถือ) */}
      <select
        value={u.buildingId ?? ""}
        onChange={(e) => onMove(u.id, e.target.value || null)}
        className="ml-0.5 bg-transparent text-[11px] outline-none cursor-pointer"
        style={{ color: "var(--rs-brand)" }}
        title="ย้ายไปอาคาร"
        onClick={(e) => e.stopPropagation()}
      >
        <option value="">ไม่ระบุ</option>
        {buildings.map((b) => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </select>
    </span>
  );
}
