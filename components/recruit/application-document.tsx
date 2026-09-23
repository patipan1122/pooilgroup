"use client";

// Recruit Onboarding — "ใบสมัครงาน" ฉบับกระดาษ (A4) สำหรับพรีวิว/พิมพ์/บันทึก
//
// CEO 2026-09-23: ปริ้นออกมาต้องเป็น "แบบฟอร์มกระดาษจริง" — ตารางมีขอบ
// ช่องกรอกแยกเป็นกล่องชัดเจน มีเส้นคั่นทุกช่อง รูปถ่ายอยู่มุมขวาบน
// และตัวหนังสือที่ "คนกรอก" ต้องหนา/เข้มกว่าหัวข้อที่พิมพ์ไว้ในฟอร์ม
// (อ้างอิงใบสมัครจริงแบบ Com7 / MUD&HOUND ที่ CEO ส่งรูปมา)
//
// ⚠️ บทเรียนรอบที่แล้ว — ห้ามพลาดซ้ำ: ไฟล์นี้เคยใช้ `<style jsx>` ขณะที่แตก
// markup ออกเป็นคอมโพเนนต์ย่อย (Field/Row/SectionHead/Filled) — styled-jsx
// ใส่ scope hash ให้เฉพาะ JSX ที่เขียนอยู่ใน "ฟังก์ชันเดียวกัน" กับ <style jsx>
// เท่านั้น → ทุกคลาสที่อยู่ในคอมโพเนนต์ย่อยไม่ได้สไตล์เลยสักบรรทัด ใบสมัคร
// ที่ปริ้นออกมาจึงเป็นข้อความเปล่า ๆ ป้ายกำกับติดกับค่าที่กรอก ("ยังกับ code")
// → CSS ทั้งหมดของเอกสารนี้อยู่ที่ app/globals.css เป็นคลาส global ขึ้นต้น
// `rcdoc-` ทุกตัว · ห้ามใส่ <style jsx> ในไฟล์นี้อีกเด็ดขาด
//
// โทนเอกสารชุดเดียวกับสัญญาเช่า RentSpace — พื้นขาว ตัวอักษร #111 เส้นบาง
// มุมมน 8px หัวเอกสารกลางหน้า เส้นเซ็นชื่อ print-color-adjust
// (components/rentspace/contract-document.tsx) และโลโก้ตัวเดียวกับใบวางบิล
// RentSpace (components/rentspace/bill-document.tsx)
//
// ⚠️ เอกสารนี้ไม่มี "เนื้อสัญญาจ้าง" อยู่ในนั้น (CEO สั่งชัด) — มีแค่บรรทัด
// ยืนยันว่าผู้สมัครยอมรับข้อกำหนดและเงื่อนไขตามสัญญาจ้างของบริษัทแล้ว
// ตัวสัญญายังอ่านได้เฉพาะในหน้าเซ็น ซึ่งล็อกไม่ให้ก๊อป/บันทึก/พิมพ์ไว้ต่างหาก.
//
// Pure render — ไม่มี data fetching, ไม่แตะ DB. รับข้อมูลที่กรอกมาแล้วล้วน ๆ
// จึงใช้ได้ทั้งตอนพรีวิวก่อนส่ง (ฝั่งผู้สมัคร) และหน้า HR ในอนาคต.

import type { ReactNode } from "react";

/** คีย์ sessionStorage ของ "สำเนาใบสมัครไว้ดูอย่างเดียว" ที่หน้า success ใช้อ่าน
 *  (คนละตัวกับ handoff ที่ใช้ส่งข้อมูล ซึ่งถูกล้างทิ้งทันทีหลังส่งสำเร็จ) */
export function onboardingReceiptKey(reference: string): string {
  return `recruit_onboard_receipt_${reference}`;
}

export interface ApplicationDocEmergencyContact {
  name: string;
  relation: string;
  phone: string;
}

