"use client";

/**
 * ClawFleet v2 — Session detail (ไส้ในรายรอบ) client island.
 *
 * Drill-in จากหน้า Operations: คลิกรอบเก็บเงิน → เห็นไส้ในทั้งรอบ
 *   - หัว: สาขา · รหัสรอบ · สถานะ · พนักงานที่เก็บ · เวลาเปิด/ปิด/ใช้เวลา
 *   - Cross-check: เงินที่ควรได้ vs จริง + ตุ๊กตาควรออก vs จริง (✅/🔴)
 *   - รายตู้: มิเตอร์เหรียญ ก่อน→หลัง · เงินที่นับ · มิเตอร์ตุ๊กตา · สต๊อก · ตรงมิเตอร์ไหม · รูป
 *
 * Reuse `.cf-*` classes จาก clawfleet-redesign.css (ตัวเดียวกับ AnomalyReview modal).
 * เป็น client island เฉพาะเพื่อให้กดดูรูป (lightbox) ได้ — data มาจาก server page.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Ic, Pill, fmtTHB } from "@/components/clawfleet/v2/chrome";
import type { Machine, SessionDetail, SessionDetailStatus } from "@/lib/clawfleet/v2-data";

const STATUS_PILL: Record<SessionDetailStatus, "blue" | "amber" | "red" | "emerald" | "slate"> = {
  active: "blue",
  stale: "amber",
  review: "red",
  closed: "emerald",
  locked: "slate",
};

type LightboxState = { machineIdx: number; photoIdx: number };

export function SessionDetailClient({ s }: { s: SessionDetail }) {
  const router = useRouter();
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);

  const cashWarn = s.cashGap < 0;
  const prizeWarn = Math.abs(s.prizeGap) > 1;
  const allOk = !cashWarn && !prizeWarn && !s.hasAnomaly;

  return (
    <div className="cf-page">
      {/* หัว: breadcrumb + ชื่อรอบ + สถานะ */}
      <div className="cf-page-head">
        <div>
          <button
            className="cf-btn cf-btn-ghost cf-btn-sm"
            style={{ marginBottom: 8 }}
            onClick={() => router.push("/clawfleet/v2/operations")}
          >
            <Ic name="chevronL" size={14} /> กลับรายการรอบ
          </button>
          <div className="cf-eyebrow">ไส้ในรอบเก็บเงิน</div>
          <h1 className="cf-h1">
            {s.branchName || s.branchCode || "—"}
          </h1>
          <div className="cf-page-sub">
            <span className="cf-anom-id">{s.id}</span>
            {s.branchArea && <> · {s.branchArea}</>}
            {s.branchCode && <> · {s.branchCode}</>} · {s.doneCount}/{s.machineCount} ตู้
          </div>
        </div>
        <div className="cf-page-actions" style={{ alignItems: "flex-start" }}>
          <Pill color={STATUS_PILL[s.status]} dot>
            {s.statusLabel}
          </Pill>
        </div>
      </div>

      {/* แถบข้อมูลรอบ: ใครเก็บ · เวลา */}
      <div className="cf-rev-context-strip" style={{ marginBottom: 16 }}>
        <div className="cf-ctx-item">
          <Avatar initials={s.staffAvatar} size="sm" />
          <div>
            <div className="cf-ctx-item-title">{s.staff}</div>
            <div className="cf-dim">พนักงานที่เก็บรอบนี้</div>
          </div>
        </div>
        <div className="cf-ctx-item">
          <Ic name="clock" size={14} />
          <div>
            <div className="cf-ctx-item-title">เปิดรอบ {s.openedAt}</div>
            <div className="cf-dim">
              {s.closedAt ? `ปิด ${s.closedAt}` : "ยังไม่ปิด"} · ใช้เวลา {s.duration}
            </div>
          </div>
        </div>
        <div className="cf-ctx-item">
          <Ic name="check" size={14} />
          <div>
            <div className="cf-ctx-item-title">
              {s.closedBy ? `ปิดโดย ${s.closedBy}` : "รอบยังเปิดอยู่"}
            </div>
            <div className="cf-dim">
              {allOk ? "✓ ผ่าน cross-check ทุกด้าน" : "🔴 มีจุดที่ต้องตรวจ"}
            </div>
          </div>
        </div>
      </div>

      {/* Cross-check summary: เงิน + ตุ๊กตา */}
      <div className="cf-rev-summary-strip" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <CrossCheck
          label="เงิน · จากมิเตอร์เทียบเงินสด"
          expected={s.expectedCash}
          actual={s.actualCash}
          unit="฿"
          warn={cashWarn}
          okText="เงินสดที่นับได้ตรงกับเลขมิเตอร์"
          warnText="เงินสดที่นับได้น้อยกว่าที่มิเตอร์บอก"
        />
        <CrossCheck
          label="ตุ๊กตา · มิเตอร์เทียบนับจริง"
          expected={s.prizeExpected}
          actual={s.prizeActual}
          unit=""
          unitSuffix=" ตัว"
          warn={prizeWarn}
          okText="จำนวนตุ๊กตาที่ออกตรงกับมิเตอร์"
          warnText="ตุ๊กตาที่นับได้ไม่ตรงกับเลขมิเตอร์"
        />
      </div>

      {/* รายตู้ */}
      <div className="cf-rev-machines" style={{ marginTop: 20 }}>
        <div className="cf-rev-machines-head">
          <h3>รายตู้ในรอบนี้ ({s.machines.length})</h3>
          <div className="cf-rev-machines-legend">
            <span><span className="cf-leg cf-leg-photo" /> รูป</span>
            <span><span className="cf-leg cf-leg-meter" /> มิเตอร์</span>
            <span><span className="cf-leg cf-leg-prize" /> ตุ๊กตา</span>
            <span><span className="cf-leg cf-leg-cash" /> เงิน</span>
          </div>
        </div>
        <div className="cf-mtable">
          <div className="cf-mtable-head">
            <div>ตู้</div>
            <div>รูปยืนยัน (5)</div>
            <div>มิเตอร์เหรียญ <span style={{ color: "var(--cf-text-3)", fontWeight: 400 }}>ก่อน → หลัง</span></div>
            <div>มิเตอร์ตุ๊กตา + นับจริง</div>
            <div className="cf-mtable-r">คาดเงิน</div>
            <div className="cf-mtable-r">เงินจริง</div>
            <div className="cf-mtable-r">ตรงมิเตอร์ไหม</div>
          </div>
          {s.machines.map((m, i) => (
            <MachineRow
              key={m.code}
              m={m}
              onPhoto={(pi) => setLightbox({ machineIdx: i, photoIdx: pi })}
            />
          ))}
          {s.machines.length === 0 && (
            <div className="cf-dim" style={{ padding: "24px 12px" }}>
              รอบนี้ยังไม่มีตู้ที่เก็บเงิน (เพิ่งเปิดรอบ)
            </div>
          )}
          {s.machines.length > 0 && (
            <div className="cf-mtable-foot">
              <div>รวม {s.machines.length} ตู้</div>
              <div></div>
              <div>มิเตอร์เหรียญรวม</div>
              <div>ตุ๊กตาออก {s.prizeActual} ตัว</div>
              <div className="cf-mtable-r"><strong>{fmtTHB(s.expectedCash)}</strong></div>
              <div className="cf-mtable-r"><strong>{fmtTHB(s.actualCash)}</strong></div>
              <div className="cf-mtable-r">
                <strong className={s.cashGap < 0 ? "cf-text-red" : "cf-text-emerald"}>
                  {s.cashGap < 0 ? "−" : s.cashGap > 0 ? "+" : ""}
                  {fmtTHB(Math.abs(s.cashGap))}
                </strong>
              </div>
            </div>
          )}
        </div>
      </div>

      {lightbox && s.machines[lightbox.machineIdx] && (
        <Lightbox
          machine={s.machines[lightbox.machineIdx]!}
          idx={lightbox.photoIdx}
          onClose={() => setLightbox(null)}
          onIdx={(i) => setLightbox({ ...lightbox, photoIdx: i })}
        />
      )}
    </div>
  );
}

