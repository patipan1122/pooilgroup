"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Wand2,
  Save,
  Link2,
  PlusCircle,
} from "lucide-react";

interface BranchLink {
  steId: number;
  name: string;
  inData: boolean;
  inSeed: boolean;
  linkedBranchId: string | null;
  linkedBranchName: string | null;
  suggestBranchId: string | null;
  suggestBranchName: string | null;
}
interface FuelBranch {
  id: string;
  code: string;
  name: string;
  linkedSteId: number | null;
}
interface MapState {
  ok: true;
  links: BranchLink[];
  fuelBranches: FuelBranch[];
  mappedCount: number;
  totalStations: number;
}

type Choice = { mode: "create" | "link" | "skip"; branchId?: string; name: string };

function defaultChoice(l: BranchLink): Choice {
  if (l.linkedBranchId)
    return { mode: "link", branchId: l.linkedBranchId, name: l.name };
  if (l.suggestBranchId)
    return { mode: "link", branchId: l.suggestBranchId, name: l.name };
  return { mode: "create", name: l.name };
}

export function FlowcoBranchMapView() {
  const [state, setState] = useState<MapState | null>(null);
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [busy, setBusy] = useState<null | "load" | "save">("load");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function load() {
    setBusy("load");
    setError(null);
    try {
      const res = await fetch("/api/cashhub/flowco-branch-map");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "โหลดไม่สำเร็จ");
        return;
      }
      const s = data as MapState;
      setState(s);
      const c: Record<number, Choice> = {};
      for (const l of s.links) c[l.steId] = defaultChoice(l);
      setChoices(c);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setChoice(steId: number, patch: Partial<Choice>) {
    setChoices((prev) => ({ ...prev, [steId]: { ...prev[steId], ...patch } }));
  }

  const plan = useMemo(() => {
    let create = 0,
      link = 0,
      skip = 0;
    for (const c of Object.values(choices)) {
      if (c.mode === "create") create++;
      else if (c.mode === "link") link++;
      else skip++;
    }
    return { create, link, skip };
  }, [choices]);

  async function save(overrideChoices?: Record<number, Choice>) {
    const src = overrideChoices ?? choices;
    const decisions = Object.entries(src)
      .map(([ste, c]) => {
        const steId = Number(ste);
        if (c.mode === "skip") return null;
        if (c.mode === "link")
          return c.branchId
            ? { steId, action: "link" as const, branchId: c.branchId }
            : null;
        return { steId, action: "create" as const, name: c.name.trim() };
      })
      .filter(Boolean);

    if (decisions.length === 0) {
      setError("ไม่มีรายการจับคู่");
      return;
    }
    setBusy("save");
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/cashhub/flowco-branch-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "บันทึกไม่สำเร็จ");
        return;
      }
      setFlash(
        `บันทึกแล้ว — จับคู่ ${data.linked} สาขา · สร้างใหม่ ${data.created} สาขา` +
          (data.errors?.length ? ` · มีปัญหา ${data.errors.length} รายการ` : ""),
      );
      if (data.errors?.length) setError(data.errors.join(" · "));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function autoMapAndSave() {
    if (!state) return;
    const c: Record<number, Choice> = {};
    for (const l of state.links) c[l.steId] = defaultChoice(l);
    setChoices(c);
    save(c);
  }

  if (busy === "load" && !state) {
    return (
      <div className="flex items-center gap-2 text-[var(--ch-text-2)] text-sm p-6">
        <Loader2 className="size-4 animate-spin" /> กำลังโหลด…
      </div>
    );
  }
  if (!state) {
    return (
      <div className="rounded-2xl border-2 border-[var(--ch-danger)] bg-[var(--ch-danger-bg,#fef2f2)] p-4 text-sm text-[var(--ch-danger)]">
        {error ?? "โหลดไม่สำเร็จ"}
        <button onClick={load} className="ml-2 underline">
          ลองใหม่
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* summary + auto */}
      <div className="rounded-2xl border border-[var(--ch-border)] bg-white p-4 flex flex-col sm:flex-row sm:items-center gap-3 animate-fade-up">
        <div className="flex-1">
          <p className="font-bold text-sm text-[var(--ch-text)]">
            จับคู่แล้ว {state.mappedCount}/{state.totalStations} สาขา
          </p>
          <p className="text-xs text-[var(--ch-text-2)] mt-0.5">
            แผนนี้: จับคู่เดิม {plan.link} · สร้างใหม่ {plan.create} · ข้าม{" "}
            {plan.skip}
          </p>
        </div>
        <button
          onClick={autoMapAndSave}
          disabled={busy !== null}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--ch-brand)] text-white px-4 py-2 min-h-[44px] text-sm font-semibold disabled:opacity-60"
        >
          {busy === "save" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Wand2 className="size-4" />
          )}
          จับคู่ + สร้างอัตโนมัติ
        </button>
      </div>

      {flash && (
        <div className="rounded-xl border border-[var(--ch-ok)] bg-[var(--ch-ok-bg,#ecfdf5)] px-3 py-2 text-sm text-[var(--ch-ok)] flex items-center gap-2">
          <CheckCircle2 className="size-4" /> {flash}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-[var(--ch-danger)] bg-[var(--ch-danger-bg,#fef2f2)] px-3 py-2 text-sm text-[var(--ch-danger)] flex items-start gap-2">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {/* rows */}
      <div className="space-y-2">
        {state.links.map((l) => {
          const c = choices[l.steId] ?? defaultChoice(l);
          const selectValue =
            c.mode === "create" ? "create" : c.mode === "skip" ? "skip" : c.branchId ?? "skip";
          return (
            <div
              key={l.steId}
              className="rounded-2xl border border-[var(--ch-border)] bg-white p-3 flex flex-col sm:flex-row sm:items-center gap-3 animate-fade-up"
            >
              <div className="flex items-center gap-2 sm:w-56 shrink-0">
                <span className="inline-flex items-center justify-center rounded-lg bg-[var(--ch-bg-2)] px-2 py-1 text-xs font-bold ch-tnum text-[var(--ch-text)]">
                  {l.steId}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--ch-text)] truncate">
                    {l.name}
                  </p>
                  <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                    {l.linkedBranchId ? (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-[var(--ch-ok)] font-semibold">
                        <Link2 className="size-2.5" /> จับคู่แล้ว
                      </span>
                    ) : l.suggestBranchId ? (
                      <span className="text-[10px] text-[var(--ch-brand)] font-semibold">
                        แนะนำจับคู่
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-[#b45309] font-semibold">
                        <PlusCircle className="size-2.5" /> จะสร้างใหม่
                      </span>
                    )}
                    {!l.inSeed && (
                      <span className="text-[10px] text-[#b45309]">
                        (ไม่อยู่ในลิสต์ 20 สาขา)
                      </span>
                    )}
                    {l.inData && (
                      <span className="text-[10px] text-[var(--ch-text-2)]">
                        · มีข้อมูล
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex-1 flex flex-col sm:flex-row gap-2 sm:items-center">
                <select
                  value={selectValue}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "create") setChoice(l.steId, { mode: "create" });
                    else if (v === "skip") setChoice(l.steId, { mode: "skip" });
                    else setChoice(l.steId, { mode: "link", branchId: v });
                  }}
                  className="flex-1 rounded-xl border border-[var(--ch-border)] px-3 py-2 text-sm text-[var(--ch-text)] bg-white"
                >
                  <option value="create">➕ สร้างสาขาใหม่</option>
                  {state.fuelBranches.map((b) => (
                    <option key={b.id} value={b.id}>
                      🔗 {b.name}
                      {b.linkedSteId != null && b.linkedSteId !== l.steId
                        ? ` (ผูก ${b.linkedSteId})`
                        : ""}
                    </option>
                  ))}
                  <option value="skip">— ข้ามไว้ก่อน —</option>
                </select>

                {c.mode === "create" && (
                  <input
                    value={c.name}
                    onChange={(e) => setChoice(l.steId, { name: e.target.value })}
                    placeholder="ชื่อสาขา"
                    className="flex-1 rounded-xl border border-[var(--ch-border)] px-3 py-2 text-sm text-[var(--ch-text)]"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* save */}
      <div className="flex justify-end pt-1">
        <button
          onClick={() => save()}
          disabled={busy !== null}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--ch-brand)] text-white px-5 py-2 min-h-[44px] text-sm font-semibold disabled:opacity-60"
        >
          {busy === "save" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          บันทึกการจับคู่
        </button>
      </div>
    </div>
  );
}