export interface ApplicationDocWorkItem {
  company: string;
  position?: string;
  period?: string;
  salary?: string;
  reasonLeaving?: string;
}

export interface ApplicationDocData {
  companyName: string; // ชื่อนิติบุคคลภาษาไทย
  branch: string;
  position: string;
  startDateText: string; // วันที่เริ่มงาน (ไทย)
  dailyWageText: string; // ค่าแรงต่อวัน
  submittedAtText: string;

  titlePrefix: string;
  fullNameTh: string;
  fullNameEn?: string;
  nickname: string;
  nationalId: string;
  birthDateText: string;
  nationality: string;
  militaryStatus?: string;
  phone: string;
  lineId?: string;
  email?: string;
  maritalStatus?: string;

  registeredAddress: string;
  currentAddress: string;

  emergencyContacts: ApplicationDocEmergencyContact[];

  educationLevel: string;
  educationInstitute?: string;
  educationYear?: string;

  hasWorkExperience: boolean;
  workHistory: ApplicationDocWorkItem[];
  referenceName?: string;
  referencePhone?: string;

  bankName: string;
  bankAccountNo: string;
  bankAccountName: string;
  noBankAccountYet: boolean;

  attachedDocLabels: string[];

  /** ลายเซ็นที่วาดไว้ (data URL) — ใส่เมื่อเซ็นแล้ว ไม่ใส่ = เว้นเส้นให้เซ็นมือ */
  signatureDataUrl?: string | null;

  /**
   * รูปถ่าย/เซลฟี่ของผู้สมัคร (data URL หรือ blob URL) → แสดงในกรอบรูปมุมขวาบน
   * เหมือนช่อง "ติดรูปถ่าย 1 นิ้ว" ของใบสมัครกระดาษ
   * ไม่ส่งมา = เว้นกรอบเส้นประไว้ให้ติดรูปเอง
   */
  selfieDataUrl?: string | null;
}

/** ช่องที่ยังไม่ได้กรอก — ขีดจาง ๆ กันช่องในตารางดูพังเวลาปริ้น */
const BLANK = "—";

/**
 * ช่องกรอกหนึ่งช่องในตาราง — ป้ายกำกับตัวเล็กสีจางด้านบน + ค่าที่ผู้สมัครกรอก
 * ตัวหนาเข้มด้านล่าง (อ่านแล้วรู้ทันทีว่าอันไหนฟอร์มพิมพ์ไว้ อันไหนคนกรอก)
 * `span` = สัดส่วนความกว้างเทียบกับช่องอื่นในแถวเดียวกัน
 */
function Cell({
  label,
  value,
  span = 1,
}: {
  label: string;
  value?: string | null;
  span?: number;
}) {
  const v = (value ?? "").trim();
  return (
    <div className="rcdoc-c" style={{ flexGrow: span }}>
      <span className="rcdoc-l">{label}</span>
      <span className={v === "" ? "rcdoc-v rcdoc-v-blank" : "rcdoc-v"}>
        {v === "" ? BLANK : v}
      </span>
    </div>
  );
}

/** หนึ่งแถวของตาราง — ช่องข้างในถูกคั่นด้วยเส้นแนวตั้งอัตโนมัติ */
function Row({ children }: { children: ReactNode }) {
  return <div className="rcdoc-r">{children}</div>;
}

/** กล่องหมวด: แถบหัวมีเลขกำกับ + เนื้อในเป็นตารางช่องกรอกที่มีขอบทุกช่อง */
function Section({
  no,
  title,
  titleEn,
  children,
}: {
  no: number;
  title: string;
  titleEn?: string;
  children: ReactNode;
}) {
  return (
    <section className="rcdoc-sec">
      <div className="rcdoc-sec-h">
        <span className="rcdoc-sec-no">{no}</span>
        <span className="rcdoc-sec-t">{title}</span>
        {titleEn === undefined ? null : <span className="rcdoc-sec-en">{titleEn}</span>}
      </div>
      <div className="rcdoc-sec-b">{children}</div>
    </section>
  );
}

