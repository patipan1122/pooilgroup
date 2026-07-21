"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Zap, Droplet, Check, Loader2, Camera, AlertTriangle, RotateCcw, Lock, Unlock } from "lucide-react";
import { toast } from "sonner";
import { formatBaht, periodLabel, prevPeriod, currentPeriod } from "@/lib/rentspace/format";
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
  prevUsage: number | null; // #1b หน่วยใช้เดือนก่อน (ไว้เทียบ %)
  needsBaseline: boolean; // ห้องใหม่ ไม่มีเลขก่อน → ให้กรอก "เลขตั้งต้น" ก่อน
};

/** % เทียบหน่วยเดือนนี้กับเดือนก่อน (null = เทียบไม่ได้ ไม่มีฐาน). */
function usageDelta(
  curr: number | null,
  prev: number | null,
): { pct: number; dir: "up" | "down" | "same" } | null {
  if (curr == null || prev == null || prev <= 0) return null;
  const pct = Math.round(((curr - prev) / prev) * 100);
  if (pct > 0) return { pct, dir: "up" };
  if (pct < 0) return { pct: -pct, dir: "down" };
  return { pct: 0, dir: "same" };
}

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
  prevUsage: number | null; // #1b หน่วยใช้เดือนก่อน
  needsBaseline: boolean; // ห้องใหม่ ไม่มีเลขก่อน → ให้กรอก "เลขตั้งต้น"
  baseline: string; // raw input for เลขตั้งต้น (opening reading) เมื่อ needsBaseline
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
    prevUsage: s.prevUsage,
    needsBaseline: s.needsBaseline,
    baseline: "",
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
  billedUnitIds = [],
  isSuper = false,
}: {
  units: BoardUnit[];
  period: string;
  billedUnitIds?: string[]; // ห้องที่ออกบิลงวดนี้แล้ว → ล็อกแก้มิเตอร์
  isSuper?: boolean; // super admin ปลดล็อกแก้ได้ แม้ออกบิลแล้ว
}) {
  const router = useRouter();
  const [navPending, startNav] = useTransition();
  // งวดที่ออกบิลแล้ว → ล็อกแก้มิเตอร์ (คนทั่วไปแก้ไม่ได้ · super admin ปลดล็อกได้)
  const billedSet = useMemo(() => new Set(billedUnitIds), [billedUnitIds]);
  const isBilled = (unitId: string) => billedSet.has(unitId);
  const isLocked = (unitId: string) => billedSet.has(unitId) && !isSuper;

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

  /** กรอก "เลขตั้งต้น" (opening) ห้องใหม่ที่ยังไม่มีเลขก่อน → ตั้งเป็นฐานคำนวณหน่วยเดือนแรก. */
  function onBaselineChange(unitId: string, kind: Kind, value: string) {
    const side = rows[unitId][kind];
    const opening = parseReading(value);
    const curr = parseReading(side.curr);
    const oldFinal = parseReading(side.oldFinal);
    setSide(unitId, kind, {
      baseline: value,
      prev: opening, // ใช้เป็น "ครั้งก่อน" ทันที → usage = curr − opening
      usage: previewUsage(opening, curr, side.isReset, oldFinal),
      dirty: true,
      saved: false,
    });
  }

  async function saveSide(unitId: string, kind: Kind): Promise<boolean> {
    const side = rows[unitId][kind];
    // ล็อก: งวดที่ออกบิลแล้ว แก้มิเตอร์ไม่ได้ (server ก็กันซ้ำ — นี่กันตั้งแต่หน้าจอ)
    if (isLocked(unitId)) {
      toast.error("งวดนี้ออกบิลแล้ว — แก้มิเตอร์ไม่ได้ · ให้ผู้ดูแลระบบ (super admin) แก้ให้");
      return false;
    }
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
        openingReading: side.needsBaseline ? parseReading(side.baseline) ?? undefined : undefined,
      });
      setSide(unitId, kind, {
        saving: false,
        saved: true,
        dirty: false,
        usage: res.usage,
        amount: res.amountThb,
        needsBaseline: false, // จดแล้ว → มีเลขก่อนแล้ว ไม่ต้องกรอกตั้งต้นอีก
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
    if (isLocked(unitId)) {
      toast.error("งวดนี้ออกบิลแล้ว — แก้มิเตอร์ไม่ได้ · ให้ผู้ดูแลระบบ (super admin) แก้ให้");
      return;
    }
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
        openingReading: side.needsBaseline ? parseReading(side.baseline) ?? undefined : undefined,
      });
      setSide(unitId, kind, {
        uploading: false,
        saving: false,
        saved: true,
        dirty: false,
        usage: res.usage,
        amount: res.amountThb,
        photoUrl: url,
        needsBaseline: false,
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
      if (isLocked(u.id)) continue; // ห้องที่ออกบิลแล้ว → ข้าม (แก้ไม่ได้)
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

  // period options: anchor at the REAL current month (not the selected one) so
  // you can always jump back to recent months — even after navigating to an old
  // one. (เดิม anchor ที่เดือนที่เลือก → เลือกเดือนเก่าแล้วขึ้นไปเดือนล่าสุดไม่ได้.)
  // Always include the selected period in case it's older than the window
  // (e.g. opened via a deep-linked URL). Newest first.
  const periodOptions = useMemo(() => {
    const set = new Set<string>();
    let p = currentPeriod();
    for (let i = 0; i < 18; i++) {
      set.add(p);
      p = prevPeriod(p);
    }
    set.add(period);
    return Array.from(set).sort().reverse();
  }, [period]);

  function changePeriod(p: string) {
    startNav(() => router.push(`/rentspace/meters?period=${p}`));
  }

  return (
    <div className="space-y-3">
      {/* ── toolbar (mobile, lg:hidden): period chips row + save-all ── */}
      <div className="lg:hidden space-y-2">
        <div
          className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1"
          style={{ scrollbarWidth: "none" }}
          aria-label="เลือกรอบเดือน"
        >
          {navPending && (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" style={{ color: "var(--rs-text-3)" }} aria-hidden="true" />
          )}
          {periodOptions.map((p) => {
            const active = p === period;
            return (
              <button
                key={p}
                type="button"
                onClick={() => changePeriod(p)}
                disabled={navPending}
                aria-pressed={active}
                className="shrink-0 h-11 px-3.5 rounded-xl text-sm font-semibold whitespace-nowrap"
                style={{
                  background: active ? "var(--rs-brand)" : "var(--rs-bg-2)",
                  color: active ? "#fff" : "var(--rs-text-2)",
                  border: `1px solid ${active ? "var(--rs-brand)" : "var(--rs-border)"}`,
                }}
              >
                {periodLabel(p)}
              </button>
            );
          })}
        </div>
        {dirtyCount > 0 && (
          <button
            type="button"
            onClick={saveAll}
            disabled={savingAll}
            className="rs-btn w-full justify-center h-11"
          >
            {savingAll ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
            บันทึกทั้งหมด ({dirtyCount})
          </button>
        )}
      </div>

      {/* ── toolbar (desktop, hidden lg:flex): period selector + save-all ── */}
      <div className="hidden lg:flex flex-wrap items-center justify-between gap-3">
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

      {/* ── mobile (lg:hidden): one stacked card per unit ── */}
      <div className="lg:hidden space-y-3">
        {units.map((u) => (
          <MobileUnitCard
            key={u.id}
            unit={u}
            row={rows[u.id]}
            locked={isLocked(u.id)}
            billed={isBilled(u.id)}
            inputRefs={inputRefs}
            refKey={refKey}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onBlur={saveSide}
            onAttach={attachPhoto}
            onToggleReset={toggleReset}
            onOldFinalChange={onOldFinalChange}
            onBaselineChange={onBaselineChange}
            onSaveRoom={async (unitId) => {
              await saveSide(unitId, "electric");
              await saveSide(unitId, "water");
            }}
          />
        ))}
      </div>

      {/* ── desktop (hidden lg:block): existing wide board, unchanged ── */}
      <div className="hidden lg:block rs-card p-0 rs-meter-scroll">
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
              const locked = isLocked(u.id);
              const billed = isBilled(u.id);
              const rowDirty =
                (r.electric.dirty && parseReading(r.electric.curr) != null) ||
                (r.water.dirty && parseReading(r.water.curr) != null);
              return (
                <tr
                  key={u.id}
                  className="border-t"
                  style={{ borderColor: "var(--rs-border)", opacity: locked ? 0.72 : 1 }}
                >
                  {/* sticky room column */}
                  <td
                    className="py-1.5 px-3 sticky left-0 z-10"
                    style={{ background: "var(--rs-bg)" }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold" style={{ color: "var(--rs-text)" }}>
                        {u.code}
                      </span>
                      {billed && <BilledChip locked={locked} />}
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
                    locked={locked}
                    inputRefs={inputRefs}
                    refKey={refKey}
                    onChange={onChange}
                    onKeyDown={onKeyDown}
                    onBlur={saveSide}
                    onAttach={attachPhoto}
                    onToggleReset={toggleReset}
                    onOldFinalChange={onOldFinalChange}
                    onBaselineChange={onBaselineChange}
                  />

                  {/* water */}
                  <SideCells
                    unitId={u.id}
                    roomCode={u.code}
                    kind="water"
                    side={r.water}
                    locked={locked}
                    inputRefs={inputRefs}
                    refKey={refKey}
                    onChange={onChange}
                    onKeyDown={onKeyDown}
                    onBlur={saveSide}
                    onAttach={attachPhoto}
                    onToggleReset={toggleReset}
                    onOldFinalChange={onOldFinalChange}
                    onBaselineChange={onBaselineChange}
                  />

                  {/* per-row save */}
                  <td className="py-1.5 px-3 text-center">
                    <button
                      type="button"
                      onClick={async () => {
                        await saveSide(u.id, "electric");
                        await saveSide(u.id, "water");
                      }}
                      disabled={locked || r.electric.saving || r.water.saving || !rowDirty}
                      className="inline-flex items-center justify-center h-9 w-9 rounded-lg disabled:opacity-40"
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

/** ป้ายบอกว่าห้องนี้ออกบิลงวดนี้แล้ว — locked=แก้ไม่ได้ (🔒) · super=ปลดล็อกแก้ได้ (🔓). */
function BilledChip({ locked }: { locked: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
      style={
        locked
          ? { background: "var(--rs-bg-3)", color: "var(--rs-text-3)", border: "1px solid var(--rs-border)" }
          : { background: "var(--rs-pending-soft)", color: "#8A6400", border: "1px solid #F6E0AE" }
      }
      title={
        locked
          ? "ออกบิลงวดนี้แล้ว — แก้เลขมิเตอร์ไม่ได้ (ให้ผู้ดูแลระบบ super admin แก้ให้)"
          : "ออกบิลแล้ว — คุณเป็น super admin จึงยังปลดล็อกแก้ได้ (ระวัง: บิลกับมิเตอร์อาจไม่ตรง)"
      }
    >
      {locked ? <Lock className="h-2.5 w-2.5" aria-hidden="true" /> : <Unlock className="h-2.5 w-2.5" aria-hidden="true" />}
      ออกบิลแล้ว
    </span>
  );
}

/** The 3 cells for one side (prev · curr-input + photo · usage). */
function SideCells({
  unitId,
  roomCode,
  kind,
  side,
  locked,
  inputRefs,
  refKey,
  onChange,
  onKeyDown,
  onBlur,
  onAttach,
  onToggleReset,
  onOldFinalChange,
  onBaselineChange,
}: {
  unitId: string;
  roomCode: string;
  kind: Kind;
  side: SideState;
  locked: boolean;
  inputRefs: React.MutableRefObject<Record<string, HTMLInputElement | null>>;
  refKey: (unitId: string, kind: Kind) => string;
  onChange: (unitId: string, kind: Kind, value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, unitId: string, kind: Kind) => void;
  onBlur: (unitId: string, kind: Kind) => void;
  onAttach: (unitId: string, kind: Kind, file: File) => void;
  onToggleReset: (unitId: string, kind: Kind) => void;
  onOldFinalChange: (unitId: string, kind: Kind, value: string) => void;
  onBaselineChange: (unitId: string, kind: Kind, value: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const label = kind === "electric" ? "ไฟ" : "น้ำ";
  const roomLabel = roomCode; // ป้ายกำกับห้องสำหรับ screen reader (aria-label)
  const currNum = parseReading(side.curr);
  // rollover suspicion: a lower reading than last month with reset OFF
  const showRolloverWarn = !side.isReset && side.prev != null && currNum != null && currNum < side.prev;
  const showBaseline = side.needsBaseline && !side.saved && !locked; // ห้องใหม่ → กรอกเลขตั้งต้น
  // #2 — แถวคุม "มิเตอร์เต็ม/เปลี่ยน" ทำให้ทุกแถวสูงเกิน → ซ่อนเป็นค่าเริ่มต้น
  //   เผยเฉพาะเมื่อ (ก) เปิดใช้อยู่แล้ว (ข) เลขน่าสงสัย (ค) ผู้ใช้กดปุ่ม ↺ เอง
  const [showResetControls, setShowResetControls] = useState(false);
  const showResetRow = side.isReset || showRolloverWarn || showResetControls;
  return (
    <>
      <td className="py-1.5 px-3 text-right tabular-nums" style={{ color: "var(--rs-text-3)" }}>
        {showBaseline ? (
          <div className="flex flex-col items-end gap-0.5">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              value={side.baseline}
              onChange={(e) => onBaselineChange(unitId, kind, e.target.value)}
              onBlur={() => onBlur(unitId, kind)}
              placeholder="ตั้งต้น"
              aria-label={`เลขมิเตอร์ตั้งต้น ห้อง ${roomLabel} (${label})`}
              title="ห้องใหม่ยังไม่มีเลขก่อน — กรอกเลขมิเตอร์ ณ วันเริ่มคิด (ครั้งก่อน)"
              className="w-24 h-9 rounded-lg px-2 text-right tabular-nums text-[13px] outline-none focus:ring-2"
              style={{
                background: "var(--rs-bg-2)",
                border: "1px dashed var(--rs-pending)",
                color: "var(--rs-text)",
                // @ts-expect-error css var for ring
                "--tw-ring-color": "var(--rs-pending)",
              }}
            />
            <span className="text-[9.5px]" style={{ color: "var(--rs-pending)" }}>ตั้งต้นห้องใหม่</span>
          </div>
        ) : side.prev != null ? (
          side.prev.toLocaleString("th-TH")
        ) : (
          "—"
        )}
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
              disabled={locked}
              placeholder={locked ? "🔒" : "—"}
              aria-label={`เลขมิเตอร์ล่าสุด ห้อง ${roomLabel} (${label})`}
              className="w-24 h-8 rounded-lg pl-2 pr-8 text-right tabular-nums text-sm outline-none focus:ring-2 disabled:opacity-60 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
                className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin"
                style={{ color: "var(--rs-text-3)" }}
                aria-hidden="true"
              />
            ) : side.saved && !side.dirty ? (
              <Check className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: "var(--rs-ok)" }} aria-hidden="true" />
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
              className="inline-flex items-center justify-center h-8 w-8 rounded-lg"
              style={{ background: "var(--rs-bg-3)" }}
              title="กำลังแนบรูป"
            >
              <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--rs-text-3)" }} aria-hidden="true" />
            </span>
          ) : side.photoUrl ? (
            <button
              type="button"
              onClick={() => window.open(side.photoUrl!, "_blank", "noopener")}
              className="inline-flex items-center justify-center h-8 w-8 overflow-hidden rounded-lg"
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
              className="inline-flex items-center justify-center h-8 w-8 rounded-lg"
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

          {/* #2 — ปุ่มเผยแถว "มิเตอร์เต็ม/เปลี่ยน" (โชว์เฉพาะตอนซ่อนอยู่ · กันแถวสูงเปล่า) */}
          {!showResetRow && !locked && (
            <button
              type="button"
              onClick={() => setShowResetControls(true)}
              className="inline-flex items-center justify-center h-8 w-8 rounded-lg"
              style={{
                background: "transparent",
                color: "var(--rs-text-3)",
                border: "1px solid var(--rs-border)",
              }}
              title="มิเตอร์เต็ม / เปลี่ยนมิเตอร์"
              aria-label={`เปิดตัวเลือกมิเตอร์เต็ม/เปลี่ยน ห้อง ${roomLabel} (${label})`}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* rollover / replacement controls — #2 เผยเมื่อจำเป็นเท่านั้น (ค่าเริ่มต้นซ่อน) */}
        {showResetRow && (
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
        )}
        </div>
      </td>
      <td className="py-1.5 px-3 text-right tabular-nums font-medium">
        <div style={{ color: side.usage != null ? "var(--rs-text)" : "var(--rs-text-3)" }}>
          {side.usage != null ? side.usage.toLocaleString("th-TH") : "—"}
        </div>
        <UsageCompare usage={side.usage} prevUsage={side.prevUsage} />
      </td>
    </>
  );
}

/** #1b ป้ายเล็กใต้ตัวเลขหน่วย: เทียบกับเดือนก่อน (↑ เยอะขึ้น = ส้ม · ↓ น้อยลง = เขียว). */
function UsageCompare({ usage, prevUsage }: { usage: number | null; prevUsage: number | null }) {
  const delta = usageDelta(usage, prevUsage);
  if (delta == null || usage == null) return null;
  const prevLabel = prevUsage != null ? prevUsage.toLocaleString("th-TH") : "—";
  if (delta.dir === "same") {
    return (
      <div className="text-[10.5px] font-semibold" style={{ color: "var(--rs-text-3)" }} title={`เดือนก่อน ${prevLabel} หน่วย`}>
        = เท่าเดือนก่อน
      </div>
    );
  }
  const up = delta.dir === "up";
  return (
    <div
      className="text-[10.5px] font-semibold tabular-nums"
      // ใช้สีส้มเข้ม/เขียวเข้มให้ผ่าน contrast บนพื้นขาว
      style={{ color: up ? "#B45309" : "#15803D" }}
      title={`เดือนก่อน ${prevLabel} หน่วย — ${up ? "ใช้เยอะขึ้น" : "ใช้น้อยลง"} ${delta.pct}%`}
    >
      {up ? "↑" : "↓"} {delta.pct}%
    </div>
  );
}

/* ───────────────────────── MOBILE (lg:hidden) ───────────────────────── */

/** สถานะการจดของห้อง (ทั้งไฟ+น้ำ) → ชิปหัวการ์ด. */
function unitDone(row: RowState): boolean {
  return row.electric.saved && !row.electric.dirty && row.water.saved && !row.water.dirty;
}

/** One unit = one stacked card on phone. Reuses ALL the same handlers. */
function MobileUnitCard({
  unit,
  row,
  locked,
  billed,
  inputRefs,
  refKey,
  onChange,
  onKeyDown,
  onBlur,
  onAttach,
  onToggleReset,
  onOldFinalChange,
  onBaselineChange,
  onSaveRoom,
}: {
  unit: BoardUnit;
  row: RowState;
  locked: boolean;
  billed: boolean;
  inputRefs: React.MutableRefObject<Record<string, HTMLInputElement | null>>;
  refKey: (unitId: string, kind: Kind) => string;
  onChange: (unitId: string, kind: Kind, value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, unitId: string, kind: Kind) => void;
  onBlur: (unitId: string, kind: Kind) => void;
  onAttach: (unitId: string, kind: Kind, file: File) => void;
  onToggleReset: (unitId: string, kind: Kind) => void;
  onOldFinalChange: (unitId: string, kind: Kind, value: string) => void;
  onBaselineChange: (unitId: string, kind: Kind, value: string) => void;
  onSaveRoom: (unitId: string) => void;
}) {
  const done = unitDone(row);
  const rowDirty =
    (row.electric.dirty && parseReading(row.electric.curr) != null) ||
    (row.water.dirty && parseReading(row.water.curr) != null);
  const subtitle = [unit.name, unit.tenant].filter(Boolean).join(" · ");
  const saving = row.electric.saving || row.water.saving;

  return (
    <div className="rs-card p-3.5" style={{ opacity: locked ? 0.78 : 1 }}>
      {/* header: รหัสห้อง + ชื่อ/ผู้เช่า + ชิปสถานะ */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-[16px] leading-tight" style={{ color: "var(--rs-text)" }}>
              {unit.code}
            </span>
            {billed && <BilledChip locked={locked} />}
          </div>
          {subtitle && (
            <div className="text-[12px] mt-0.5 truncate" style={{ color: "var(--rs-text-3)" }}>
              {subtitle}
            </div>
          )}
        </div>
        <span
          className="shrink-0 inline-flex items-center gap-1 text-[11.5px] font-semibold px-2 py-1 rounded-full"
          style={
            done
              ? { background: "var(--rs-ok-soft)", color: "var(--rs-ok)" }
              : { background: "var(--rs-pending-soft)", color: "var(--rs-pending)" }
          }
        >
          {done ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
          {done ? "จดแล้ว" : "ยังไม่จด"}
        </span>
      </div>

      <MobileSide
        unitId={unit.id}
        roomCode={unit.code}
        kind="electric"
        side={row.electric}
        locked={locked}
        inputRefs={inputRefs}
        refKey={refKey}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onAttach={onAttach}
        onToggleReset={onToggleReset}
        onOldFinalChange={onOldFinalChange}
        onBaselineChange={onBaselineChange}
      />
      <MobileSide
        unitId={unit.id}
        roomCode={unit.code}
        kind="water"
        side={row.water}
        inputRefs={inputRefs}
        refKey={refKey}
        locked={locked}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onAttach={onAttach}
        onToggleReset={onToggleReset}
        onOldFinalChange={onOldFinalChange}
        onBaselineChange={onBaselineChange}
      />

      {/* save this room */}
      <button
        type="button"
        onClick={() => onSaveRoom(unit.id)}
        disabled={locked || saving || !rowDirty}
        className="mt-3 w-full h-11 inline-flex items-center justify-center gap-2 rounded-xl font-semibold text-[14px] disabled:opacity-40"
        style={{
          background: rowDirty ? "var(--rs-brand)" : "var(--rs-bg-3)",
          color: rowDirty ? "#fff" : "var(--rs-text-3)",
        }}
        aria-label={`บันทึกห้อง ${unit.code}`}
      >
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Check className="h-4 w-4" aria-hidden="true" />
        )}
        บันทึกห้องนี้
      </button>
    </div>
  );
}

/** One side (ไฟ/น้ำ) block inside a mobile unit card — full-width input. */
function MobileSide({
  unitId,
  roomCode,
  kind,
  side,
  locked,
  inputRefs,
  refKey,
  onChange,
  onKeyDown,
  onBlur,
  onAttach,
  onToggleReset,
  onOldFinalChange,
  onBaselineChange,
}: {
  unitId: string;
  roomCode: string;
  kind: Kind;
  side: SideState;
  locked: boolean;
  inputRefs: React.MutableRefObject<Record<string, HTMLInputElement | null>>;
  refKey: (unitId: string, kind: Kind) => string;
  onChange: (unitId: string, kind: Kind, value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, unitId: string, kind: Kind) => void;
  onBlur: (unitId: string, kind: Kind) => void;
  onAttach: (unitId: string, kind: Kind, file: File) => void;
  onToggleReset: (unitId: string, kind: Kind) => void;
  onOldFinalChange: (unitId: string, kind: Kind, value: string) => void;
  onBaselineChange: (unitId: string, kind: Kind, value: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const isElec = kind === "electric";
  const label = isElec ? "ไฟ" : "น้ำ";
  const Icon = isElec ? Zap : Droplet;
  const iconColor = isElec ? "var(--rs-pending)" : "var(--rs-info)";
  const currNum = parseReading(side.curr);
  const showRolloverWarn = !side.isReset && side.prev != null && currNum != null && currNum < side.prev;
  const showBaseline = side.needsBaseline && !side.saved && !locked; // ห้องใหม่ → กรอกเลขตั้งต้น

  return (
    <div
      className="mt-3 rounded-xl p-3"
      style={{ background: "var(--rs-bg-2)", border: "1px solid var(--rs-border)" }}
    >
      {/* header row: label + prev reading */}
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-semibold text-[14px]" style={{ color: "var(--rs-text)" }}>
          <Icon className="h-4 w-4" style={{ color: iconColor }} aria-hidden="true" />
          {label}
        </span>
        {showBaseline ? (
          <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--rs-pending)" }}>
            ตั้งต้น:
            <input
              type="number"
              inputMode="decimal"
              min={0}
              value={side.baseline}
              onChange={(e) => onBaselineChange(unitId, kind, e.target.value)}
              onBlur={() => onBlur(unitId, kind)}
              placeholder="เลขตั้งต้น"
              aria-label={`เลขมิเตอร์ตั้งต้น ห้อง ${roomCode} (${label})`}
              className="w-28 h-9 rounded-lg px-2 text-right tabular-nums text-[14px] outline-none focus:ring-2"
              style={{
                background: "#fff",
                border: "1px dashed var(--rs-pending)",
                color: "var(--rs-text)",
                // @ts-expect-error css var for ring
                "--tw-ring-color": "var(--rs-pending)",
              }}
            />
          </span>
        ) : (
          <span className="text-[12.5px] tabular-nums" style={{ color: "var(--rs-text-3)" }}>
            ครั้งก่อน: {side.prev != null ? side.prev.toLocaleString("th-TH") : "—"}
          </span>
        )}
      </div>

      {/* full-width current reading input */}
      <div className="relative mt-2">
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
          disabled={locked}
          placeholder={locked ? "🔒 ออกบิลแล้ว — แก้ไม่ได้" : "กรอกเลขมิเตอร์ล่าสุด"}
          aria-label={`เลขมิเตอร์ล่าสุด ห้อง ${roomCode} (${label})`}
          className="w-full h-12 rounded-xl px-3 pr-10 text-[16px] tabular-nums outline-none focus:ring-2 disabled:opacity-60"
          style={{
            background: "#fff",
            border: `1px solid ${side.saved && !side.dirty ? "var(--rs-ok)" : "var(--rs-border)"}`,
            color: "var(--rs-text)",
            // @ts-expect-error css var for ring
            "--tw-ring-color": "var(--rs-brand)",
          }}
        />
        {side.saving ? (
          <Loader2
            className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin"
            style={{ color: "var(--rs-text-3)" }}
            aria-hidden="true"
          />
        ) : side.saved && !side.dirty ? (
          <Check className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "var(--rs-ok)" }} aria-hidden="true" />
        ) : null}
      </div>

      {/* computed usage + amount */}
      <div className="mt-2 flex items-center justify-between gap-3 text-[13px]">
        <span style={{ color: "var(--rs-text-2)" }}>
          หน่วยที่ใช้:{" "}
          <span className="font-semibold tabular-nums" style={{ color: side.usage != null ? "var(--rs-text)" : "var(--rs-text-3)" }}>
            {side.usage != null ? side.usage.toLocaleString("th-TH") : "—"}
          </span>
          <UsageCompareInline usage={side.usage} prevUsage={side.prevUsage} />
        </span>
        <span style={{ color: "var(--rs-text-2)" }}>
          เป็นเงิน:{" "}
          <span className="font-semibold tabular-nums" style={{ color: side.amount != null ? "var(--rs-text)" : "var(--rs-text-3)" }}>
            {side.amount != null ? formatBaht(side.amount) : "—"}
          </span>
        </span>
      </div>

      {/* มิเตอร์เต็ม/เปลี่ยน toggle */}
      <button
        type="button"
        onClick={() => onToggleReset(unitId, kind)}
        className="mt-2.5 inline-flex items-center gap-1.5 h-11 px-3 text-[13px] font-medium rounded-xl"
        style={{
          background: side.isReset ? "var(--rs-pending-soft)" : "transparent",
          color: side.isReset ? "#8A6400" : "var(--rs-text-3)",
          border: `1px solid ${side.isReset ? "#F6E0AE" : "var(--rs-border)"}`,
        }}
        aria-pressed={side.isReset}
        aria-label={`มิเตอร์เต็ม/เปลี่ยน ห้อง ${roomCode} (${label})`}
      >
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        มิเตอร์เต็ม/เปลี่ยน
      </button>

      {side.isReset && (
        <div className="mt-2">
          <label className="block text-[12px] mb-1" style={{ color: "var(--rs-text-3)" }}>
            เลขมิเตอร์เดิมก่อนเปลี่ยน
          </label>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            value={side.oldFinal}
            onChange={(e) => onOldFinalChange(unitId, kind, e.target.value)}
            onBlur={() => onBlur(unitId, kind)}
            placeholder="เลขมิเตอร์เดิม"
            aria-label={`เลขมิเตอร์เดิมก่อนเปลี่ยน ห้อง ${roomCode} (${label})`}
            className="w-full h-12 rounded-xl px-3 text-[16px] tabular-nums outline-none focus:ring-2"
            style={{
              background: "#fff",
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
          className="mt-2 inline-flex items-start gap-1.5 text-[12px] font-medium"
          style={{ color: "#b91c1c" }}
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>เลขน้อยกว่าเดือนก่อน — เปิด “มิเตอร์เต็ม/เปลี่ยน” หากครบรอบ</span>
        </div>
      )}

      {/* photo: full-width attach button OR existing thumbnail */}
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
        <div
          role="status"
          aria-label={`กำลังแนบรูปมิเตอร์${label} ห้อง ${roomCode}`}
          className="mt-2.5 w-full h-11 inline-flex items-center justify-center gap-2 rounded-xl text-[13px]"
          style={{ background: "var(--rs-bg-3)", color: "var(--rs-text-3)" }}
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          กำลังแนบรูป…
        </div>
      ) : side.photoUrl ? (
        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.open(side.photoUrl!, "_blank", "noopener")}
            className="h-11 w-11 shrink-0 overflow-hidden rounded-xl"
            style={{ border: "1px solid var(--rs-ok)" }}
            aria-label={`ดูรูปมิเตอร์${label} ห้อง ${roomCode}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={side.photoUrl} alt={`รูปมิเตอร์${label} ห้อง ${roomCode}`} className="h-full w-full object-cover" />
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex-1 h-11 inline-flex items-center justify-center gap-2 rounded-xl text-[13px] font-medium"
            style={{ background: "var(--rs-bg-3)", color: "var(--rs-text-2)", border: "1px solid var(--rs-border)" }}
            aria-label={`เปลี่ยนรูปมิเตอร์${label} ห้อง ${roomCode}`}
          >
            <Camera className="h-4 w-4" aria-hidden="true" />
            เปลี่ยนรูป
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="mt-2.5 w-full h-11 inline-flex items-center justify-center gap-2 rounded-xl text-[14px] font-medium"
          style={{ background: "var(--rs-bg-3)", color: "var(--rs-text-2)", border: "1px solid var(--rs-border)" }}
          aria-label={`แนบรูปมิเตอร์${label} ห้อง ${roomCode}`}
        >
          <Camera className="h-4 w-4" aria-hidden="true" />
          แนบรูปมิเตอร์
        </button>
      )}
    </div>
  );
}

/** inline variant of UsageCompare — sits after the หน่วยที่ใช้ number. */
function UsageCompareInline({ usage, prevUsage }: { usage: number | null; prevUsage: number | null }) {
  const delta = usageDelta(usage, prevUsage);
  if (delta == null || usage == null) return null;
  const prevLabel = prevUsage != null ? prevUsage.toLocaleString("th-TH") : "—";
  if (delta.dir === "same") {
    return (
      <span className="ml-1 text-[11px] font-semibold" style={{ color: "var(--rs-text-3)" }} title={`เดือนก่อน ${prevLabel} หน่วย`}>
        = เท่าเดือนก่อน
      </span>
    );
  }
  const up = delta.dir === "up";
  return (
    <span
      className="ml-1 text-[11px] font-semibold tabular-nums"
      style={{ color: up ? "#B45309" : "#15803D" }}
      title={`เดือนก่อน ${prevLabel} หน่วย — ${up ? "ใช้เยอะขึ้น" : "ใช้น้อยลง"} ${delta.pct}%`}
    >
      {up ? "↑" : "↓"} {delta.pct}%
    </span>
  );
}
