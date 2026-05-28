"use client";

/**
 * ClawFleet v2 — Mobile flow page (preview of the screens staff see on a phone).
 *
 * Ported verbatim from the `MobilePage` component and its 5 step sub-components
 * (`MStart`, `MBefore`, `MCollect`, `MRefill`, `MClose`) in
 * `~/ตู้คีบ/src/page-rest.jsx` (lines ~356-660) to a Next.js 15 App Router
 * client page. All five step bodies live in this same file.
 *
 * Layout chrome (Sidebar + TopBar + cf-app wrappers) is rendered by
 * `app/(admin)/clawfleet/v2/layout.tsx` via the shared client shell. This page
 * renders ONLY the inner `.cf-page` content from the mockup.
 *
 * Step selection is local UI-only state (no branch filter is consumed — the
 * mockup `MobilePage` took no props).
 */

import { useState } from "react";
import { Ic, Pill } from "@/components/clawfleet/v2/chrome";

type Step = { name: string; sub: string };

const STEPS: Step[] = [
  { name: "เริ่มรอบ", sub: "เลือกสาขา" },
  { name: "นับตุ๊กตา", sub: "ก่อนเติม" },
  { name: "มิเตอร์+เงิน", sub: "ถ่าย+นับ" },
  { name: "เติมตุ๊กตา", sub: "จากคลัง" },
  { name: "ปิดรอบ", sub: "cross-check" },
];

