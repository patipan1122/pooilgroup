"use client";

/**
 * ClawFleet v2 — Anomaly Review modal (centerpiece of the redesign).
 *
 * Ported verbatim from `~/ตู้คีบ/src/page-anomaly.jsx`:
 *   AnomalyReview + CheckCard + DecisionCard + ContextItem + MachineRow
 *   + PhotoThumbs + Lightbox — all kept in this one file to mirror the mockup.
 *
 * Full-screen overlay (`cf-rev-shell`) with a cross-check summary strip, a
 * dense machine table, a context strip, and a photo lightbox. Keyboard
 * shortcuts A/R/E set the decision. The CSS for every class lives in
 * `app/(admin)/clawfleet/v2/clawfleet-redesign.css`.
 */

import { useEffect, useState } from "react";
import { Ic, fmtTHB, type IconName } from "@/components/clawfleet/v2/chrome";
import { getBranch, type Anomaly, type Machine } from "@/lib/clawfleet/v2-data";

type Decision = "approve" | "recheck" | "escalate";

export type AnomalyReviewProps = {
  anomaly: Anomaly;
  onClose: () => void;
  onNext: () => void;
  onDecision: (decision: string, note: string) => void;
};

type LightboxState = { machineIdx: number; photoIdx: number };

export function AnomalyReview({ anomaly, onClose, onNext, onDecision }: AnomalyReviewProps) {
  const a = anomaly;
  const branch = getBranch(a.branchId);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);

  // Keyboard shortcuts: A=approve, R=recheck, E=escalate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      if (e.key === "Escape") {
        if (lightbox) setLightbox(null);
        else onClose();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "a") setDecision("approve");
      else if (k === "r") setDecision("recheck");
      else if (k === "e") setDecision("escalate");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, onClose]);

  // Aggregate totals from machine list
  const totals = a.machines.reduce(
    (acc, m) => {
      const meterDelta = m.meterAfter - m.meterBefore;
      acc.meterExpected += meterDelta * m.coinRate;
      acc.cashActual += m.cashIn;
      acc.prizeOut += m.prizeBefore + m.refilled - m.prizeAfter;
      acc.refilled += m.refilled;
      return acc;
    },
    { meterExpected: 0, cashActual: 0, prizeOut: 0, refilled: 0 },
  );

  return (
    <div className="cf-rev-shell">
      {/* Top bar */}
      <div className="cf-rev-top">
        <button className="cf-rev-close" onClick={onClose}>
          <Ic name="x" size={16} />
          <span>ปิด</span>
        </button>
        <div className="cf-rev-title-bar">
          <span className={`cf-sev cf-sev-${a.severity.toLowerCase()}`}>{a.severity}</span>
          <div>
            <div className="cf-rev-title">
              <span>{branch.name}</span>
              <span className="cf-dim cf-rev-title-meta">
                · {a.machines.length} ตู้ · {a.staff}
              </span>
            </div>
            <div className="cf-rev-sub">
              {a.id} · เก็บ {a.sessionStart}–{a.sessionEnd} ({a.duration}) · {a.timestamp}
              <span className="cf-dim">
                {" "}
                · {branch.area} · {branch.code}
              </span>
            </div>
          </div>
        </div>
        <div className="cf-rev-actions">
          <button
            className="cf-btn cf-btn-ghost cf-btn-sm"
            onClick={() => window.print()}
          >
            <Ic name="download" size={14} /> ส่งออก PDF
          </button>
          <button className="cf-btn cf-btn-ghost cf-btn-sm" onClick={onNext}>
            รอบถัดไป <Ic name="chevronR" size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="cf-rev-body">
        {/* Summary strip: cross-check cash + prize + decision */}
        <div className="cf-rev-summary-strip">
          <CheckCard
            label="Cash check · จากมิเตอร์เทียบเงินสด"
            expected={a.expectedCash}
            actual={a.actualCash}
            unit="฿"
            warn={a.gap > 0}
            formula={`มิเตอร์ขึ้นรวม ${a.expectedCash / 10} ครั้ง × ฿10 = ฿${a.expectedCash.toLocaleString("th-TH")}`}
          />
          <CheckCard
            label="Prize check · มิเตอร์ตุ๊กตา vs นับจริง"
            expected={
              a.machines && a.machines.length
                ? a.machines.reduce((s, m) => s + (m.prizeMeterNow - m.prizeMeterPrev), 0)
                : a.prizeExpected
            }
            actual={
              a.machines && a.machines.length
                ? a.machines.reduce((s, m) => s + (m.prizeBefore - m.prizeAfter), 0)
                : a.prizeActual
            }
            unit=""
            unitSuffix=" ตัว"
            warn={Math.abs(a.prizeGap) > 1}
            formula="มิเตอร์ตุ๊กตา sensor บอกแจกออก N ตัว — เทียบกับจำนวนที่หายไปจริงจากตู้"
          />
          <DecisionCard
            decision={decision}
            onSet={setDecision}
            note={note}
            onNote={setNote}
            onConfirm={() => decision && onDecision(decision, note)}
          />
        </div>

        {/* Machine table — each row is a machine */}
        <div className="cf-rev-machines">
          <div className="cf-rev-machines-head">
            <h3>ตู้คีบในรอบนี้</h3>
            <div className="cf-rev-machines-legend">
              <span>
                <span className="cf-leg cf-leg-photo" /> รูป
              </span>
              <span>
                <span className="cf-leg cf-leg-meter" /> มิเตอร์
              </span>
              <span>
                <span className="cf-leg cf-leg-prize" /> ตุ๊กตา
              </span>
              <span>
                <span className="cf-leg cf-leg-cash" /> เงิน
              </span>
            </div>
          </div>
          <div className="cf-mtable">
            <div className="cf-mtable-head">
              <div>ตู้</div>
              <div>รูปยืนยัน (5)</div>
              <div>
                มิเตอร์เหรียญ{" "}
                <span style={{ color: "var(--cf-text-3)", fontWeight: 400 }}>รอบก่อน → วันนี้</span>
              </div>
              <div>มิเตอร์ตุ๊กตา + นับจริง</div>
              <div className="cf-mtable-r">คาดเงิน</div>
              <div className="cf-mtable-r">เงินจริง</div>
              <div className="cf-mtable-r">ส่วนต่าง</div>
            </div>
            {a.machines.map((m, i) => (
              <MachineRow
                key={m.code}
                m={m}
                idx={i}
                onPhoto={(pi) => setLightbox({ machineIdx: i, photoIdx: pi })}
              />
            ))}

            {/* footer totals */}
            <div className="cf-mtable-foot">
              <div>รวม {a.machines.length} ตู้</div>
              <div></div>
              <div>มิเตอร์รวม +{totals.meterExpected / 10} ครั้ง</div>
              <div>
                ตุ๊กตาคีบไป {totals.prizeOut} ตัว · เติม {totals.refilled} ตัว
              </div>
              <div className="cf-mtable-r">
                <strong>{fmtTHB(totals.meterExpected)}</strong>
              </div>
              <div className="cf-mtable-r">
                <strong>{fmtTHB(totals.cashActual)}</strong>
              </div>
              <div className="cf-mtable-r">
                <strong className={a.gap > 0 ? "cf-text-red" : "cf-text-emerald"}>
                  {a.gap > 0 ? "-" : ""}
                  {fmtTHB(Math.abs(a.gap))}
                </strong>
              </div>
            </div>
          </div>
        </div>

        {/* Context strip — auxiliary info */}
        <div className="cf-rev-context-strip">
          <ContextItem
            icon="user"
            title={`${a.staff} · พนักงานเก็บเงิน`}
            value="ผ่าน 142 รอบ · ผิด 3 รอบ (98%)"
          />
          <ContextItem
            icon="history"
            title="สาขานี้ในรอบก่อน"
            value="3 รอบล่าสุดผ่านปกติ · เฉลี่ย gap 1.2%"
          />
          <ContextItem
            icon="building"
            title={branch.name}
            value={`${branch.area ?? "—"} · ${branch.code} · ${branch.machines ?? "—"} ตู้ · ผจก. ${branch.manager ?? "—"}`}
          />
          <ContextItem
            icon="alert"
            title="แพทเทิร์น"
            value="2 ใน 4 สาขา ปตท. มี gap > 25% วันนี้ — น่าจะปัญหาเครื่อง"
          />
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <Lightbox
          machine={a.machines[lightbox.machineIdx]}
          idx={lightbox.photoIdx}
          onClose={() => setLightbox(null)}
          onIdx={(i) => setLightbox({ ...lightbox, photoIdx: i })}
        />
      )}
    </div>
  );
}

