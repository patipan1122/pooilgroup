"use client";

// StockInButton — รับสินค้าเข้าคลัง TRCloud จากใบเสร็จที่ยืนยันแล้ว (LEDGER_STOCKIN_V1).
//
// Flow (ปลอดภัย — เห็นก่อนส่ง):
//   กด "รับเข้าคลัง" → preview ทุกบรรทัด → เลือกหน่วยต่อบรรทัด (เห็นจำนวนฐาน+ต้นทุน/หน่วย)
//   → บรรทัดที่ยังไม่จับคู่: เลือก SKU (ระบบเรียงตัวใกล้เคียงขึ้นก่อน) → ยืนยันรับเข้าคลัง.
// stock เพิ่มทันทีที่ยืนยัน (verified) → บัญชี/แอดมินเท่านั้น · กันส่งซ้ำที่ server.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Boxes, Loader2, CheckCircle2, AlertTriangle, Link2, RotateCcw } from "lucide-react";
import { suggestSkus, LIKELY_THRESHOLD } from "@/lib/ledger/sku-match";
import {
  previewExpenseStockIn,
  sendExpenseStockIn,
  mapSkuAlias,
  resetExpenseStockIn,
} from "@/app/(admin)/ledger/_stockin-actions";
import type { StockInPreview, PreviewLine } from "@/lib/ledger/stockin-types";

type SkuOpt = { id: string; productId: string; productName: string | null; businessGroup: string | null };