export default function MobilePage() {
  const [step, setStep] = useState(0);

  return (
    <div className="cf-page">
      <div className="cf-page-head">
        <div>
          <div className="cf-eyebrow">Mobile flow</div>
          <h1 className="cf-h1">หน้าจอที่พนักงานเห็นบนมือถือ</h1>
          <div className="cf-page-sub">
            1 พนง = 1 สาขา (6 ตู้) · ถ่ายมิเตอร์ปัจจุบัน 1 รูป/ตู้ 100% · รอบก่อนระบบดึงมาให้
          </div>
        </div>
      </div>

      <div className="cf-mobile-tabs">
        {STEPS.map((s, i) => (
          <button
            key={i}
            type="button"
            className={`cf-mobile-tab ${i === step ? "is-active" : ""}`}
            onClick={() => setStep(i)}
          >
            <span className="cf-mobile-tab-n">{i + 1}</span>
            <span>
              <span className="cf-mobile-tab-name">{s.name}</span>
              <span className="cf-mobile-tab-sub">{s.sub}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="cf-mobile-stage">
        <div className="cf-phone">
          <div className="cf-phone-notch" />
          <div className="cf-phone-screen">
            <div className="cf-mscreen">
              <div className="cf-mhead">
                <div className="cf-mhead-back">←</div>
                <div className="cf-mhead-title">
                  {step === 0 && "เริ่มรอบเก็บใหม่"}
                  {step === 1 && "ตู้ 1/6 · นับตุ๊กตาก่อนเติม"}
                  {step === 2 && "ตู้ 1/6 · มิเตอร์ + เก็บเงิน"}
                  {step === 3 && "ตู้ 1/6 · เติมตุ๊กตา"}
                  {step === 4 && "ปิดรอบ + cross-check"}
                </div>
                <div className="cf-mhead-spacer" />
              </div>
              <div className="cf-mbody">
                {step === 0 && <MStart />}
                {step === 1 && <MBefore />}
                {step === 2 && <MCollect />}
                {step === 3 && <MRefill />}
                {step === 4 && <MClose />}
              </div>
            </div>
          </div>
          <div className="cf-phone-home" />
        </div>

        <div className="cf-mobile-notes">
          <div className="cf-mnote-card">
            <div className="cf-mnote-label">โฟลว์ · 1 สาขา = 6 ตู้ · ต่อ 1 ตู้</div>
            <ol className="cf-mnote-flow">
              <li>
                <strong>เริ่มรอบ</strong> — เลือกสาขาที่รับผิดชอบ
              </li>
              <li>
                <strong>นับตุ๊กตาในตู้ ก่อนเติม</strong> — ระบบไม่ต้องถ่ายมิเตอร์ก่อน (มีอยู่แล้ว) · นับ + ถ่ายรูป
              </li>
              <li>
                <strong>ถ่ายมิเตอร์ (2 ตัว) + เก็บเงิน</strong> — มิเตอร์เหรียญ + มิเตอร์ตุ๊กตา · OCR อ่าน · นับเงิน + ถ่าย
              </li>
              <li>
                <strong>เติมตุ๊กตาจากคลังสาขา</strong> — เลือก SKU → เติมจริง → นับหลังเติม + ถ่ายรูป
              </li>
              <li>
                <strong>ลูป 6 ตู้ · ปิดรอบ</strong> — ระบบ cross-check ทันที
              </li>
            </ol>
          </div>

          <div className="cf-mnote-card">
            <div className="cf-mnote-label">รูปต่อตู้ · 5 รูป/ตู้ × 6 = 30 รูป</div>
            <div className="cf-mnote-photos">
              <div className="cf-mnote-photo cf-photo-cyan">
                <span>มิเตอร์ เหรียญ</span>
              </div>
              <div className="cf-mnote-photo cf-photo-violet">
                <span>มิเตอร์ ตุ๊กตา</span>
              </div>
              <div className="cf-mnote-photo cf-photo-amber">
                <span>ตุ๊กตา ก่อนเติม</span>
              </div>
              <div className="cf-mnote-photo cf-photo-amber">
                <span>ตุ๊กตา หลังเติม</span>
              </div>
              <div className="cf-mnote-photo cf-photo-emerald">
                <span>เงินสด</span>
              </div>
            </div>
            <div className="cf-dim" style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.5 }}>
              ⎻ <strong>มิเตอร์ 2 ตัว</strong>: เหรียญ (ครั้งที่ลูกค้าหยอด) + ตุ๊กตา (จำนวนตุ๊กตาที่ตู้แจก) · รอบก่อนระบบดึงมาให้
              — พนงถ่ายแค่รอบปัจจุบัน
            </div>
          </div>

          <div className="cf-mnote-card">
            <div className="cf-mnote-label">Cross-check 2 ทาง</div>
            <div className="cf-mnote-cc">
              <div className="cf-mnote-cc-row">
                <div className="cf-mnote-cc-tag cf-mnote-cc-tag-cash">เงิน</div>
                <div>มิเตอร์ขึ้น × ฿10/ครั้ง = เงินที่ควรได้ ← เทียบกับเงินในถาด</div>
              </div>
              <div className="cf-mnote-cc-row">
                <div className="cf-mnote-cc-tag cf-mnote-cc-tag-prize">ตุ๊กตา</div>
                <div>
                  <strong>มิเตอร์ตุ๊กตา</strong> (sensor) บอกแจกไป N ตัว ←→ (ก่อนเติม − หลังเติม+เติม) = M ตัว · ถ้า N≠M =
                  ตุ๊กตาหาย
                </div>
              </div>
              <div className="cf-mnote-cc-row">
                <div className="cf-mnote-cc-tag cf-mnote-cc-tag-stock">คลัง</div>
                <div>เติมจากคลังสาขา 6 ตัว = คลังสาขาลด 6 ตัว auto</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MStart() {
  return (
    <>
      <div className="cf-mlabel">สาขาวันนี้</div>
      <button type="button" className="cf-mcard cf-mcard-primary">
        <div className="cf-mcard-head">
          <div>
            <div className="cf-mcard-title">ปตท. จักราช</div>
            <div className="cf-mcard-sub">นครราชสีมา · 6 ตู้ · รหัส PTT-001</div>
          </div>
          <Pill color="amber" size="sm" dot>
            ถึงรอบ
          </Pill>
        </div>
        <div className="cf-mcard-foot">
          <span className="cf-dim">รอบล่าสุด · เมื่อวาน 21:40</span>
          <span>เริ่ม →</span>
        </div>
      </button>
      <button type="button" className="cf-mcard">
        <div className="cf-mcard-head">
          <div>
            <div className="cf-mcard-title">ปตท. ปักธงชัย</div>
            <div className="cf-mcard-sub">นครราชสีมา · 6 ตู้</div>
          </div>
          <Pill color="slate" size="sm">
            วันถัดไป
          </Pill>
        </div>
      </button>
      <div className="cf-mlabel" style={{ marginTop: 12 }}>
        สาขาในระบบอื่น (8)
      </div>
      <button type="button" className="cf-mcard">
        <div className="cf-mcard-head">
          <div>
            <div className="cf-mcard-title">ปตท. สีคิ้ว</div>
            <div className="cf-mcard-sub">นครราชสีมา · 5 ตู้</div>
          </div>
        </div>
      </button>
    </>
  );
}

function MBefore() {
  return (
    <>
      <div className="cf-mprog">
        <div className="cf-mprog-text">ตู้ 1 จาก 6 · นับตุ๊กตาในตู้</div>
        <div className="cf-mprog-bar">
          <div style={{ width: "20%" }} />
        </div>
      </div>

      <div className="cf-mref-card">
        <div className="cf-mref-label">
          ตุ๊กตารอบก่อน <span className="cf-dim">(จากระบบ)</span>
        </div>
        <div className="cf-mref-val">
          24 <span className="cf-mref-unit">ตัว</span>
        </div>
        <div className="cf-dim">หลังเติมจากรอบก่อน</div>
      </div>

      <div className="cf-mcamera">
        <div className="cf-mcamera-icon">
          <Ic name="camera" size={28} />
        </div>
        <div className="cf-mcamera-label">ถ่ายตุ๊กตาในตู้ ก่อนเติม</div>
        <div className="cf-mcamera-sub">ส่องให้เห็นตุ๊กตาชัดเจน</div>
      </div>

      <div className="cf-mfield">
        <label>ตุ๊กตาตอนนี้ (นับจริง)</label>
        <div className="cf-mcounter">
          <button type="button">−</button>
          <span>16</span>
          <button type="button">+</button>
        </div>
        <div className="cf-mhint">
          รอบก่อน 24 → ตอนนี้ 16 · ลูกค้าคีบไป <strong>8 ตัว</strong>
        </div>
      </div>

      <button type="button" className="cf-mbtn cf-mbtn-primary">
        ต่อไป — ถ่ายมิเตอร์ + เก็บเงิน →
      </button>
    </>
  );
}

function MCollect() {
  return (
    <>
      <div className="cf-mprog">
        <div className="cf-mprog-text">ตู้ 1 จาก 6 · ถ่ายมิเตอร์ + เก็บเงิน</div>
        <div className="cf-mprog-bar">
          <div style={{ width: "40%" }} />
        </div>
      </div>

      <div className="cf-mref-row">
        <div className="cf-mref-card cf-mref-card-cyan">
          <div className="cf-mref-label">มิเตอร์เหรียญ รอบก่อน</div>
          <div className="cf-mref-val">14,600</div>
        </div>
        <div className="cf-mref-card cf-mref-card-violet">
          <div className="cf-mref-label">มิเตอร์ตุ๊กตา รอบก่อน</div>
          <div className="cf-mref-val">980</div>
        </div>
      </div>

      <div className="cf-mcamera">
        <div className="cf-mcamera-icon">
          <Ic name="camera" size={28} />
        </div>
        <div className="cf-mcamera-label">ถ่ายมิเตอร์ตอนนี้ (2 ตัว)</div>
        <div className="cf-mcamera-sub">เหรียญ + ตุ๊กตา · OCR อ่านให้</div>
      </div>

      <div className="cf-mfield">
        <label>
          มิเตอร์เหรียญวันนี้ <span className="cf-dim">(OCR อ่าน)</span>
        </label>
        <input value="14,708" readOnly />
        <div className="cf-mhint cf-text-emerald">
          ✓ +108 ครั้ง × ฿10 = ควรมีเงิน <strong>฿1,080</strong>
        </div>
      </div>

      <div className="cf-mfield">
        <label>
          มิเตอร์ตุ๊กตาวันนี้ <span className="cf-dim">(OCR อ่าน)</span>
        </label>
        <input value="988" readOnly />
        <div className="cf-mhint">+8 ครั้ง · ตู้แจกตุ๊กตา 8 ตัว — เทียบกับนับจริงตอนปิดรอบ</div>
      </div>

      <div className="cf-mfield">
        <label>เงินสดในถาด (นับจริง) + ถ่ายรูป</label>
        <input value="฿1,080" readOnly />
        <div className="cf-mhint cf-text-emerald">✓ ตรงกับมิเตอร์</div>
      </div>
      <button type="button" className="cf-mbtn cf-mbtn-primary">
        บันทึก — เติมตุ๊กตา →
      </button>
    </>
  );
}

function MRefill() {
  return (
    <>
      <div className="cf-mprog">
        <div className="cf-mprog-text">เติมตุ๊กตา · ตู้ 1 จาก 6</div>
        <div className="cf-mprog-bar">
          <div style={{ width: "50%" }} />
        </div>
      </div>
      <div className="cf-mfield">
        <label>ตุ๊กตาในตู้ตอนนี้ (นับจริง)</label>
        <div className="cf-mcounter">
          <button type="button">−</button>
          <span>16</span>
          <button type="button">+</button>
        </div>
        <div className="cf-mhint">
          ก่อนเก็บ 24 ตัว → ลูกค้าคีบไป <strong>8 ตัว</strong>
        </div>
      </div>
      <div className="cf-mlabel" style={{ marginTop: 8 }}>
        เติมจากคลังสาขา
      </div>
      <div className="cf-mskupick">
        <div className="cf-msku">
          <div>
            <div className="cf-msku-name">หมีน้ำตาล M</div>
            <div className="cf-dim">คลัง 18 ตัว</div>
          </div>
          <div className="cf-mcounter cf-mcounter-sm">
            <button type="button">−</button>
            <span>6</span>
            <button type="button">+</button>
          </div>
        </div>
        <div className="cf-msku">
          <div>
            <div className="cf-msku-name">แมวขาว S</div>
            <div className="cf-dim">คลัง 24 ตัว</div>
          </div>
          <div className="cf-mcounter cf-mcounter-sm">
            <button type="button">−</button>
            <span>2</span>
            <button type="button">+</button>
          </div>
        </div>
        <button type="button" className="cf-msku-add">
          + เพิ่ม SKU
        </button>
      </div>
      <div className="cf-mphoto-grid cf-mphoto-grid-2">
        <div className="cf-mphoto cf-mphoto-required is-todo">
          <Ic name="camera" size={16} />
          <span>หลังเติม</span>
        </div>
        <div className="cf-mphoto is-done">
          <Ic name="check" size={16} />
          <span>ตุ๊กตาในถาด</span>
        </div>
      </div>
      <button type="button" className="cf-mbtn cf-mbtn-primary">
        บันทึก — ไปตู้ 2 →
      </button>
    </>
  );
}

function MClose() {
  return (
    <>
      <div className="cf-mcheck">
        <div className="cf-mcheck-row">
          <span className="cf-text-emerald">✓</span> 6 ตู้ · 30/30 รูป
        </div>
        <div className="cf-mcheck-row">
          <span className="cf-text-emerald">✓</span> มิเตอร์ครบ · ตุ๊กตานับครบ
        </div>
        <div className="cf-mcheck-row">
          <span className="cf-text-amber">⚑</span> ตู้ 06 ไม่ขึ้น · ต้องแจ้ง
        </div>
      </div>
      <div className="cf-mlabel">Cross-check: เงิน</div>
      <div className="cf-msummary">
        <div className="cf-msummary-row">
          <span>มิเตอร์รวม +840 ครั้ง × ฿10</span>
          <strong>฿8,400</strong>
        </div>
        <div className="cf-msummary-row">
          <span>เงินสดในถาด รวม 6 ตู้</span>
          <strong>฿5,860</strong>
        </div>
        <div className="cf-msummary-row is-gap">
          <span>ส่วนต่าง</span>
          <strong className="cf-text-red">-฿2,540 · 30%</strong>
        </div>
      </div>
      <div className="cf-mlabel">Cross-check: ตุ๊กตา (มิเตอร์ตุ๊กตา vs นับจริง)</div>
      <div className="cf-msummary">
        <div className="cf-msummary-row">
          <span>มิเตอร์ตุ๊กตา ขึ้นรวม 6 ตู้</span>
          <strong>+50 ตัว</strong>
        </div>
        <div className="cf-msummary-row">
          <span>นับตุ๊กตาหายจากตู้ (รวม)</span>
          <strong>45 ตัว</strong>
        </div>
        <div className="cf-msummary-row is-gap">
          <span>ส่วนต่าง</span>
          <strong className="cf-text-red">5 ตัว · ตู้แจกแต่หาไม่เจอ</strong>
        </div>
      </div>
      <div className="cf-malert">
        <Ic name="alert" size={16} />
        <div>
          <strong>เงินขาดเกิน 5% · flag เป็น Anomaly</strong>
          <div className="cf-dim">เจ้าของจะตรวจรอบนี้ก่อน + เห็นว่าตู้ 06 เสีย</div>
        </div>
      </div>
      <button type="button" className="cf-mbtn cf-mbtn-primary">
        ส่งให้เจ้าของตรวจ
      </button>
    </>
  );
}