/* ==== Cross-check card ==== */

type CheckCardProps = {
  label: string;
  expected: number;
  actual: number;
  unit: string;
  unitSuffix?: string;
  warn: boolean;
  formula: string;
};

function CheckCard({ label, expected, actual, unit, unitSuffix = "", warn, formula }: CheckCardProps) {
  const gap = actual - expected;
  const gapPct = expected ? Math.abs(gap / expected) * 100 : 0;
  return (
    <div className={`cf-check ${warn ? "is-warn" : "is-ok"}`}>
      <div className="cf-check-label">{label}</div>
      <div className="cf-check-rows">
        <div className="cf-check-row">
          <span>คาดการณ์</span>
          <strong>
            {unit}
            {expected.toLocaleString("th-TH")}
            {unitSuffix}
          </strong>
        </div>
        <div className="cf-check-row">
          <span>นับ/เก็บได้จริง</span>
          <strong>
            {unit}
            {actual.toLocaleString("th-TH")}
            {unitSuffix}
          </strong>
        </div>
        <div className={`cf-check-row cf-check-gap ${warn ? "is-warn" : "is-ok"}`}>
          <span>ส่วนต่าง</span>
          <strong>
            {gap > 0 ? "+" : gap < 0 ? "−" : ""}
            {unit}
            {Math.abs(gap).toLocaleString("th-TH")}
            {unitSuffix}
            <span className="cf-check-pct">{gapPct.toFixed(1)}%</span>
          </strong>
        </div>
      </div>
      <div className="cf-check-formula">{formula}</div>
    </div>
  );
}

