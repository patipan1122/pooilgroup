"use client";

// Recruit Onboarding — "ใบสมัครงาน" ฉบับกระดาษ (A4) สำหรับพรีวิว/พิมพ์/บันทึก
//
// CEO 2026-09-23: อยากได้ใบสมัครที่ปริ้นออกมาแล้ว "ดูเป็นทางการ" เหมือนใบสมัคร
// งานจริง — มีหัวบริษัท โลโก้ ช่องที่พนักงานกรอกเป็นเส้นไข่ปลา จัดหน้าสวย
// และให้ใช้โทนสี/โลโก้ชุดเดียวกับ "สัญญาเช่า" ในโปรแกรมบริหารพื้นที่เช่า
// (RentSpace) → ยืมภาษาเอกสารจาก components/rentspace/contract-document.tsx
// (rsdoc: หัวเอกสารกลางหน้า · กล่องขอบบาง · เส้นเซ็นชื่อ · print-color-adjust)
// และโลโก้ตัวเดียวกับใบวางบิล RentSpace (components/rentspace/bill-document.tsx).
//
// ⚠️ เอกสารนี้ไม่มี "เนื้อสัญญาจ้าง" อยู่ในนั้น (CEO สั่งชัด) — มีแค่บรรทัด
// ยืนยันว่าผู้สมัครยอมรับข้อกำหนดและเงื่อนไขตามสัญญาจ้างของบริษัทแล้ว
// ตัวสัญญายังอ่านได้เฉพาะในหน้าเซ็น ซึ่งล็อกไม่ให้ก๊อป/บันทึก/พิมพ์ไว้ต่างหาก.
//
// Pure render — ไม่มี data fetching, ไม่แตะ DB. รับข้อมูลที่กรอกมาแล้วล้วน ๆ
// จึงใช้ได้ทั้งตอนพรีวิวก่อนส่ง (ฝั่งผู้สมัคร) และหน้า HR ในอนาคต.

import type { ReactNode } from "react";

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
}

/** ค่าที่ผู้สมัครกรอก — ว่าง = เส้นไข่ปลาเปล่า (เหมือนใบสมัครกระดาษจริง) */
function Filled({ value }: { value?: string | null }) {
  const v = (value ?? "").trim();
  return <span className="rcdoc-filled">{v === "" ? "" : v}</span>;
}