export function StockInButton({
  expenseId,
  companyId,
  alreadyStockedNo,
  stockSkus,
  autoOpen,
  onClose,
}: {
  expenseId: string;
  companyId: string;
  /** ถ้าส่งเข้าคลังแล้ว = เลขเอกสาร (โชว์สถานะ) */
  alreadyStockedNo?: string | null;
  /** SKU ที่เปิด "เก็บสต๊อก" ไว้ — สำหรับจับคู่บรรทัดที่ยังไม่รู้จัก */
  stockSkus: SkuOpt[];
  /** เปิด preview เองทันทีตอน mount + ซ่อนปุ่มของตัวเอง (ถูกเรียกจากปุ่มรวม "ส่ง TRCloud"). */
  autoOpen?: boolean;
  /** กด "ยกเลิก" ในโหมด autoOpen → แจ้งปุ่มแม่ให้กลับไปแสดงปุ่มหลัก. */
  onClose?: () => void;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [preview, setPreview] = useState<Extract<StockInPreview, { ok: true }> | null>(null);
  const [unitByItem, setUnitByItem] = useState<Record<string, number>>({}); // itemId → factor
  const [picks, setPicks] = useState<Record<string, string>>({}); // itemId → skuId
  const [done, setDone] = useState(!!alreadyStockedNo);
  // autoOpen: โหลด preview อัตโนมัติครั้งเดียวตอน mount (ปุ่มรวมตัดสินแล้วว่าเป็นสินค้าสต๊อก).
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (autoOpen && !autoLoaded.current && !preview && !done) {
      autoLoaded.current = true;
      loadPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

  if (done) {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="size-4" /> รับเข้าคลังแล้ว{alreadyStockedNo && alreadyStockedNo !== "sent" ? ` · ${alreadyStockedNo}` : ""}
      </p>
    );
  }

  function loadPreview() {
    setMsg(null);
    start(async () => {
      const res = await previewExpenseStockIn(expenseId);
      if (res.ok) {
        setPreview(res);
        // default every line to its base unit (factor 1)
        setUnitByItem(Object.fromEntries(res.lines.filter((l) => l.sku).map((l) => [l.itemId, 1])));
        setPicks({});
      } else if (res.alreadySent) {
        setDone(true);
      } else {
        setMsg({ kind: "err", text: res.error ?? "เปิดรายการไม่สำเร็จ" });
      }
    });
  }

  function reload() {
    start(async () => {
      const res = await previewExpenseStockIn(expenseId);
      if (res.ok) setPreview(res);
      else if (res.alreadySent) setDone(true);
    });
  }

  function confirmSend() {
    if (!preview) return;
    setMsg(null);
    start(async () => {
      const res = await sendExpenseStockIn(expenseId, unitByItem);
      if (res.ok) {
        setDone(true);
        setPreview(null);
        setMsg({ kind: "ok", text: `รับเข้าคลังแล้ว${res.docNo ? ` · ${res.docNo}` : ""}` });
      } else {
        setMsg({ kind: "err", text: res.error ?? "รับเข้าคลังไม่สำเร็จ" });
      }
    });
  }

  function saveMappings() {
    if (!preview) return;
    const unmatched = preview.lines.filter((l) => l.status === "unmatched");
    const missing = unmatched.filter((l) => !picks[l.itemId]);
    if (missing.length > 0) {
      setMsg({ kind: "err", text: `ยังเลือก SKU ไม่ครบ (${missing.length} รายการ)` });
      return;
    }
    setMsg(null);
    start(async () => {
      for (const l of unmatched) {
        const r = await mapSkuAlias(companyId, l.description, picks[l.itemId]);
        if (!r.ok) {
          setMsg({ kind: "err", text: r.error ?? "จับคู่ไม่สำเร็จ" });
          return;
        }
      }
      const res = await previewExpenseStockIn(expenseId);
      if (res.ok) {
        setPreview(res);
        setUnitByItem((prev) => ({
          ...Object.fromEntries(res.lines.filter((l) => l.sku).map((l) => [l.itemId, prev[l.itemId] ?? 1])),
        }));
        setPicks({});
      } else if (res.alreadySent) {
        setDone(true);
      }
    });
  }

  function reset() {
    setMsg(null);
    start(async () => {
      const res = await resetExpenseStockIn(expenseId);
      setMsg(res.ok ? { kind: "ok", text: "รีเซ็ตแล้ว · กดรับเข้าคลังใหม่ได้" } : { kind: "err", text: res.error ?? "รีเซ็ตไม่สำเร็จ" });
      if (res.ok) setPreview(null);
    });
  }

  const blocked = preview
    ? preview.lines.some((l) => l.status === "untracked" || l.status === "wrong_branch") ||
      preview.lines.some((l) => l.status === "unmatched") ||
      (preview.branchId != null && !preview.projectSet)
    : false;
  const hasUnmatched = preview?.lines.some((l) => l.status === "unmatched") ?? false;

  return (
    <div className="mt-2">
      {!preview && !autoOpen && (
        <button
          type="button"
          onClick={loadPreview}
          disabled={pending}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] px-3 text-sm font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-100)] disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Boxes className="size-4" />}
          รับเข้าคลัง (TRCloud)
        </button>
      )}
      {!preview && autoOpen && pending && (
        <p className="inline-flex items-center gap-1.5 text-sm text-zinc-500">
          <Loader2 className="size-4 animate-spin" /> กำลังเปิดรายการสินค้า…
        </p>
      )}

      {preview && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-bold text-zinc-800">ตรวจก่อนรับเข้าคลัง</p>
            <span className="text-[11px] text-zinc-400">{preview.branchName ? `สาขา ${preview.branchName}` : "ไม่ระบุสาขา"}</span>
          </div>

          {preview.branchId != null && !preview.projectSet && (
            <p className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
              ⚠ สาขานี้ยังไม่ได้ตั้งรหัสโครงการ TRCloud — ตั้งที่ ตั้งค่า → สาขา ก่อนส่ง
            </p>
          )}

          <ul className="space-y-2">
            {preview.lines.map((l) => (
              <LineRow
                key={l.itemId}
                line={l}
                factor={unitByItem[l.itemId] ?? 1}
                pickedSku={picks[l.itemId] ?? ""}
                stockSkus={stockSkus}
                onUnit={(f) => setUnitByItem((p) => ({ ...p, [l.itemId]: f }))}
                onPick={(skuId) => setPicks((p) => ({ ...p, [l.itemId]: skuId }))}
              />
            ))}
          </ul>

          <div className="mt-3 flex flex-wrap gap-2">
            {hasUnmatched ? (
              <button
                type="button"
                onClick={saveMappings}
                disabled={pending}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[var(--color-brand-600,#2563EB)] px-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                บันทึกการจับคู่ + ตรวจใหม่
              </button>
            ) : (
              <button
                type="button"
                onClick={confirmSend}
                disabled={pending || blocked}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white disabled:opacity-40"
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                ยืนยันรับเข้าคลัง
              </button>
            )}
            <button
              type="button"
              onClick={() => { setPreview(null); setMsg(null); onClose?.(); }}
              disabled={pending}
              className="inline-flex min-h-[40px] items-center rounded-xl border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-600 disabled:opacity-50"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={reload}
              disabled={pending}
              title="โหลดรายการใหม่"
              className="inline-flex min-h-[40px] items-center gap-1 rounded-xl border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-500 disabled:opacity-50"
            >
              <RotateCcw className="size-3.5" />
            </button>
          </div>
          {stockSkus.length === 0 && hasUnmatched && (
            <p className="mt-2 text-[11px] text-amber-700">
              ยังไม่มี SKU ที่เปิด “เก็บสต๊อก” — ไปตั้งที่ ตั้งค่า → คลังสินค้า ก่อน
            </p>
          )}
        </div>
      )}

      {msg && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className={"inline-flex items-center gap-1 text-xs " + (msg.kind === "ok" ? "text-emerald-700" : "text-rose-700")}>
            {msg.kind === "ok" ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
            {msg.text}
          </p>
          {msg.kind === "err" && !preview && (
            <button
              type="button"
              onClick={reset}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
            >
              รีเซ็ต/ลองใหม่
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function LineRow({
  line, factor, pickedSku, stockSkus, onUnit, onPick,
}: {
  line: PreviewLine;
  factor: number;
  pickedSku: string;
  stockSkus: SkuOpt[];
  onUnit: (factor: number) => void;
  onPick: (skuId: string) => void;
}) {
  const ranked = useMemo(() => suggestSkus(line.description, stockSkus, stockSkus.length), [line.description, stockSkus]);

  if (line.status === "unmatched") {
    return (
      <li className="rounded-xl border border-amber-200 bg-amber-50 p-2.5">
        <p className="mb-1 truncate text-sm text-zinc-800">“{line.description}” · จำนวน {line.qty}</p>
        <select
          value={pickedSku}
          onChange={(e) => onPick(e.target.value)}
          aria-label={`เลือก SKU สำหรับ ${line.description}`}
          className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
        >
          <option value="">— เลือก SKU —</option>
          {ranked.map((s) => (
            <option key={s.id} value={s.id}>
              {s.score >= LIKELY_THRESHOLD ? "⭐ " : ""}{s.productId} · {s.productName ?? ""}{s.businessGroup ? ` (${s.businessGroup})` : ""}
            </option>
          ))}
        </select>
      </li>
    );
  }

  if (line.status === "untracked") {
    return (
      <li className="rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 text-xs text-zinc-600">
        “{line.description}” → {line.sku?.productId} · ยังไม่เปิด “เก็บสต๊อก” — เปิดที่ ตั้งค่า → คลังสินค้า
      </li>
    );
  }
  if (line.status === "wrong_branch") {
    return (
      <li className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">
        “{line.description}” → {line.sku?.productId} · ไม่ได้กำหนดให้สาขานี้ — ไปผูกสาขาที่ ตั้งค่า → คลังสินค้า
      </li>
    );
  }

  // ok
  const base = line.sku?.baseUnit || "หน่วย";
  const baseQty = line.qty * (factor > 0 ? factor : 1);
  const unitCost = baseQty > 0 ? line.amount / baseQty : 0;
  return (
    <li className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-2.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-800">{line.description}</p>
          <p className="font-mono text-[11px] text-zinc-400">{line.sku?.productId} · จำนวน {line.qty}</p>
        </div>
        <select
          value={factor}
          onChange={(e) => onUnit(Number(e.target.value))}
          aria-label={`หน่วยของ ${line.description}`}
          className="h-9 shrink-0 rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
        >
          <option value={1}>{base} (×1)</option>
          {(line.sku?.packUnits ?? []).map((u, i) => (
            <option key={i} value={u.factor}>{u.name} (×{u.factor})</option>
          ))}
        </select>
      </div>
      <p className="mt-1 text-[11px] text-emerald-800">
        = {baseQty.toLocaleString()} {base} · ต้นทุน/หน่วย ฿{Number(unitCost.toFixed(4)).toLocaleString()}
      </p>
    </li>
  );
}