type DecisionCardProps = {
  decision: Decision | null;
  onSet: (decision: Decision) => void;
  note: string;
  onNote: (note: string) => void;
  onConfirm: () => void;
};

function DecisionCard({ decision, onSet, note, onNote, onConfirm }: DecisionCardProps) {
  return (
    <div className="cf-check cf-decision-card">
      <div className="cf-check-label">การตัดสินใจ</div>
      <div className="cf-dec-row">
        <button
          className={`cf-dec-mini cf-dec-mini-approve ${decision === "approve" ? "is-active" : ""}`}
          onClick={() => onSet("approve")}
        >
          <Ic name="check" size={14} />
          <span>อนุมัติ</span>
          <kbd>A</kbd>
        </button>
        <button
          className={`cf-dec-mini cf-dec-mini-recheck ${decision === "recheck" ? "is-active" : ""}`}
          onClick={() => onSet("recheck")}
        >
          <Ic name="refresh" size={14} />
          <span>ตรวจซ้ำ</span>
          <kbd>R</kbd>
        </button>
        <button
          className={`cf-dec-mini cf-dec-mini-escalate ${decision === "escalate" ? "is-active" : ""}`}
          onClick={() => onSet("escalate")}
        >
          <Ic name="flag" size={14} />
          <span>ส่งต่อ</span>
          <kbd>E</kbd>
        </button>
      </div>
      <textarea
        value={note}
        onChange={(e) => onNote(e.target.value)}
        placeholder={
          decision === "recheck"
            ? 'เช่น "ตู้ 04 มิเตอร์น้อย → ไปดูใหม่"'
            : decision === "escalate"
              ? "ทำไมส่งต่อ ผจก.?"
              : decision === "approve"
                ? "ทำไมรับได้? (เช่น ตู้ 06 เสียจริง มีรูปยืนยัน)"
                : "โน้ตประกอบ · ส่งเข้า audit log"
        }
        rows={2}
      />
      <button
        className={`cf-btn cf-btn-primary cf-decision-confirm ${!decision ? "is-disabled" : ""}`}
        disabled={!decision}
        onClick={onConfirm}
      >
        {!decision
          ? "เลือกการตัดสินใจก่อน"
          : decision === "approve"
            ? "อนุมัติ · เข้ารายงาน"
            : decision === "recheck"
              ? "ส่งให้พนักงานตรวจซ้ำ"
              : "ส่งให้ผู้จัดการ"}
        {decision && <Ic name="arrowR" size={14} />}
      </button>
    </div>
  );
}

type ContextItemProps = {
  icon: IconName;
  title: string;
  value: string;
};

function ContextItem({ icon, title, value }: ContextItemProps) {
  return (
    <div className="cf-ctx-item">
      <Ic name={icon} size={14} />
      <div>
        <div className="cf-ctx-item-title">{title}</div>
        <div className="cf-dim">{value}</div>
      </div>
    </div>
  );
}

/* ==== Machine row — compact, all info inline ==== */

type MachineRowProps = {
  m: Machine;
  idx: number;
  onPhoto: (photoIdx: number) => void;
};