/** หนึ่งช่องกรอก: ป้ายกำกับ + เส้นไข่ปลาที่มีค่าอยู่ข้างบน */
function Field({
  label,
  value,
  grow = 1,
}: {
  label: string;
  value?: string | null;
  grow?: number;
}) {
  return (
    <div className="rcdoc-field" style={{ flexGrow: grow, flexBasis: 0 }}>
      <span className="rcdoc-label">{label}</span>
      <span className="rcdoc-dots">
        <Filled value={value} />
      </span>
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="rcdoc-row">{children}</div>;
}

function SectionHead({ no, title }: { no: number; title: string }) {
  return (
    <div className="rcdoc-sechead">
      <span className="rcdoc-secno">{no}</span>
      <span>{title}</span>
    </div>
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

  return (
    <div id={printId} className="rcdoc">
      {/* ── หัวกระดาษ: โลโก้ซ้าย · ชื่อเอกสารกลาง · ช่องติดรูปขวา ───────── */}
      <div className="rcdoc-head">
        <div className="rcdoc-head-logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/jpsync-logo-full.png" alt="JPSYNC GROUP" />
        </div>
        <div className="rcdoc-head-mid">
          <div className="rcdoc-h1">ใบสมัครงาน</div>
          <div className="rcdoc-h1-en">APPLICATION FOR EMPLOYMENT</div>
          <div className="rcdoc-company">{d.companyName}</div>
        </div>
        {/* ช่องติดรูป — ใบสมัครกระดาษไทยมีเสมอ ถ้ามีรูปถ่ายแนบมาแล้วเขียนกำกับ */}
        <div className="rcdoc-photo">
          <span>ติดรูปถ่าย</span>
          <span className="rcdoc-photo-sub">1 นิ้ว</span>
        </div>
      </div>
      <div className="rcdoc-rule" />

      {/* ── 1. ตำแหน่งที่สมัคร ─────────────────────────────────────────── */}
      <SectionHead no={1} title="ตำแหน่งที่สมัคร" />
      <Row>
        <Field label="ตำแหน่ง" value={d.position} grow={2} />
        <Field label="สาขา / สถานที่ทำงาน" value={d.branch} grow={2} />
      </Row>
      <Row>
        <Field label="วันที่เริ่มงาน" value={d.startDateText} />
        <Field label="ค่าแรงต่อวัน (บาท)" value={d.dailyWageText} />
      </Row>

      {/* ── 2. ข้อมูลส่วนตัว ───────────────────────────────────────────── */}
      <SectionHead no={2} title="ข้อมูลส่วนตัว (Personal Information)" />
      <Row>
        <Field label="คำนำหน้า" value={d.titlePrefix} />
        <Field label="ชื่อ-นามสกุล" value={d.fullNameTh} grow={3} />
        <Field label="ชื่อเล่น" value={d.nickname} />
      </Row>
      <Row>
        <Field label="ชื่อ-นามสกุล (ภาษาอังกฤษ)" value={d.fullNameEn} grow={2} />
        <Field label="เลขบัตรประชาชน" value={d.nationalId} grow={2} />
      </Row>
      <Row>
        <Field label="วัน/เดือน/ปีเกิด" value={d.birthDateText} />
        <Field label="สัญชาติ" value={d.nationality} />
        <Field label="สถานภาพ" value={d.maritalStatus} />
      </Row>
      <Row>
        <Field label="สถานะการเกณฑ์ทหาร" value={d.militaryStatus} grow={2} />
        <Field label="เบอร์มือถือ" value={d.phone} />
      </Row>
      <Row>
        <Field label="LINE ID" value={d.lineId} />
        <Field label="อีเมล" value={d.email} grow={2} />
      </Row>

      {/* ── 3. ที่อยู่ ─────────────────────────────────────────────────── */}
      <SectionHead no={3} title="ที่อยู่" />
      <Row>
        <Field label="ที่อยู่ตามทะเบียนบ้าน" value={d.registeredAddress} />
      </Row>
      <Row>
        <Field label="ที่อยู่ปัจจุบัน" value={d.currentAddress} />
      </Row>

      {/* ── 4. ผู้ติดต่อฉุกเฉิน ────────────────────────────────────────── */}
      <SectionHead no={4} title="ผู้ติดต่อกรณีฉุกเฉิน" />
      {contacts.map((c, i) => (
        <Row key={i}>
          <Field label={`คนที่ ${i + 1} · ชื่อ-นามสกุล`} value={c?.name} grow={2} />
          <Field label="ความสัมพันธ์" value={c?.relation} />
          <Field label="เบอร์โทร" value={c?.phone} />
        </Row>
      ))}

      {/* ── 5. การศึกษา ────────────────────────────────────────────────── */}
      <SectionHead no={5} title="การศึกษา" />
      <Row>
        <Field label="วุฒิการศึกษาสูงสุด" value={d.educationLevel} />
        <Field label="สถาบันการศึกษา" value={d.educationInstitute} grow={2} />
        <Field label="ปีที่จบ (พ.ศ.)" value={d.educationYear} />
      </Row>

      {/* ── 6. ประวัติการทำงาน ─────────────────────────────────────────── */}
      <SectionHead no={6} title="ประวัติการทำงาน" />
      {!d.hasWorkExperience || d.workHistory.length === 0 ? (
        <Row>
          <Field label="ประสบการณ์ทำงาน" value="ไม่มีประสบการณ์ทำงานมาก่อน" />
        </Row>
      ) : (
        <table className="rcdoc-table">
          <thead>
            <tr>
              <th style={{ width: "30%" }}>ชื่อที่ทำงาน</th>
              <th style={{ width: "20%" }}>ตำแหน่ง</th>
              <th style={{ width: "18%" }}>ช่วงเวลา</th>
              <th style={{ width: "14%" }}>เงินเดือนล่าสุด</th>
              <th>เหตุผลที่ออก</th>
            </tr>
          </thead>
          <tbody>
            {d.workHistory.map((w, i) => (
              <tr key={i}>
                <td>{w.company}</td>
                <td>{w.position ?? ""}</td>
                <td>{w.period ?? ""}</td>
                <td>{w.salary ?? ""}</td>
                <td>{w.reasonLeaving ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Row>
        <Field label="บุคคลอ้างอิง" value={d.referenceName} grow={2} />
        <Field label="เบอร์โทรผู้อ้างอิง" value={d.referencePhone} />
      </Row>

      {/* ── 7. บัญชีรับเงินเดือน ───────────────────────────────────────── */}
      <SectionHead no={7} title="บัญชีรับเงินเดือน" />
      {d.noBankAccountYet ? (
        <Row>
          <Field label="ธนาคาร" value="ยังไม่ได้เปิดบัญชี ttb — จะดำเนินการเปิดก่อนรอบจ่ายเงินแรก" />
        </Row>
      ) : (
        <Row>
          <Field label="ธนาคาร" value={d.bankName} />
          <Field label="เลขที่บัญชี" value={d.bankAccountNo} grow={2} />
          <Field label="ชื่อบัญชี" value={d.bankAccountName} grow={2} />
        </Row>
      )}

      {/* ── 8. เอกสารแนบ ───────────────────────────────────────────────── */}
      <SectionHead no={8} title="เอกสารแนบ" />
      <div className="rcdoc-attach">
        {d.attachedDocLabels.length === 0 ? (
          <span className="rcdoc-attach-empty">— ไม่มีเอกสารแนบ —</span>
        ) : (
          d.attachedDocLabels.map((label) => (
            <span key={label} className="rcdoc-attach-item">
              <span className="rcdoc-tick">✓</span>
              {label}
            </span>
          ))
        )}
      </div>

      {/* ── 9. คำรับรอง + ยอมรับเงื่อนไข (ไม่มีเนื้อสัญญาในเอกสารนี้) ──── */}
      <SectionHead no={9} title="คำรับรองของผู้สมัคร" />
      <div className="rcdoc-declare">
        <p>
          ข้าพเจ้าขอรับรองว่าข้อความและเอกสารที่ให้ไว้ข้างต้นเป็นความจริงทุกประการ
          หากตรวจพบภายหลังว่าเป็นเท็จ ข้าพเจ้ายินยอมให้บริษัทเลิกจ้างได้ทันที
        </p>
        <p>
          ข้าพเจ้าได้อ่านและ<b>ยอมรับข้อกำหนดและเงื่อนไขตามหนังสือสัญญาจ้างแรงงานของบริษัท</b>
          {" "}(ฉบับที่ลงลายมือชื่อทางอิเล็กทรอนิกส์ไว้ในระบบ) รวมถึงนโยบายความเป็นส่วนตัว
          และยินยอมให้บริษัทเก็บและใช้ข้อมูลส่วนบุคคลตามวัตถุประสงค์ที่ระบุไว้
        </p>
      </div>

      {/* ── ลายเซ็น ────────────────────────────────────────────────────── */}
      <div className="rcdoc-signs">
        <div className="rcdoc-sign">
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
          <div className="rcdoc-sign-name">( {d.fullNameTh || ".............................."} )</div>
          <div className="rcdoc-sign-date">วันที่ {d.submittedAtText}</div>
        </div>
        <div className="rcdoc-sign">
          <div className="rcdoc-sign-space" />
          <div className="rcdoc-sign-line" />
          <div className="rcdoc-sign-role">ผู้รับสมัคร / ฝ่ายบุคคล</div>
          <div className="rcdoc-sign-name">( .............................. )</div>
          <div className="rcdoc-sign-date">วันที่ ......./......./.........</div>
        </div>
      </div>

      <div className="rcdoc-foot">
        เอกสารนี้สร้างจากระบบรับพนักงานใหม่ออนไลน์ · {d.companyName} · พิมพ์เมื่อ {d.submittedAtText}
      </div>

      <style jsx>{`
        /* โทนเอกสารชุดเดียวกับสัญญาเช่า RentSpace (rsdoc): พื้นขาว ตัวอักษรดำเข้ม
           เส้นบาง #ddd กล่องมุมมน 8px หัวเอกสารจัดกลาง */
        .rcdoc {
          background: #fff;
          color: #111;
          padding: 26px 30px 30px;
          font-size: 13px;
          line-height: 1.6;
          width: 100%;
        }
        .rcdoc-head {
          display: flex;
          align-items: flex-start;
          gap: 14px;
        }
        .rcdoc-head-logo :global(img) {
          height: 46px;
          width: auto;
          display: block;
        }
        .rcdoc-head-mid {
          flex: 1;
          text-align: center;
        }
        .rcdoc-h1 {
          font-size: 21px;
          font-weight: 800;
          letter-spacing: 0.5px;
          line-height: 1.2;
        }
        .rcdoc-h1-en {
          font-size: 10.5px;
          font-weight: 700;
          color: #777;
          letter-spacing: 1.2px;
          margin-top: 1px;
        }
        .rcdoc-company {
          font-size: 12.5px;
          color: #444;
          margin-top: 3px;
          font-weight: 600;
        }
        .rcdoc-photo {
          width: 76px;
          height: 96px;
          border: 1px dashed #bbb;
          border-radius: 6px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1px;
          font-size: 10px;
          color: #999;
          flex-shrink: 0;
        }
        .rcdoc-photo-sub {
          font-size: 9px;
        }
        .rcdoc-rule {
          border-top: 2px solid #111;
          margin: 10px 0 4px;
        }

        .rcdoc-sechead {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 12.5px;
          font-weight: 800;
          color: #111;
          margin: 13px 0 5px;
        }
        .rcdoc-secno {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 17px;
          height: 17px;
          border-radius: 4px;
          background: #111;
          color: #fff;
          font-size: 10.5px;
          font-weight: 800;
          flex-shrink: 0;
        }

        .rcdoc-row {
          display: flex;
          gap: 18px;
          margin-bottom: 7px;
        }
        .rcdoc-field {
          min-width: 0;
        }
        .rcdoc-label {
          display: block;
          font-size: 10.5px;
          color: #777;
          line-height: 1.3;
        }
        /* เส้นไข่ปลา + ค่าที่กรอกวางอยู่บนเส้น (เหมือนใบสมัครกระดาษ) */
        .rcdoc-dots {
          display: block;
          border-bottom: 1px dotted #888;
          min-height: 19px;
          padding: 1px 2px 1px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .rcdoc-filled {
          font-size: 13px;
          font-weight: 600;
          color: #111;
        }

        .rcdoc-table {
          width: 100%;
          border-collapse: collapse;
          margin: 3px 0 7px;
          font-size: 11.5px;
        }
        .rcdoc-table th {
          background: #f4f4f5;
          border: 1px solid #ddd;
          padding: 4px 6px;
          text-align: left;
          font-weight: 700;
          color: #444;
          font-size: 10.5px;
        }
        .rcdoc-table td {
          border: 1px solid #ddd;
          padding: 4px 6px;
          vertical-align: top;
        }

        .rcdoc-attach {
          display: flex;
          flex-wrap: wrap;
          gap: 6px 16px;
          font-size: 12px;
          color: #222;
          padding: 2px 0 2px;
        }
        .rcdoc-attach-item {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .rcdoc-tick {
          color: #16a34a;
          font-weight: 800;
        }
        .rcdoc-attach-empty {
          color: #888;
        }

        .rcdoc-declare {
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 9px 12px;
          font-size: 12px;
          line-height: 1.65;
          color: #222;
        }
        .rcdoc-declare p {
          margin: 0 0 5px;
        }
        .rcdoc-declare p:last-child {
          margin-bottom: 0;
        }

        .rcdoc-signs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 40px;
          margin-top: 26px;
        }
        .rcdoc-sign {
          text-align: center;
        }
        .rcdoc-sign-space {
          height: 44px;
        }
        .rcdoc-sign-img {
          height: 44px;
          display: flex;
          align-items: flex-end;
          justify-content: center;
        }
        .rcdoc-sign-img :global(img) {
          max-height: 44px;
          max-width: 180px;
        }
        .rcdoc-sign-line {
          border-top: 1px solid #333;
          margin: 0 12px;
        }
        .rcdoc-sign-role {
          font-size: 11px;
          color: #666;
          margin-top: 3px;
        }
        .rcdoc-sign-name {
          font-size: 12.5px;
          margin-top: 1px;
        }
        .rcdoc-sign-date {
          font-size: 11px;
          color: #666;
          margin-top: 1px;
        }

        .rcdoc-foot {
          margin-top: 20px;
          padding-top: 7px;
          border-top: 1px dashed #ccc;
          font-size: 10px;
          color: #999;
          text-align: center;
        }

        /* มือถือ: แถวหลายช่องซ้อนเป็นแนวตั้ง ไม่งั้นเส้นไข่ปลาสั้นจนอ่านไม่ออก */
        @media (max-width: 640px) {
          .rcdoc {
            padding: 18px 16px 22px;
          }
          .rcdoc-row {
            flex-direction: column;
            gap: 7px;
          }
          .rcdoc-signs {
            grid-template-columns: 1fr;
            gap: 26px;
          }
          .rcdoc-photo {
            width: 62px;
            height: 78px;
          }
        }

        /* พิมพ์: A4 พอดีหน้า · ไม่ตัดกลางหัวข้อ/ตาราง/ช่องเซ็น */
        @media print {
          .rcdoc {
            padding: 0;
            font-size: 11.5px;
            line-height: 1.5;
          }
          .rcdoc,
          .rcdoc * {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .rcdoc-row,
          .rcdoc-table,
          .rcdoc-declare,
          .rcdoc-signs,
          .rcdoc-attach {
            break-inside: avoid;
          }
          .rcdoc-sechead {
            break-after: avoid;
          }
        }
      `}</style>
    </div>
  );
}