/* ===== Cross-check card (ผ่าน/มีปัญหา) ===== */

function CrossCheck({
  label, expected, actual, unit, unitSuffix = "", warn, okText, warnText,
}: {
  label: string;
  expected: number;
  actual: number;
  unit: string;
  unitSuffix?: string;
  warn: boolean;
  okText: string;
  warnText: string;
}) {
  const gap = actual - expected;
  const gapPct = expected ? Math.abs(gap / expected) * 100 : 0;
  return (
    <div className={`cf-check ${warn ? "is-warn" : "is-ok"}`}>
      <div className="cf-check-label">{label}</div>
      <div className="cf-check-rows">
        <div className="cf-check-row">
          <span>ควรได้ (มิเตอร์)</span>
          <strong>{unit}{expected.toLocaleString("th-TH")}{unitSuffix}</strong>
        </div>
        <div className="cf-check-row">
          <span>นับ/เก็บได้จริง</span>
          <strong>{unit}{actual.toLocaleString("th-TH")}{unitSuffix}</strong>
        </div>
        <div className={`cf-check-row cf-check-gap ${warn ? "is-warn" : "is-ok"}`}>
          <span>ส่วนต่าง</span>
          <strong>
            {gap > 0 ? "+" : gap < 0 ? "−" : ""}{unit}{Math.abs(gap).toLocaleString("th-TH")}{unitSuffix}
            <span className="cf-check-pct">{gapPct.toFixed(1)}%</span>
          </strong>
        </div>
      </div>
      <div className="cf-check-formula">
        {warn ? `🔴 ${warnText}` : `✅ ${okText}`}
      </div>
    </div>
  );
}

