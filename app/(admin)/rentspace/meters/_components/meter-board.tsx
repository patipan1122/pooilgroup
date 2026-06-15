"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Zap, Droplet, Check, Loader2, Camera, AlertTriangle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { formatBaht, periodLabel, prevPeriod } from "@/lib/rentspace/format";
import { actSaveMeterReading, actUploadFile } from "../../_actions";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB UX guard (server also enforces)

/**
 * Live usage preview ONLY (the server in actSaveMeterReading is the source of
 * truth — mirrors computeMeterUsage in lib/rentspace/billing.ts). Kept inline
 * so this client bundle never imports the server-only billing engine (prisma).
 */
function previewUsage(prev: number | null, curr: number | null, isReset: boolean, oldFinal: number | null): number | null {
  if (curr == null) return null;
  const p = prev ?? 0;
  if (isReset) {
    const of = oldFinal ?? 0;
    return Math.max(0, of - p) + Math.max(0, curr);
  }
  if (prev == null) return null;
  return Math.max(0, curr - p);
}

export type BoardSide = {
  prevReading: number | null;
  currReading: number | null;
  usage: number | null;
  amount: number | null;
  photoUrl: string | null;
  isReset: boolean;
  oldMeterFinal: number | null;
};

export type BoardUnit = {
  id: string;
  code: string;
  name: string | null;
  building: string | null;
  tenant: string | null;
  electric: BoardSide;
  water: BoardSide;
};

type Kind = "electric" | "water";

// editable per-side local state
type SideState = {
  prev: number | null;
  curr: string; // raw input value
  usage: number | null;
  amount: number | null;
  saved: boolean; // currReading exists in DB and matches input
  dirty: boolean;
  saving: boolean;
  photoUrl: string | null; // meter photo on the saved reading (if any)
  uploading: boolean; // photo upload/attach in progress
  isReset: boolean; // มิเตอร์ครบรอบ / เปลี่ยนมิเตอร์
  oldFinal: string; // raw input value for เลขมิเตอร์เดิมก่อนเปลี่ยน (oldMeterFinal)
};

type RowState = {
  electric: SideState;
  water: SideState;
};

function initSide(s: BoardSide): SideState {
  return {
    prev: s.prevReading,
    curr: s.currReading != null ? String(s.currReading) : "",
    usage: s.usage,
    amount: s.amount,
    saved: s.currReading != null,
    dirty: false,
    saving: false,
    photoUrl: s.photoUrl,
    uploading: false,
    isReset: s.isReset,
    oldFinal: s.oldMeterFinal != null ? String(s.oldMeterFinal) : "",
  };
}