function MachineRow({ m, onPhoto }: MachineRowProps) {
  const meterDelta = m.meterAfter - m.meterBefore;
  const expectedCash = meterDelta * m.coinRate;
  const gap = m.cashIn - expectedCash;
  const physicalPrizeOut = m.prizeBefore - m.prizeAfter; // ไม่รวมเติม
  const prizeMeterDelta = m.prizeMeterNow - m.prizeMeterPrev;
  const prizeMeterMismatch = prizeMeterDelta - physicalPrizeOut;

  return (
    <div className={`cf-mtable-row ${m.flag ? "has-flag" : ""}`}>
      <div className="cf-mtable-machine">
        <div className="cf-mtable-mcode">{m.name}</div>
        <div className="cf-dim cf-mtable-msub">{m.code}</div>
        {m.flag && <div className="cf-mtable-flag">⚑ {m.note}</div>}
      </div>

      <PhotoThumbs machine={m} onPhoto={onPhoto} />

      <div className="cf-mtable-meter">
        <div className="cf-mtable-num">
          <span className="cf-meter-prev" title="ดึงจากระบบ (รอบก่อน)">
            {m.meterBefore.toLocaleString("th-TH")}
          </span>
          <Ic name="arrowR" size={11} style={{ color: "var(--cf-text-3)", margin: "0 4px" }} />
          <span title="พนักงานถ่ายรูปมาวันนี้">{m.meterAfter.toLocaleString("th-TH")}</span>
        </div>
        <div className="cf-dim">
          +{meterDelta} ครั้ง × ฿{m.coinRate}
        </div>
      </div>

      <div className="cf-mtable-prize">
        <div className="cf-mtable-meter-prize">
          <span className="cf-meter-prev">มิเตอร์ {m.prizeMeterPrev.toLocaleString("th-TH")}</span>
          <Ic name="arrowR" size={11} style={{ color: "var(--cf-text-3)", margin: "0 3px" }} />
          <span>{m.prizeMeterNow.toLocaleString("th-TH")}</span>
          <span className="cf-mtable-meter-prize-delta"> +{prizeMeterDelta}</span>
        </div>
        <div className="cf-mtable-num">
          <span title="ตุ๊กตาในตู้ก่อนเติม">{m.prizeBefore}</span>
          {m.refilled > 0 && <span className="cf-mtable-refill"> +{m.refilled}</span>}
          <Ic name="arrowR" size={11} style={{ color: "var(--cf-text-3)", margin: "0 4px" }} />
          <span title="หลังเติม">{m.prizeAfter + m.refilled}</span>
        </div>
        {prizeMeterMismatch !== 0 ? (
          <div className="cf-mtable-prize-mismatch">
            ⚠ มิเตอร์บอก {prizeMeterDelta} · นับได้ {physicalPrizeOut} · ต่าง{" "}
            {prizeMeterMismatch > 0 ? "+" : ""}
            {prizeMeterMismatch}
          </div>
        ) : (
          <div className="cf-dim cf-mtable-prize-ok">✓ มิเตอร์ตรงกับนับ ({physicalPrizeOut} ตัว)</div>
        )}
      </div>

      <div className="cf-mtable-r cf-mtable-cash">
        <strong>{fmtTHB(expectedCash)}</strong>
      </div>
      <div className="cf-mtable-r cf-mtable-cash">
        <strong>{fmtTHB(m.cashIn)}</strong>
      </div>
      <div className="cf-mtable-r">
        <strong className={gap < 0 ? "cf-text-red" : gap > 0 ? "cf-text-amber" : "cf-text-emerald"}>
          {gap === 0 ? "฿0" : (gap > 0 ? "+" : "−") + fmtTHB(Math.abs(gap))}
        </strong>
      </div>
    </div>
  );
}

type PhotoSlot = {
  key: string;
  label: string;
  tone: "cyan" | "violet" | "amber" | "emerald";
  text: string;
};

type PhotoThumbsProps = {
  machine: Machine;
  onPhoto: (photoIdx: number) => void;
};