/* ===== Machine row (เหมือน anomaly modal) ===== */

function MachineRow({ m, onPhoto }: { m: Machine; onPhoto: (photoIdx: number) => void }) {
  const meterDelta = m.meterAfter - m.meterBefore;
  const expectedCash = meterDelta * m.coinRate;
  const gap = m.cashIn - expectedCash;
  const physicalPrizeOut = m.prizeBefore + m.refilled - m.prizeAfter;
  const prizeMeterDelta = m.prizeMeterNow - m.prizeMeterPrev;
  const prizeMeterMismatch = prizeMeterDelta - physicalPrizeOut;

  return (
    <div className={`cf-mtable-row ${m.flag || gap < 0 ? "has-flag" : ""}`}>
      <div className="cf-mtable-machine">
        <div className="cf-mtable-mcode">{m.name}</div>
        <div className="cf-dim cf-mtable-msub">{m.code}</div>
        {m.flag && m.note && <div className="cf-mtable-flag">⚑ {m.note}</div>}
      </div>

      <PhotoThumbs machine={m} onPhoto={onPhoto} />

      <div className="cf-mtable-meter">
        <div className="cf-mtable-num">
          <span className="cf-meter-prev" title="รอบก่อน">{m.meterBefore.toLocaleString("th-TH")}</span>
          <Ic name="arrowR" size={11} style={{ color: "var(--cf-text-3)", margin: "0 4px" }} />
          <span title="วันนี้">{m.meterAfter.toLocaleString("th-TH")}</span>
        </div>
        <div className="cf-dim">+{meterDelta} ครั้ง × ฿{m.coinRate}</div>
      </div>

      <div className="cf-mtable-prize">
        <div className="cf-mtable-meter-prize">
          <span className="cf-meter-prev">มิเตอร์ {m.prizeMeterPrev.toLocaleString("th-TH")}</span>
          <Ic name="arrowR" size={11} style={{ color: "var(--cf-text-3)", margin: "0 3px" }} />
          <span>{m.prizeMeterNow.toLocaleString("th-TH")}</span>
          <span className="cf-mtable-meter-prize-delta"> +{prizeMeterDelta}</span>
        </div>
        <div className="cf-mtable-num">
          <span title="ตุ๊กตาก่อนเติม">{m.prizeBefore}</span>
          {m.refilled > 0 && <span className="cf-mtable-refill"> +{m.refilled}</span>}
          <Ic name="arrowR" size={11} style={{ color: "var(--cf-text-3)", margin: "0 4px" }} />
          <span title="หลังเติม">{m.prizeAfter}</span>
        </div>
        {prizeMeterMismatch !== 0 ? (
          <div className="cf-mtable-prize-mismatch">
            ⚠ มิเตอร์บอก {prizeMeterDelta} · นับได้ {physicalPrizeOut} · ต่าง {prizeMeterMismatch > 0 ? "+" : ""}{prizeMeterMismatch}
          </div>
        ) : (
          <div className="cf-dim cf-mtable-prize-ok">✓ มิเตอร์ตรงกับนับ ({physicalPrizeOut} ตัว)</div>
        )}
      </div>

      <div className="cf-mtable-r cf-mtable-cash"><strong>{fmtTHB(expectedCash)}</strong></div>
      <div className="cf-mtable-r cf-mtable-cash"><strong>{fmtTHB(m.cashIn)}</strong></div>
      <div className="cf-mtable-r">
        {gap === 0 ? (
          <strong className="cf-text-emerald">✓ ตรง</strong>
        ) : (
          <strong className={gap < 0 ? "cf-text-red" : "cf-text-amber"}>
            {gap < 0 ? "🔴 ขาด " : "เกิน "}{fmtTHB(Math.abs(gap))}
          </strong>
        )}
      </div>
    </div>
  );
}