/** Parse an input value safely → number or null (never NaN). */
function parseReading(v: string): number | null {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export default function MeterBoard({
  units,
  period,
}: {
  units: BoardUnit[];
  period: string;
}) {
  const router = useRouter();
  const [navPending, startNav] = useTransition();

  const [rows, setRows] = useState<Record<string, RowState>>(() => {
    const init: Record<string, RowState> = {};
    for (const u of units) {
      init[u.id] = { electric: initSide(u.electric), water: initSide(u.water) };
    }
    return init;
  });
  const [savingAll, setSavingAll] = useState(false);

  // refs for keyboard nav (Enter → next row, same column)
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const refKey = (unitId: string, kind: Kind) => `${unitId}:${kind}`;

  const unitMeta = useMemo(() => {
    const m = new Map<string, BoardUnit>();
    for (const u of units) m.set(u.id, u);
    return m;
  }, [units]);

  function setSide(unitId: string, kind: Kind, patch: Partial<SideState>) {
    setRows((prev) => ({
      ...prev,
      [unitId]: { ...prev[unitId], [kind]: { ...prev[unitId][kind], ...patch } },
    }));
  }

  function onChange(unitId: string, kind: Kind, value: string) {
    const side = rows[unitId][kind];
    const parsed = parseReading(value);
    const oldFinal = parseReading(side.oldFinal);
    const liveUsage = previewUsage(side.prev, parsed, side.isReset, oldFinal);
    setSide(unitId, kind, {
      curr: value,
      usage: liveUsage,
      dirty: true,
      saved: false,
    });
  }

  /** Toggle "มิเตอร์เต็ม/เปลี่ยนมิเตอร์" for one side; recomputes live usage. */
  function toggleReset(unitId: string, kind: Kind) {
    const side = rows[unitId][kind];
    const next = !side.isReset;
    const parsed = parseReading(side.curr);
    const oldFinal = parseReading(side.oldFinal);
    setSide(unitId, kind, {
      isReset: next,
      usage: previewUsage(side.prev, parsed, next, oldFinal),
      dirty: true,
      saved: false,
    });
  }

  /** Edit "เลขมิเตอร์เดิมก่อนเปลี่ยน (oldMeterFinal)"; recomputes live usage. */
  function onOldFinalChange(unitId: string, kind: Kind, value: string) {
    const side = rows[unitId][kind];
    const parsed = parseReading(side.curr);
    const oldFinal = parseReading(value);
    setSide(unitId, kind, {
      oldFinal: value,
      usage: previewUsage(side.prev, parsed, side.isReset, oldFinal),
      dirty: true,
      saved: false,
    });
  }

  async function saveSide(unitId: string, kind: Kind): Promise<boolean> {
    const side = rows[unitId][kind];
    const curr = parseReading(side.curr);
    if (curr == null) return false; // empty / invalid → skip, never send NaN
    if (!side.dirty && side.saved) return true; // nothing to do

    const oldFinal = parseReading(side.oldFinal);
    // GUARD: curr < prev with no reset = almost certainly a rollover / swap.
    // Block the save so we never persist a (clamped) 0-usage by accident.
    if (!side.isReset && side.prev != null && curr < side.prev) {
      toast.error(
        "เลขน้อยกว่าเดือนก่อน — มิเตอร์ครบรอบ/เปลี่ยนหรือไม่? เปิด 'มิเตอร์เต็ม/เปลี่ยน'",
      );
      return false;
    }
    // if reset is ON, oldMeterFinal is required (it's the final reading of the old meter)
    if (side.isReset && oldFinal == null) {
      toast.error("กรอก 'เลขมิเตอร์เดิมก่อนเปลี่ยน' ก่อนบันทึก");
      return false;
    }

    setSide(unitId, kind, { saving: true });
    try {
      const res = await actSaveMeterReading({
        unitId,
        kind,
        period,
        currReading: curr,
        isReset: side.isReset,
        oldMeterFinal: side.isReset && oldFinal != null ? oldFinal : undefined,
      });
      setSide(unitId, kind, {
        saving: false,
        saved: true,
        dirty: false,
        usage: res.usage,
        amount: res.amountThb,
      });
      const u = unitMeta.get(unitId);
      const label = kind === "electric" ? "ค่าไฟ" : "ค่าน้ำ";
      toast.success(
        `${u?.code ?? "ห้อง"} · ${label} ${res.usage} หน่วย = ${formatBaht(res.amountThb)}`,
      );
      return true;
    } catch (e) {
      setSide(unitId, kind, { saving: false });
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      return false;
    }
  }

  /** Read a File → dataURL (base64). */
  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
      reader.readAsDataURL(file);
    });
  }

  /** Upload a meter photo and attach it onto this kind's reading. */
  async function attachPhoto(unitId: string, kind: Kind, file: File) {
    const side = rows[unitId][kind];
    const curr = parseReading(side.curr);
    const oldFinal = parseReading(side.oldFinal);
    // require a reading value first — photo attaches onto the reading row
    if (curr == null) {
      toast.error("กรอกเลขมิเตอร์ก่อนแนบรูป");
      return;
    }
    // same rollover guard as saveSide — don't (re)save a bad reading via photo
    if (!side.isReset && side.prev != null && curr < side.prev) {
      toast.error(
        "เลขน้อยกว่าเดือนก่อน — มิเตอร์ครบรอบ/เปลี่ยนหรือไม่? เปิด 'มิเตอร์เต็ม/เปลี่ยน'",
      );
      return;
    }
    if (side.isReset && oldFinal == null) {
      toast.error("กรอก 'เลขมิเตอร์เดิมก่อนเปลี่ยน' ก่อนแนบรูป");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      toast.error("รูปใหญ่เกินไป (เกิน 8MB)");
      return;
    }
    setSide(unitId, kind, { uploading: true });
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const { url } = await actUploadFile({ sub: "meter", dataUrl });
      // attach the photo onto the reading (also (re)saves currReading)
      const res = await actSaveMeterReading({
        unitId,
        kind,
        period,
        currReading: curr,
        photoUrl: url,
        isReset: side.isReset,
        oldMeterFinal: side.isReset && oldFinal != null ? oldFinal : undefined,
      });
      setSide(unitId, kind, {
        uploading: false,
        saving: false,
        saved: true,
        dirty: false,
        usage: res.usage,
        amount: res.amountThb,
        photoUrl: url,
      });
      const label = kind === "electric" ? "ไฟ" : "น้ำ";
      toast.success(`แนบรูปมิเตอร์${label}แล้ว`);
    } catch (e) {
      setSide(unitId, kind, { uploading: false });
      toast.error(e instanceof Error ? e.message : "แนบรูปไม่สำเร็จ");
    }
  }

  function focusNext(unitId: string, kind: Kind) {
    const idx = units.findIndex((u) => u.id === unitId);
    const next = units[idx + 1];
    if (next) {
      inputRefs.current[refKey(next.id, kind)]?.focus();
      inputRefs.current[refKey(next.id, kind)]?.select();
    }
  }

  async function onKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    unitId: string,
    kind: Kind,
  ) {
    if (e.key === "Enter") {
      e.preventDefault();
      await saveSide(unitId, kind);
      focusNext(unitId, kind);
    }
  }

  async function saveAll() {
    setSavingAll(true);
    let count = 0;
    for (const u of units) {
      for (const kind of ["electric", "water"] as Kind[]) {
        const side = rows[u.id][kind];
        if (side.dirty && parseReading(side.curr) != null) {
          const ok = await saveSide(u.id, kind);
          if (ok) count++;
        }
      }
    }
    setSavingAll(false);
    if (count === 0) toast("ไม่มีรายการที่ต้องบันทึก");
    else toast.success(`บันทึกแล้ว ${count} รายการ`);
  }

  const dirtyCount = useMemo(
    () =>
      units.reduce(
        (s, u) =>
          s +
          (rows[u.id].electric.dirty && parseReading(rows[u.id].electric.curr) != null ? 1 : 0) +
          (rows[u.id].water.dirty && parseReading(rows[u.id].water.curr) != null ? 1 : 0),
        0,
      ),
    [rows, units],
  );

  // period options: this period + 11 previous
  const periodOptions = useMemo(() => {
    const out: string[] = [period];
    let p = period;
    for (let i = 0; i < 11; i++) {
      p = prevPeriod(p);
      out.push(p);
    }
    return out;
  }, [period]);

  function changePeriod(p: string) {
    startNav(() => router.push(`/rentspace/meters?period=${p}`));
  }

  return (
    <div className="space-y-3">
      {/* toolbar: period selector + save-all */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--rs-text-2)" }}>
          <span>รอบเดือน</span>
          <select
            value={period}
            disabled={navPending}
            onChange={(e) => changePeriod(e.target.value)}
            className="h-10 rounded-xl px-3 text-sm font-medium outline-none"
            style={{
              background: "var(--rs-bg-2)",
              border: "1px solid var(--rs-border)",
              color: "var(--rs-text)",
            }}
          >
            {periodOptions.map((p) => (
              <option key={p} value={p}>
                {periodLabel(p)}
              </option>
            ))}
          </select>
          {navPending && <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--rs-text-3)" }} aria-hidden="true" />}
        </label>

        <button
          type="button"
          onClick={saveAll}
          disabled={savingAll || dirtyCount === 0}
          className="rs-btn"
        >
          {savingAll ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
          บันทึกทั้งหมด{dirtyCount > 0 ? ` (${dirtyCount})` : ""}
        </button>
      </div>

      <div className="rs-card p-0 rs-meter-scroll">
        <table className="rs-table w-full text-sm" style={{ minWidth: 880 }}>
          <thead>
            <tr style={{ color: "var(--rs-text-2)" }} className="text-left text-[12px]">
              <th
                className="py-2.5 px-3 font-semibold sticky left-0 z-30"
                style={{ background: "var(--rs-bg-2)", minWidth: 160 }}
              >
                ห้อง
              </th>
              <th className="py-2.5 px-3 font-semibold text-right">
                <span className="inline-flex items-center gap-1 justify-end">
                  <Zap className="h-3.5 w-3.5" style={{ color: "var(--rs-pending)" }} /> ไฟ · ครั้งก่อน
                </span>
              </th>
              <th className="py-2.5 px-3 font-semibold text-right">ไฟ · เลขล่าสุด</th>
              <th className="py-2.5 px-3 font-semibold text-right">หน่วยไฟ</th>
              <th className="py-2.5 px-3 font-semibold text-right">
                <span className="inline-flex items-center gap-1 justify-end">
                  <Droplet className="h-3.5 w-3.5" style={{ color: "var(--rs-info)" }} /> น้ำ · ครั้งก่อน
                </span>
              </th>
              <th className="py-2.5 px-3 font-semibold text-right">น้ำ · เลขล่าสุด</th>
              <th className="py-2.5 px-3 font-semibold text-right">หน่วยน้ำ</th>
              <th className="py-2.5 px-3 font-semibold text-center">บันทึก</th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => {
              const r = rows[u.id];
              const rowDirty =
                (r.electric.dirty && parseReading(r.electric.curr) != null) ||
                (r.water.dirty && parseReading(r.water.curr) != null);
              return (
                <tr
                  key={u.id}
                  className="border-t"
                  style={{ borderColor: "var(--rs-border)" }}
                >
                  {/* sticky room column */}
                  <td
                    className="py-2.5 px-3 sticky left-0 z-10"
                    style={{ background: "var(--rs-bg)" }}
                  >
                    <div className="font-semibold" style={{ color: "var(--rs-text)" }}>
                      {u.code}
                    </div>
                    {(u.name || u.tenant) && (
                      <div className="text-[11.5px] mt-0.5" style={{ color: "var(--rs-text-3)" }}>
                        {[u.name, u.tenant].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </td>

                  {/* electric */}
                  <SideCells
                    unitId={u.id}
                    roomCode={u.code}
                    kind="electric"
                    side={r.electric}
                    inputRefs={inputRefs}
                    refKey={refKey}
                    onChange={onChange}
                    onKeyDown={onKeyDown}
                    onBlur={saveSide}
                    onAttach={attachPhoto}
                    onToggleReset={toggleReset}
                    onOldFinalChange={onOldFinalChange}
                  />

                  {/* water */}
                  <SideCells
                    unitId={u.id}
                    roomCode={u.code}
                    kind="water"
                    side={r.water}
                    inputRefs={inputRefs}
                    refKey={refKey}
                    onChange={onChange}
                    onKeyDown={onKeyDown}
                    onBlur={saveSide}
                    onAttach={attachPhoto}
                    onToggleReset={toggleReset}
                    onOldFinalChange={onOldFinalChange}
                  />

                  {/* per-row save */}
                  <td className="py-2.5 px-3 text-center">
                    <button
                      type="button"
                      onClick={async () => {
                        await saveSide(u.id, "electric");
                        await saveSide(u.id, "water");
                      }}
                      disabled={r.electric.saving || r.water.saving || !rowDirty}
                      className="inline-flex items-center justify-center h-10 w-10 rounded-lg disabled:opacity-40"
                      style={{
                        background: rowDirty ? "var(--rs-brand)" : "var(--rs-bg-3)",
                        color: rowDirty ? "#fff" : "var(--rs-text-3)",
                      }}
                      title="บันทึกห้องนี้"
                      aria-label={`บันทึกห้อง ${u.code}`}
                    >
                      {r.electric.saving || r.water.saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Check className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <style jsx>{`
        /* Excel-style frozen panes: cap the box height so the sticky header
           (top) + sticky room column (left) freeze inside it instead of
           floating 4rem down over the first row (overflow-x breaks
           window-relative sticky). */
        .rs-meter-scroll {
          overflow: auto;
          max-height: calc(100dvh - 18rem);
          min-height: 300px;
          overscroll-behavior: contain;
        }
        .rs-meter-scroll :global(.rs-table thead th) {
          top: 0;
        }
        /* corner cell (ห้อง) must sit above both the header row and the
           sticky room column — tokens' .rs-table thead th (z 20) out-specs
           the Tailwind z-30 on this cell, so re-assert it here. */
        .rs-meter-scroll :global(.rs-table thead th:first-child) {
          z-index: 31;
        }
      `}</style>
    </div>
  );
}

/** The 3 cells for one side (prev · curr-input + photo · usage). */
function SideCells({
  unitId,
  roomCode,
  kind,
  side,
  inputRefs,
  refKey,
  onChange,
  onKeyDown,
  onBlur,
  onAttach,
  onToggleReset,
  onOldFinalChange,
}: {
  unitId: string;
  roomCode: string;
  kind: Kind;
  side: SideState;
  inputRefs: React.MutableRefObject<Record<string, HTMLInputElement | null>>;
  refKey: (unitId: string, kind: Kind) => string;
  onChange: (unitId: string, kind: Kind, value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, unitId: string, kind: Kind) => void;
  onBlur: (unitId: string, kind: Kind) => void;
  onAttach: (unitId: string, kind: Kind, file: File) => void;
  onToggleReset: (unitId: string, kind: Kind) => void;
  onOldFinalChange: (unitId: string, kind: Kind, value: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const label = kind === "electric" ? "ไฟ" : "น้ำ";
  const roomLabel = roomCode; // ป้ายกำกับห้องสำหรับ screen reader (aria-label)
  const currNum = parseReading(side.curr);
  // rollover suspicion: a lower reading than last month with reset OFF
  const showRolloverWarn = !side.isReset && side.prev != null && currNum != null && currNum < side.prev;
  return (
    <>
      <td className="py-2.5 px-3 text-right tabular-nums" style={{ color: "var(--rs-text-3)" }}>
        {side.prev != null ? side.prev.toLocaleString("th-TH") : "—"}
      </td>
      <td className="py-1.5 px-2 text-right">
        <div className="flex flex-col items-end gap-1.5">
        <div className="inline-flex items-center justify-end gap-1.5">
          <div className="relative inline-flex items-center">
            <input
              ref={(el) => {
                inputRefs.current[refKey(unitId, kind)] = el;
              }}
              type="number"
              inputMode="decimal"
              min={0}
              value={side.curr}
              onChange={(e) => onChange(unitId, kind, e.target.value)}
              onKeyDown={(e) => onKeyDown(e, unitId, kind)}
              onBlur={() => onBlur(unitId, kind)}
              placeholder="—"
              aria-label={`เลขมิเตอร์ล่าสุด ห้อง ${roomLabel} (${label})`}
              className="w-24 h-10 rounded-lg px-2 text-right tabular-nums text-sm outline-none focus:ring-2"
              style={{
                background: "var(--rs-bg-2)",
                border: `1px solid ${side.saved && !side.dirty ? "var(--rs-ok)" : "var(--rs-border)"}`,
                color: "var(--rs-text)",
                // @ts-expect-error css var for ring
                "--tw-ring-color": "var(--rs-brand)",
              }}
            />
            {side.saving ? (
              <Loader2
                className="absolute -right-5 h-3.5 w-3.5 animate-spin"
                style={{ color: "var(--rs-text-3)" }}
                aria-hidden="true"
              />
            ) : side.saved && !side.dirty ? (
              <Check className="absolute -right-5 h-3.5 w-3.5" style={{ color: "var(--rs-ok)" }} aria-hidden="true" />
            ) : null}
          </div>

          {/* meter photo: existing thumbnail OR attach button */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onAttach(unitId, kind, f);
              e.target.value = ""; // allow re-picking the same file
            }}
          />
          {side.uploading ? (
            <span
              role="status"
              aria-label={`กำลังแนบรูปมิเตอร์${label} ห้อง ${roomLabel}`}
              className="inline-flex items-center justify-center h-10 w-10 rounded-lg"
              style={{ background: "var(--rs-bg-3)" }}
              title="กำลังแนบรูป"
            >
              <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--rs-text-3)" }} aria-hidden="true" />
            </span>
          ) : side.photoUrl ? (
            <button
              type="button"
              onClick={() => window.open(side.photoUrl!, "_blank", "noopener")}
              className="inline-flex items-center justify-center h-10 w-10 overflow-hidden rounded-lg"
              style={{ border: "1px solid var(--rs-ok)" }}
              title={`ดูรูปมิเตอร์${label} · คลิกเพื่อเปิด`}
              aria-label={`ดูรูปมิเตอร์${label} ห้อง ${roomLabel} (คลิกเพื่อเปิด)`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={side.photoUrl} alt={`รูปมิเตอร์${label} ห้อง ${roomLabel}`} className="h-full w-full object-cover" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center justify-center h-10 w-10 rounded-lg"
              style={{
                background: "var(--rs-bg-3)",
                color: "var(--rs-text-3)",
                border: "1px solid var(--rs-border)",
              }}
              title={`แนบรูปมิเตอร์${label}`}
              aria-label={`แนบรูปมิเตอร์${label} ห้อง ${roomLabel}`}
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* rollover / replacement controls */}
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => onToggleReset(unitId, kind)}
            className="inline-flex items-center gap-1 text-[11px] font-medium rounded-md px-1.5 py-0.5"
            style={{
              background: side.isReset ? "var(--rs-pending-soft)" : "transparent",
              color: side.isReset ? "#8A6400" : "var(--rs-text-3)",
              border: `1px solid ${side.isReset ? "#F6E0AE" : "var(--rs-border)"}`,
            }}
            aria-pressed={side.isReset}
            aria-label={`มิเตอร์เต็ม/เปลี่ยน ห้อง ${roomLabel} (${label})`}
            title="เปิดเมื่อมิเตอร์ครบรอบ (เลขวนกลับ 0) หรือถูกเปลี่ยนตัวใหม่"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            มิเตอร์เต็ม/เปลี่ยน
          </button>

          {side.isReset && (
            <div className="inline-flex items-center gap-1">
              <span className="text-[10.5px]" style={{ color: "var(--rs-text-3)" }}>
                เลขเดิมก่อนเปลี่ยน
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                value={side.oldFinal}
                onChange={(e) => onOldFinalChange(unitId, kind, e.target.value)}
                onBlur={() => onBlur(unitId, kind)}
                placeholder="เลขมิเตอร์เดิม"
                aria-label={`เลขมิเตอร์เดิมก่อนเปลี่ยน ห้อง ${roomLabel} (${label})`}
                className="w-24 h-10 rounded-lg px-2 text-right tabular-nums text-[12px] outline-none focus:ring-2"
                style={{
                  background: "var(--rs-bg-2)",
                  border: "1px solid #F6E0AE",
                  color: "var(--rs-text)",
                  // @ts-expect-error css var for ring
                  "--tw-ring-color": "var(--rs-pending)",
                }}
              />
            </div>
          )}

          {showRolloverWarn && (
            <div
              role="alert"
              className="inline-flex items-start gap-1 text-[11px] font-medium text-left max-w-[180px]"
              // ใช้แดงเข้มกว่า rs-danger เพื่อให้ผ่าน WCAG AA ที่ตัวอักษรเล็ก (พื้นขาว)
              style={{ color: "#b91c1c" }}
            >
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              <span>เลขน้อยกว่าเดือนก่อน — เปิด “มิเตอร์เต็ม/เปลี่ยน” หากครบรอบ</span>
            </div>
          )}
        </div>
        </div>
      </td>
      <td
        className="py-2.5 px-3 text-right tabular-nums font-medium"
        style={{ color: side.usage != null ? "var(--rs-text)" : "var(--rs-text-3)" }}
      >
        {side.usage != null ? side.usage.toLocaleString("th-TH") : "—"}
      </td>
    </>
  );
}
