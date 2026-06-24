"use client";

import { cloneElement, isValidElement, useEffect, useId, useState, useTransition } from "react";
import type { ReactElement } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, X, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { actSaveUnit, actDeleteUnit } from "../../_actions";

type UnitStatus = "vacant" | "occupied" | "reserved" | "inactive";

type EditableUnit = {
  id: string;
  code: string;
  name?: string | null;
  building?: string | null;
  floor?: number | null;
  zone?: string | null;
  areaSqm?: unknown;
  baseRentThb?: unknown;
  status?: string | null;
  sortOrder?: number | null;
};

const STATUS_OPTIONS: { value: UnitStatus; label: string }[] = [
  { value: "vacant", label: "ว่าง" },
  { value: "occupied", label: "มีผู้เช่า" },
  { value: "reserved", label: "จอง" },
  { value: "inactive", label: "ปิดใช้งาน" },
];

function num(v: unknown): string {
  if (v == null) return "";
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? String(n) : "";
}

export default function UnitForm({
  projectId,
  unit,
  triggerLabel,
}: {
  projectId: string;
  unit?: EditableUnit | null;
  triggerLabel?: string;
}) {
  const router = useRouter();
  const isEdit = !!unit;
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const [code, setCode] = useState(unit?.code ?? "");
  const [name, setName] = useState(unit?.name ?? "");
  const [building, setBuilding] = useState(unit?.building ?? "");
  const [floor, setFloor] = useState(num(unit?.floor));
  const [zone, setZone] = useState(unit?.zone ?? "");
  const [areaSqm, setAreaSqm] = useState(num(unit?.areaSqm));
  const [baseRent, setBaseRent] = useState(num(unit?.baseRentThb));
  const [status, setStatus] = useState<UnitStatus>((unit?.status as UnitStatus) ?? "vacant");
  const [sortOrder, setSortOrder] = useState(num(unit?.sortOrder));

  // reset fields whenever the dialog opens (so edit reflects latest props)
  useEffect(() => {
    if (!open) return;
    setCode(unit?.code ?? "");
    setName(unit?.name ?? "");
    setBuilding(unit?.building ?? "");
    setFloor(num(unit?.floor));
    setZone(unit?.zone ?? "");
    setAreaSqm(num(unit?.areaSqm));
    setBaseRent(num(unit?.baseRentThb));
    setStatus((unit?.status as UnitStatus) ?? "vacant");
    setSortOrder(num(unit?.sortOrder));
  }, [open, unit]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  function save() {
    if (!code.trim()) {
      toast.error("กรุณากรอกรหัสห้อง");
      return;
    }
    start(async () => {
      try {
        await actSaveUnit({
          id: unit?.id,
          projectId,
          code: code.trim(),
          name: name.trim() || undefined,
          building: building.trim() || undefined,
          floor: floor.trim() ? Number(floor) : undefined,
          zone: zone.trim() || undefined,
          areaSqm: areaSqm.trim() ? Number(areaSqm) : undefined,
          baseRentThb: baseRent.trim() ? Number(baseRent) : undefined,
          status,
          sortOrder: sortOrder.trim() ? Number(sortOrder) : undefined,
        });
        toast.success(isEdit ? "บันทึกห้องแล้ว" : "เพิ่มห้องแล้ว");
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  function remove() {
    if (!unit?.id) return;
    if (!confirm(`ลบห้อง ${unit.code}? (ปิดใช้งาน — ไม่สามารถลบได้ถ้ามีสัญญาที่ใช้งานอยู่)`)) return;
    start(async () => {
      try {
        await actDeleteUnit(unit.id);
        toast.success("ลบห้องแล้ว");
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={isEdit ? "rs-btn rs-btn-ghost" : "rs-btn"}
      >
        {isEdit ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        {triggerLabel ?? (isEdit ? "แก้ไขห้อง" : "เพิ่มห้อง")}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          style={{ background: "rgba(15,23,42,0.45)" }}
          onClick={() => setOpen(false)}
        >
          <div
            className="rs-card w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-b-none sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={isEdit ? "แก้ไขห้อง" : "เพิ่มห้อง"}
          >
            <div
              className="sticky top-0 flex items-center justify-between px-5 py-4 border-b"
              style={{ borderColor: "var(--rs-border)", background: "#fff" }}
            >
              <h2 className="text-lg font-bold" style={{ color: "var(--rs-text)" }}>
                {isEdit ? `แก้ไขห้อง ${unit?.code}` : "เพิ่มห้อง"}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="-mr-2 inline-flex size-11 sm:size-9 items-center justify-center rounded-lg"
                style={{ color: "var(--rs-text-3)" }}
                aria-label="ปิด"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="รหัสห้อง *">
                  <input className="rs-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="A101" />
                </Field>
                <Field label="ชื่อห้อง">
                  <input className="rs-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="ร้านกาแฟ" />
                </Field>
                <Field label="อาคาร">
                  <input className="rs-input" value={building} onChange={(e) => setBuilding(e.target.value)} placeholder="A" />
                </Field>
                <Field label="ชั้น">
                  <input className="rs-input" type="number" value={floor} onChange={(e) => setFloor(e.target.value)} />
                </Field>
                <Field label="โซน">
                  <input className="rs-input" value={zone} onChange={(e) => setZone(e.target.value)} />
                </Field>
                <Field label="พื้นที่ (ตร.ม.)">
                  <input className="rs-input" type="number" value={areaSqm} onChange={(e) => setAreaSqm(e.target.value)} />
                </Field>
                <Field label="ค่าเช่าพื้นฐาน (บาท)">
                  <input className="rs-input" type="number" value={baseRent} onChange={(e) => setBaseRent(e.target.value)} />
                </Field>
                <Field label="สถานะ">
                  <select className="rs-input" value={status} onChange={(e) => setStatus(e.target.value as UnitStatus)}>
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="ลำดับการแสดง">
                  <input className="rs-input" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
                </Field>
              </div>
            </div>

            <div
              className="sticky bottom-0 flex items-center justify-between gap-2 px-5 py-4 border-t"
              style={{ borderColor: "var(--rs-border)", background: "#fff" }}
            >
              {isEdit ? (
                <button
                  type="button"
                  onClick={remove}
                  disabled={pending}
                  className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium"
                  style={{ color: "var(--rs-danger)" }}
                >
                  <Trash2 className="h-4 w-4" /> ลบห้อง
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setOpen(false)} className="rs-btn rs-btn-ghost min-h-[44px] sm:min-h-0" disabled={pending}>
                  ยกเลิก
                </button>
                <button type="button" onClick={save} className="rs-btn min-h-[44px] sm:min-h-0" disabled={pending}>
                  {pending ? "กำลังบันทึก…" : "บันทึก"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .rs-input {
          width: 100%;
          height: 42px;
          padding: 0 12px;
          border-radius: 10px;
          border: 1px solid var(--rs-border);
          background: #fff;
          color: var(--rs-text);
          font-size: 14px;
        }
        .rs-input:focus {
          outline: none;
          border-color: var(--rs-brand);
          box-shadow: 0 0 0 3px var(--rs-brand-50);
        }
      `}</style>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string; "aria-label"?: string }>, { id, "aria-label": label })
    : children;
  return (
    <div className="block">
      <label htmlFor={id} className="block text-[12.5px] font-medium mb-1" style={{ color: "var(--rs-text-2)" }}>
        {label}
      </label>
      {control}
    </div>
  );
}