export function RecruitApplicationDocument({
  data,
  printId,
}: {
  data: ApplicationDocData;
  printId?: string;
}) {
  const d = data;
  const contacts = [d.emergencyContacts[0], d.emergencyContacts[1]];
  const hasWork = d.hasWorkExperience && d.workHistory.length > 0;

  return (
    <div id={printId} className="rcdoc">
      {/* .rcdoc เป็นตัวเลื่อนแนวนอนบนจอมือถือ · .rcdoc-page คือเนื้อกระดาษจริง
          (padding อยู่ที่ชั้นใน ไม่งั้นเบราว์เซอร์กินขอบขวาตอนเลื่อนสุด) */}
      <div className="rcdoc-page">
        {/* ── หัวกระดาษ: โลโก้ซ้าย · ชื่อเอกสารกลาง · รูปถ่ายมุมขวาบน ───── */}
        <header className="rcdoc-mast">
          <div className="rcdoc-mast-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logos/jpsync-logo-full.png" alt="JPSYNC GROUP" />
          </div>
          <div className="rcdoc-mast-mid">
            <div className="rcdoc-h1">ใบสมัครงาน</div>
            <div className="rcdoc-h1-en">APPLICATION FOR EMPLOYMENT</div>
            <div className="rcdoc-company">{d.companyName}</div>
          </div>
          {/* กรอบรูป: มีรูปแล้วใส่รูปจริง · ยังไม่มีก็เว้นกรอบเส้นประไว้ */}
          <div className="rcdoc-photo-wrap">
            {d.selfieDataUrl ? (
              <div className="rcdoc-photo rcdoc-photo-has">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.selfieDataUrl} alt="รูปถ่ายผู้สมัคร" />
              </div>
            ) : (
              <div className="rcdoc-photo rcdoc-photo-empty">
                <span>ติดรูปถ่าย</span>
                <span className="rcdoc-photo-sub">1 นิ้ว</span>
              </div>
            )}
            <div className="rcdoc-photo-cap">รูปถ่ายผู้สมัคร</div>
          </div>
        </header>
        <div className="rcdoc-mast-rule" />

        {/* ── 1. ตำแหน่งที่สมัคร ───────────────────────────────────────── */}
        <Section no={1} title="ตำแหน่งที่สมัคร" titleEn="POSITION APPLIED FOR">
          <Row>
            <Cell label="ตำแหน่ง" value={d.position} span={2} />
            <Cell label="สาขา / สถานที่ทำงาน" value={d.branch} span={2} />
          </Row>
          <Row>
            <Cell label="วันที่เริ่มงาน" value={d.startDateText} />
            <Cell label="ค่าแรงต่อวัน (บาท)" value={d.dailyWageText} />
            <Cell label="วันที่ยื่นใบสมัคร" value={d.submittedAtText} />
          </Row>
        </Section>

        {/* ── 2. ข้อมูลส่วนตัว ─────────────────────────────────────────── */}
        <Section no={2} title="ข้อมูลส่วนตัว" titleEn="PERSONAL INFORMATION">
          <Row>
            <Cell label="คำนำหน้า" value={d.titlePrefix} />
            <Cell label="ชื่อ-นามสกุล" value={d.fullNameTh} span={4} />
            <Cell label="ชื่อเล่น" value={d.nickname} />
          </Row>
          <Row>
            <Cell label="ชื่อ-นามสกุล (ภาษาอังกฤษ)" value={d.fullNameEn} span={3} />
            <Cell label="เลขบัตรประชาชน" value={d.nationalId} span={2} />
          </Row>
          <Row>
            <Cell label="วัน/เดือน/ปีเกิด" value={d.birthDateText} />
            <Cell label="สัญชาติ" value={d.nationality} />
            <Cell label="สถานภาพสมรส" value={d.maritalStatus} />
          </Row>
          <Row>
            <Cell label="สถานะการเกณฑ์ทหาร" value={d.militaryStatus} span={2} />
            <Cell label="เบอร์มือถือ" value={d.phone} />
          </Row>
          <Row>
            <Cell label="LINE ID" value={d.lineId} />
            <Cell label="อีเมล" value={d.email} span={2} />
          </Row>
        </Section>

        {/* ── 3. ที่อยู่ ───────────────────────────────────────────────── */}
        <Section no={3} title="ที่อยู่" titleEn="ADDRESS">
          <Row>
            <Cell label="ที่อยู่ตามทะเบียนบ้าน" value={d.registeredAddress} />
          </Row>
          <Row>
            <Cell label="ที่อยู่ปัจจุบัน" value={d.currentAddress} />
          </Row>
        </Section>

        {/* ── 4. ผู้ติดต่อกรณีฉุกเฉิน ──────────────────────────────────── */}
        <Section no={4} title="ผู้ติดต่อกรณีฉุกเฉิน" titleEn="EMERGENCY CONTACT">
          {contacts.map((c, i) => (
            <Row key={i}>
              <Cell label={`คนที่ ${i + 1} · ชื่อ-นามสกุล`} value={c?.name} span={2} />
              <Cell label="ความสัมพันธ์" value={c?.relation} />
              <Cell label="เบอร์โทร" value={c?.phone} />
            </Row>
          ))}
        </Section>

        {/* ── 5. การศึกษา ──────────────────────────────────────────────── */}
        <Section no={5} title="การศึกษา" titleEn="EDUCATION">
          <Row>
            <Cell label="วุฒิการศึกษาสูงสุด" value={d.educationLevel} />
            <Cell label="สถาบันการศึกษา" value={d.educationInstitute} span={2} />
            <Cell label="ปีที่จบ (พ.ศ.)" value={d.educationYear} />
          </Row>
        </Section>

        {/* ── 6. ประวัติการทำงาน ───────────────────────────────────────── */}
        <Section no={6} title="ประวัติการทำงาน" titleEn="WORK EXPERIENCE">
          {hasWork ? (
            <table className="rcdoc-table">
              <thead>
                <tr>
                  <th className="rcdoc-w28">ชื่อที่ทำงาน</th>
                  <th className="rcdoc-w18">ตำแหน่ง</th>
                  <th className="rcdoc-w18">ช่วงเวลา</th>
                  <th className="rcdoc-w14">เงินเดือนล่าสุด</th>
                  <th>เหตุผลที่ออก</th>
                </tr>
              </thead>
              <tbody>
                {d.workHistory.map((w, i) => (
                  <tr key={i}>
                    <td>{w.company === "" ? BLANK : w.company}</td>
                    <td>{w.position === undefined || w.position === "" ? BLANK : w.position}</td>
                    <td>{w.period === undefined || w.period === "" ? BLANK : w.period}</td>
                    <td>{w.salary === undefined || w.salary === "" ? BLANK : w.salary}</td>
                    <td>
                      {w.reasonLeaving === undefined || w.reasonLeaving === ""
                        ? BLANK
                        : w.reasonLeaving}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Row>
              <Cell label="ประสบการณ์ทำงาน" value="ไม่มีประสบการณ์ทำงานมาก่อน" />
            </Row>
          )}
          <Row>
            <Cell label="บุคคลอ้างอิง" value={d.referenceName} span={2} />
            <Cell label="เบอร์โทรผู้อ้างอิง" value={d.referencePhone} />
          </Row>
        </Section>

        {/* ── 7. บัญชีรับเงินเดือน ─────────────────────────────────────── */}
        <Section no={7} title="บัญชีรับเงินเดือน" titleEn="PAYROLL ACCOUNT">
          {d.noBankAccountYet ? (
            <Row>
              <Cell
                label="ธนาคาร"
                value="ยังไม่ได้เปิดบัญชี ttb — จะดำเนินการเปิดก่อนรอบจ่ายเงินแรก"
              />
            </Row>
          ) : (
            <Row>
              <Cell label="ธนาคาร" value={d.bankName} />
              <Cell label="เลขที่บัญชี" value={d.bankAccountNo} span={2} />
              <Cell label="ชื่อบัญชี" value={d.bankAccountName} span={2} />
            </Row>
          )}
        </Section>

        {/* ── 8. เอกสารแนบ ─────────────────────────────────────────────── */}
        <Section no={8} title="เอกสารแนบ" titleEn="ATTACHED DOCUMENTS">
          <Row>
            <div className="rcdoc-c">
              <span className="rcdoc-l">รายการเอกสารที่แนบมาพร้อมใบสมัคร</span>
              <div className="rcdoc-checks">
                {d.attachedDocLabels.length === 0 ? (
                  <span className="rcdoc-v rcdoc-v-blank">— ไม่มีเอกสารแนบ —</span>
                ) : (
                  d.attachedDocLabels.map((label) => (
                    <span key={label} className="rcdoc-check">
                      <span className="rcdoc-tick" aria-hidden>
                        ✓
                      </span>
                      <span className="rcdoc-check-t">{label}</span>
                    </span>
                  ))
                )}
              </div>
            </div>
          </Row>
        </Section>

        {/* ── 9. คำรับรอง + ลายเซ็น (ไม่มีเนื้อสัญญาในเอกสารนี้) ───────── */}
        <Section no={9} title="คำรับรองของผู้สมัคร" titleEn="DECLARATION">
          <Row>
            <div className="rcdoc-c rcdoc-declare">
              <p>
                ข้าพเจ้าขอรับรองว่าข้อความและเอกสารที่ให้ไว้ข้างต้นเป็นความจริงทุกประการ
                หากตรวจพบภายหลังว่าเป็นเท็จ ข้าพเจ้ายินยอมให้บริษัทเลิกจ้างได้ทันที
              </p>
              <p>
                ข้าพเจ้าได้อ่านและ
                <b>ยอมรับข้อกำหนดและเงื่อนไขตามหนังสือสัญญาจ้างแรงงานของบริษัท</b>{" "}
                (ฉบับที่ลงลายมือชื่อทางอิเล็กทรอนิกส์ไว้ในระบบ) รวมถึงนโยบายความเป็นส่วนตัว
                และยินยอมให้บริษัทเก็บและใช้ข้อมูลส่วนบุคคลตามวัตถุประสงค์ที่ระบุไว้
              </p>
            </div>
          </Row>
          <Row>
            <div className="rcdoc-c rcdoc-sign">
              {d.signatureDataUrl ? (
                <div className="rcdoc-sign-img">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={d.signatureDataUrl} alt="ลายมือชื่อผู้สมัคร" />
                </div>
              ) : (
                <div className="rcdoc-sign-space" />
              )}
              <div className="rcdoc-sign-line" />
              <div className="rcdoc-sign-role">ลายมือชื่อผู้สมัคร</div>
              <div className="rcdoc-sign-name">
                ( {d.fullNameTh === "" ? ".............................." : d.fullNameTh} )
              </div>
              <div className="rcdoc-sign-date">
                วันที่ {d.submittedAtText === "" ? "......./......./........." : d.submittedAtText}
              </div>
            </div>
            <div className="rcdoc-c rcdoc-sign">
              <div className="rcdoc-sign-space" />
              <div className="rcdoc-sign-line" />
              <div className="rcdoc-sign-role">ผู้รับสมัคร / ฝ่ายบุคคล</div>
              <div className="rcdoc-sign-name">( .............................. )</div>
              <div className="rcdoc-sign-date">วันที่ ......./......./.........</div>
            </div>
          </Row>
        </Section>

        <div className="rcdoc-foot">
          เอกสารนี้สร้างจากระบบรับพนักงานใหม่ออนไลน์ · {d.companyName} · พิมพ์เมื่อ{" "}
          {d.submittedAtText}
        </div>
      </div>
    </div>
  );
}