function PhotoThumbs({ machine, onPhoto }: PhotoThumbsProps) {
  // 5 รูป: มิเตอร์เหรียญ · มิเตอร์ตุ๊กตา · ตุ๊กตาก่อน · ตุ๊กตาหลัง · เงิน
  const slots: PhotoSlot[] = [
    { key: "mc", label: "มิเตอร์เหรียญ", tone: "cyan", text: machine.meterAfter.toLocaleString("th-TH") },
    { key: "mp", label: "มิเตอร์ตุ๊กตา", tone: "violet", text: machine.prizeMeterNow.toLocaleString("th-TH") },
    { key: "pb", label: "ตุ๊กตาในตู้ ก่อนเติม", tone: "amber", text: machine.prizeBefore + " ตัว" },
    { key: "pa", label: "ตุ๊กตาในตู้ หลังเติม", tone: "amber", text: machine.prizeAfter + machine.refilled + " ตัว" },
    { key: "cs", label: "เงินสดในถาด", tone: "emerald", text: fmtTHB(machine.cashIn) },
  ];
  const missingCount = Math.max(0, slots.length - machine.photos);
  return (
    <div className="cf-pthumbs">
      {slots.map((s, i) => (
        <button
          key={s.key}
          className={`cf-pthumb cf-pthumb-${s.tone} ${i >= machine.photos ? "is-missing" : ""}`}
          onClick={() => i < machine.photos && onPhoto(i)}
          title={`${s.label}: ${s.text}`}
        >
          {i < machine.photos ? (
            <>
              <span className="cf-pthumb-mini">{s.label.split(" ")[0]}</span>
              <span className="cf-pthumb-val">{s.text}</span>
            </>
          ) : (
            <span className="cf-pthumb-x">!</span>
          )}
        </button>
      ))}
      {missingCount > 0 && <div className="cf-pthumb-warn">ขาด {missingCount} รูป</div>}
    </div>
  );
}

type LightboxSlot = {
  label: string;
  tone: "cyan" | "violet" | "amber" | "emerald";
  text: string;
  sub: string;
};

type LightboxProps = {
  machine: Machine;
  idx: number;
  onClose: () => void;
  onIdx: (idx: number) => void;
};

function Lightbox({ machine, idx, onClose, onIdx }: LightboxProps) {
  const slots: LightboxSlot[] = [
    {
      label: "มิเตอร์เหรียญ (ถ่ายรอบละ 1)",
      tone: "cyan",
      text: machine.meterAfter.toLocaleString("th-TH"),
      sub: `รอบก่อน ${machine.meterBefore.toLocaleString("th-TH")} · ขึ้น +${machine.meterAfter - machine.meterBefore} ครั้ง`,
    },
    {
      label: "มิเตอร์ตุ๊กตา (sensor นับตุ๊กตาที่ตู้แจก)",
      tone: "violet",
      text: machine.prizeMeterNow.toLocaleString("th-TH"),
      sub: `รอบก่อน ${machine.prizeMeterPrev.toLocaleString("th-TH")} · ตู้แจก +${machine.prizeMeterNow - machine.prizeMeterPrev} ตัว`,
    },
    {
      label: "ตุ๊กตาในตู้ ก่อนเติม",
      tone: "amber",
      text: machine.prizeBefore + " ตัว",
      sub: "นับตอนมาถึง — ของจริงที่เห็นในตู้",
    },
    {
      label: "ตุ๊กตาในตู้ หลังเติม",
      tone: "amber",
      text: machine.prizeAfter + machine.refilled + " ตัว",
      sub: `เติมจากคลังสาขา ${machine.refilled} ตัว`,
    },
    {
      label: "เงินสดในถาด",
      tone: "emerald",
      text: fmtTHB(machine.cashIn),
      sub: "พนักงานนับเอง",
    },
  ];
  const cur = slots[idx];
  return (
    <div className="cf-lbox" onClick={onClose}>
      <div className="cf-lbox-inner" onClick={(e) => e.stopPropagation()}>
        <button className="cf-lbox-close" onClick={onClose}>
          <Ic name="x" size={20} />
        </button>
        <div className="cf-lbox-title">
          {machine.name} · {cur.label}
        </div>
        <div className={`cf-lbox-photo cf-photo-${cur.tone}`}>
          <div className="cf-lbox-num">{cur.text}</div>
          <div className="cf-lbox-stamp">
            <Ic name="camera" size={12} /> {machine.code} · 27 พ.ค. 13:18
          </div>
        </div>
        <div className="cf-lbox-sub">{cur.sub}</div>
        <div className="cf-lbox-thumbs">
          {slots.map((s, i) => (
            <button
              key={i}
              className={`cf-pthumb cf-pthumb-${s.tone} cf-pthumb-lbox ${i === idx ? "is-active" : ""}`}
              onClick={() => onIdx(i)}
            >
              <span className="cf-pthumb-mini">{s.label.split(" ")[0]}</span>
              <span className="cf-pthumb-val">{s.text}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