/* ===== Photo thumbnails (5 slots) ===== */

type PhotoSlot = { key: string; label: string; tone: "cyan" | "violet" | "amber" | "emerald"; text: string };

function PhotoThumbs({ machine, onPhoto }: { machine: Machine; onPhoto: (photoIdx: number) => void }) {
  const slots: PhotoSlot[] = [
    { key: "mc", label: "มิเตอร์เหรียญ", tone: "cyan", text: machine.meterAfter.toLocaleString("th-TH") },
    { key: "mp", label: "มิเตอร์ตุ๊กตา", tone: "violet", text: machine.prizeMeterNow.toLocaleString("th-TH") },
    { key: "pb", label: "ตุ๊กตาก่อน", tone: "amber", text: machine.prizeBefore + " ตัว" },
    { key: "pa", label: "ตุ๊กตาหลัง", tone: "amber", text: machine.prizeAfter + " ตัว" },
    { key: "cs", label: "เงินสด", tone: "emerald", text: fmtTHB(machine.cashIn) },
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

/* ===== Lightbox ===== */

type LightboxSlot = { label: string; tone: "cyan" | "violet" | "amber" | "emerald"; text: string; sub: string };

function Lightbox({
  machine, idx, onClose, onIdx,
}: {
  machine: Machine;
  idx: number;
  onClose: () => void;
  onIdx: (idx: number) => void;
}) {
  const slots: LightboxSlot[] = [
    { label: "มิเตอร์เหรียญ", tone: "cyan", text: machine.meterAfter.toLocaleString("th-TH"), sub: `รอบก่อน ${machine.meterBefore.toLocaleString("th-TH")} · ขึ้น +${machine.meterAfter - machine.meterBefore} ครั้ง` },
    { label: "มิเตอร์ตุ๊กตา", tone: "violet", text: machine.prizeMeterNow.toLocaleString("th-TH"), sub: `รอบก่อน ${machine.prizeMeterPrev.toLocaleString("th-TH")} · ตู้แจก +${machine.prizeMeterNow - machine.prizeMeterPrev} ตัว` },
    { label: "ตุ๊กตาในตู้ ก่อนเติม", tone: "amber", text: machine.prizeBefore + " ตัว", sub: "นับตอนมาถึง" },
    { label: "ตุ๊กตาในตู้ หลังเติม", tone: "amber", text: machine.prizeAfter + " ตัว", sub: `เติม ${machine.refilled} ตัว` },
    { label: "เงินสดในถาด", tone: "emerald", text: fmtTHB(machine.cashIn), sub: "พนักงานนับเอง" },
  ];
  const cur = slots[idx]!;
  return (
    <div className="cf-lbox" onClick={onClose}>
      <div className="cf-lbox-inner" onClick={(e) => e.stopPropagation()}>
        <button className="cf-lbox-close" onClick={onClose}>
          <Ic name="x" size={20} />
        </button>
        <div className="cf-lbox-title">{machine.name} · {cur.label}</div>
        <div className={`cf-lbox-photo cf-photo-${cur.tone}`}>
          <div className="cf-lbox-num">{cur.text}</div>
          <div className="cf-lbox-stamp">
            <Ic name="camera" size={12} /> {machine.code}
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
