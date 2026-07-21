"use client";

// RentSpace — เอกสารสัญญาเช่าฉบับเต็ม (ใช้ร่วมกันทุกที่: พรีวิวใน wizard · เอกสาร A4
// หน้ารายละเอียด · หน้าเซ็นออนไลน์). รับ ContractDocData แล้วเรนเดอร์เอกสารเดียวกัน
// เป๊ะทุกที่ → CEO เห็น "ไปทางเดียวกัน" จริง (RULE I). Pure render ไม่มี data fetching.
import { LAND_TAX_CLAUSE, type ContractDocData } from "@/lib/rentspace/contract-doc";
import { formatBaht, thaiDateLong, periodLabel } from "@/lib/rentspace/format";

function baht(n: number): string {
  return formatBaht(n);
}

/** วันที่แบบปลอดภัย — null/ว่าง = "—" (ในพรีวิวช่วงยังไม่กรอก) */
function fmtDate(v?: Date | string | null): string {
  return v ? thaiDateLong(v) : "—";
}

/** งวดสุดท้ายของโปร = งวดเริ่ม + (months-1) */
function addPeriods(period: string, add: number): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  const d = new Date(y, m - 1 + add, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function promoRangeLabel(startPeriod: string | null | undefined, months: number): string {
  if (!startPeriod || months <= 0) return "";
  const end = addPeriods(startPeriod, months - 1);
  return months === 1 ? periodLabel(startPeriod) : `${periodLabel(startPeriod)} – ${periodLabel(end)}`;
}

export function RentalContractDocument({
  data,
  /** ใส่ id ให้ root (หน้า detail ใช้ "rs-contract" สำหรับ CSS พิมพ์) */
  printId,
  className,
}: {
  data: ContractDocData;
  printId?: string;
  className?: string;
}) {
  const d = data;
  const rent = d.rentAmountThb || 0;
  const deposit = d.depositAmountThb || 0;
  const vat = d.vatPercent || 0;
  const hasTenant = !!d.tenantName.trim();
  const tenantName = hasTenant ? d.tenantName : "(ยังไม่ได้เลือกผู้เช่า)";
  const promoTotal = d.promo ? d.promo.perMonth * d.promo.months : 0;
  const hasPayment = !!(d.bankLine || d.promptpayId || d.paymentNote);
  const unitLabel = d.unitName ? `${d.unitCode} (${d.unitName})` : d.unitCode;
  const lateFeeText = d.lateFee
    ? d.lateFee.type === "fixed"
      ? `ค่าปรับคงที่ ${baht(d.lateFee.value)} บาท`
      : d.lateFee.type === "percent_total"
        ? `ค่าปรับ ${d.lateFee.value}% ของยอดค้างชำระ`
        : `ค่าปรับ ${baht(d.lateFee.value)} บาท/วัน`
    : "";

  // เอกสารแนบมาตรฐาน + ที่แนบเพิ่ม
  const attachLines = [
    "สำเนาบัตรประชาชน / ทะเบียนพาณิชย์ของผู้เช่า",
    ...(d.rentSchedule && d.rentSchedule.length > 0 ? ["ตารางปรับค่าเช่ารายงวด (แนบท้าย)"] : []),
    ...(d.attachments ?? []),
  ];

  return (
    <div id={printId} className={`rsdoc ${className ?? ""}`}>
      {d.fullDocument && d.customBodyHtml ? (
        <>
          <div className="rsdoc-custom" dangerouslySetInnerHTML={{ __html: d.customBodyHtml }} />
          {d.signature?.signed && d.signature.dataUrl ? (
            <div style={{ marginTop: 14, textAlign: "center" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={d.signature.dataUrl} alt="ลายเซ็นผู้เช่า" style={{ maxHeight: 70, maxWidth: 200 }} />
              <div style={{ fontSize: "11.5px", color: "#16a34a", marginTop: 2 }}>
                ลงนามออนไลน์แล้ว{d.signature.signedAt ? ` · ${thaiDateLong(d.signature.signedAt)}` : ""}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <>
      {/* หัวเอกสาร */}
      <div className="rsdoc-title">
        <div className="rsdoc-h1">สัญญาเช่าพื้นที่</div>
        <div className="rsdoc-sub">
          {d.projectName}
          {d.contractNo ? ` · เลขที่สัญญา ${d.contractNo}` : ""}
        </div>
        <div className="rsdoc-sub">ทำ ณ วันที่ {thaiDateLong(d.madeOn ?? new Date())}</div>
      </div>

      {/* คู่สัญญา */}
      <div className="rsdoc-parties">
        <div className="rsdoc-party">
          <div className="rsdoc-party-h">ผู้ให้เช่า (เจ้าของพื้นที่)</div>
          <div className="rsdoc-party-name">{d.lessorName}</div>
          <div className="rsdoc-party-line">{d.projectName}</div>
          {d.lessorTaxId && <div className="rsdoc-party-line">เลขผู้เสียภาษี: {d.lessorTaxId}</div>}
          {d.lessorAddress && <div className="rsdoc-party-line">{d.lessorAddress}</div>}
        </div>
        <div className="rsdoc-party">
          <div className="rsdoc-party-h">ผู้เช่า</div>
          <div className="rsdoc-party-name" style={hasTenant ? undefined : { color: "#777", fontWeight: 500 }}>
            {tenantName}
          </div>
          <div className="rsdoc-party-line">ห้อง {unitLabel}</div>
          {(d.tenantTaxId || d.tenantIdMasked) && (
            <div className="rsdoc-party-line">เลขผู้เสียภาษี/บัตร: {d.tenantTaxId || d.tenantIdMasked}</div>
          )}
          {d.tenantAddress && <div className="rsdoc-party-line">{d.tenantAddress}</div>}
          {d.tenantPhone && <div className="rsdoc-party-line">โทร: {d.tenantPhone}</div>}
          {d.tenantSignerName && <div className="rsdoc-party-line">ผู้มีอำนาจลงนาม: {d.tenantSignerName}</div>}
        </div>
      </div>

      <p className="rsdoc-intro">
        คู่สัญญาทั้งสองฝ่ายตกลงทำสัญญาเช่าพื้นที่ตามข้อกำหนดและเงื่อนไขดังต่อไปนี้
      </p>

      {/* เนื้อสัญญา: แม่แบบที่กำหนดเอง (ถ้ามี) แทนที่ข้อมาตรฐาน */}
      {d.customBodyHtml ? (
        <div className="rsdoc-custom" dangerouslySetInnerHTML={{ __html: d.customBodyHtml }} />
      ) : (
        <ol className="rsdoc-clauses">
          <li>
            <b>พื้นที่และวัตถุประสงค์การเช่า</b> — ผู้ให้เช่าตกลงให้เช่าพื้นที่ห้อง {unitLabel} ภายในโครงการ{" "}
            {d.projectName} เพื่อใช้ประกอบกิจการของผู้เช่าตามที่ได้แจ้งไว้ ผู้เช่าจะไม่ดัดแปลงต่อเติมโครงสร้าง
            หรือนำพื้นที่ไปให้ผู้อื่นเช่าช่วง โดยไม่ได้รับความยินยอมเป็นลายลักษณ์อักษรจากผู้ให้เช่าก่อน
          </li>
          <li>
            <b>ระยะเวลาการเช่า</b> — สัญญานี้มีกำหนดตั้งแต่ {fmtDate(d.startDate)}{" "}
            {d.endDate ? `ถึง ${thaiDateLong(d.endDate)}` : "โดยไม่มีกำหนดสิ้นสุด จนกว่าฝ่ายใดฝ่ายหนึ่งจะบอกเลิกสัญญา"}
            {d.endDate ? " เมื่อครบกำหนดคู่สัญญาอาจตกลงต่ออายุสัญญาเป็นลายลักษณ์อักษร" : ""}
          </li>
          <li>
            <b>ค่าเช่าและการชำระเงิน</b> — ผู้เช่าตกลงชำระค่าเช่าเดือนละ {baht(rent)} บาท
            {vat > 0 ? ` (รวมภาษีมูลค่าเพิ่ม ${vat}%)` : ""} ภายในวันที่ {d.rentDueDay ?? 5} ของทุกเดือน
            {lateFeeText
              ? ` หากชำระล่าช้าเกิน ${d.lateFee?.graceDays ?? 0} วัน ผู้เช่ายินยอมให้คิด${lateFeeText}`
              : ""}
          </li>
          {d.promo && (
            <li>
              <b>ส่วนลดค่าเช่า</b> — ผู้ให้เช่าตกลงให้ส่วนลดค่าเช่าจำนวน {baht(d.promo.perMonth)} บาทต่อเดือน
              เป็นเวลา {d.promo.months} เดือน
              {promoRangeLabel(d.promo.startPeriod, d.promo.months)
                ? ` (${promoRangeLabel(d.promo.startPeriod, d.promo.months)})`
                : ""}{" "}
              รวมเป็นเงินส่วนลดทั้งสิ้น {baht(promoTotal)} บาท โดยส่วนลดนี้เป็นสิทธิเฉพาะตัวและสิ้นสุดตามกำหนด
            </li>
          )}
          <li>
            <b>เงินประกัน</b> — ผู้เช่าวางเงินประกันจำนวน {baht(deposit)} บาท
            {d.depositMonths ? ` (เทียบเท่าค่าเช่า ${d.depositMonths} เดือน)` : ""} ซึ่งผู้ให้เช่าจะคืนให้เมื่อ
            สิ้นสุดสัญญาและส่งมอบพื้นที่คืนในสภาพเรียบร้อย หลังหักค่าเสียหายและค่าใช้จ่ายค้างชำระ (ถ้ามี)
          </li>
          <li>
            <b>ค่าน้ำ–ค่าไฟและสาธารณูปโภค</b> — ผู้เช่าเป็นผู้รับผิดชอบค่าน้ำและค่าไฟฟ้าตามที่ใช้จริง โดยคิดอัตรา
            ค่าไฟหน่วยละ {baht(d.electricRate ?? 0)} บาท และค่าน้ำหน่วยละ {baht(d.waterRate ?? 0)} บาท
            ตามที่จดมิเตอร์ในแต่ละงวด รวมถึงค่าสาธารณูปโภคอื่นตามที่ใช้จริง
          </li>
          {d.rentSchedule && d.rentSchedule.length > 0 && (
            <li>
              <b>การปรับค่าเช่าตามงวด</b> — คู่สัญญาตกลงให้ปรับค่าเช่าตามตารางดังนี้:{" "}
              {d.rentSchedule.map((s, i) => (
                <span key={i}>
                  {i > 0 ? " · " : ""}
                  ตั้งแต่ {periodLabel(s.fromPeriod)} เดือนละ {baht(s.amount)} บาท
                </span>
              ))}
            </li>
          )}
          <li>
            <b>หน้าที่และการดูแลพื้นที่</b> — ผู้เช่าต้องดูแลรักษาพื้นที่เช่าให้อยู่ในสภาพดี ใช้พื้นที่ด้วยความ
            ระมัดระวัง รับผิดชอบความเสียหายที่เกิดจากการใช้งานของตนหรือบริวาร และปฏิบัติตามระเบียบและประกาศ
            ของโครงการโดยเคร่งครัด
          </li>
          <li>
            <b>การผิดนัดและการบอกเลิกสัญญา</b> — หากผู้เช่าผิดนัดชำระค่าเช่าหรือผิดเงื่อนไขสำคัญข้อใดข้อหนึ่ง
            และไม่แก้ไขภายในกำหนดเวลาที่ผู้ให้เช่าแจ้งเป็นหนังสือ ผู้ให้เช่ามีสิทธิบอกเลิกสัญญาได้ทันที และผู้เช่า
            ต้องขนย้ายทรัพย์สินและส่งมอบพื้นที่คืนในสภาพเรียบร้อย
          </li>
          <li>
            <b>การบอกเลิกก่อนกำหนดและการคืนเงินประกัน</b> — หากฝ่ายใดประสงค์บอกเลิกสัญญาก่อนครบกำหนด ต้องแจ้ง
            อีกฝ่ายเป็นหนังสือล่วงหน้าไม่น้อยกว่า 30 วัน ผู้ให้เช่าจะคืนเงินประกันให้ภายใน 30 วันนับจากวันที่ผู้เช่า
            ส่งมอบพื้นที่คืนในสภาพเรียบร้อย หลังหักค่าเสียหายและค่าใช้จ่ายค้างชำระ (ถ้ามี) ทั้งนี้หากผู้เช่าย้ายออก
            ก่อนกำหนดโดยไม่แจ้งล่วงหน้าตามที่กำหนด ผู้ให้เช่ามีสิทธิริบเงินประกันได้
          </li>
          <li>
            <b>ภาษีและค่าส่วนกลาง</b> — {LAND_TAX_CLAUSE}
          </li>
          <li>
            <b>กฎหมายที่ใช้บังคับ</b> — สัญญานี้อยู่ภายใต้บังคับและการตีความตามกฎหมายแห่งราชอาณาจักรไทย
            หากมีข้อพิพาทเกิดขึ้นคู่สัญญาตกลงให้อยู่ในเขตอำนาจของศาลไทย
          </li>
          <li>
            <b>ข้อตกลงเบ็ดเตล็ด</b> — สัญญานี้ทำขึ้นเป็นสองฉบับมีข้อความถูกต้องตรงกัน คู่สัญญาได้อ่านและเข้าใจ
            ข้อความโดยตลอดแล้วจึงลงลายมือชื่อไว้เป็นสำคัญ การแก้ไขเปลี่ยนแปลงใด ๆ ต้องทำเป็นลายลักษณ์อักษรและ
            ลงนามโดยคู่สัญญาทั้งสองฝ่าย
          </li>
        </ol>
      )}

      {/* ช่องทางชำระเงิน */}
      {hasPayment && (
        <div className="rsdoc-pay">
          <div className="rsdoc-pay-h">ช่องทางชำระเงิน</div>
          {(d.bankLine || d.promptpayId) && (
            <div className="rsdoc-pay-line">
              {d.bankLine}
              {d.promptpayId ? `${d.bankLine ? " · " : ""}พร้อมเพย์ ${d.promptpayId}` : ""}
            </div>
          )}
          {d.paymentNote && <div className="rsdoc-pay-note">{d.paymentNote}</div>}
        </div>
      )}

      {/* เอกสารแนบ */}
      <div className="rsdoc-attach">
        <span className="rsdoc-attach-h">เอกสารแนบท้ายสัญญา:</span>{" "}
        {attachLines.join(" · ")}
      </div>

      {/* ลายเซ็น (ผู้ให้เช่า · ผู้เช่า · พยาน 2 คน) */}
      <div className="rsdoc-signs">
        <div className="rsdoc-sign">
          <div className="rsdoc-sign-space" />
          <div className="rsdoc-sign-line" />
          <div className="rsdoc-sign-role">ผู้ให้เช่า</div>
          <div className="rsdoc-sign-name">( {d.lessorName} )</div>
          <div className="rsdoc-sign-name" style={{ marginTop: 4 }}>วันที่ ..........................</div>
        </div>
        <div className="rsdoc-sign">
          {d.signature?.signed && d.signature.dataUrl ? (
            <div className="rsdoc-sign-img">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={d.signature.dataUrl} alt="ลายเซ็นผู้เช่า" />
            </div>
          ) : (
            <div className="rsdoc-sign-space" />
          )}
          <div className="rsdoc-sign-line" />
          <div className="rsdoc-sign-role">ผู้เช่า</div>
          <div className="rsdoc-sign-name">
            ( {d.signature?.signed ? d.signature.signerName ?? d.tenantSignerName ?? tenantName : d.tenantSignerName || tenantName} )
          </div>
          {d.signature?.signed && (
            <div className="rsdoc-sign-stamp">
              ลงนามออนไลน์แล้ว{d.signature.signedAt ? ` · ${thaiDateLong(d.signature.signedAt)}` : ""}
            </div>
          )}
        </div>
        <div className="rsdoc-sign">
          <div className="rsdoc-sign-space" />
          <div className="rsdoc-sign-line" />
          <div className="rsdoc-sign-role">พยาน</div>
          <div className="rsdoc-sign-name">( .......................... )</div>
        </div>
        <div className="rsdoc-sign">
          <div className="rsdoc-sign-space" />
          <div className="rsdoc-sign-line" />
          <div className="rsdoc-sign-role">พยาน</div>
          <div className="rsdoc-sign-name">( {d.witness2Name?.trim() ? d.witness2Name : ".........................."} )</div>
        </div>
      </div>
        </>
      )}

      <style jsx>{`
        .rsdoc {
          background: #fff;
          color: #111;
          padding: 28px 32px 36px;
          font-size: 14px;
          line-height: 1.75;
          width: 100%;
        }
        .rsdoc-title {
          text-align: center;
          margin-bottom: 22px;
        }
        .rsdoc-h1 {
          font-size: 22px;
          font-weight: 800;
          letter-spacing: 0.5px;
        }
        .rsdoc-sub {
          font-size: 12.5px;
          color: #555;
          margin-top: 2px;
        }
        .rsdoc-parties {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          margin-bottom: 16px;
        }
        .rsdoc-party {
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 12px 14px;
        }
        .rsdoc-party-h {
          font-size: 11.5px;
          font-weight: 700;
          color: #777;
          margin-bottom: 4px;
        }
        .rsdoc-party-name {
          font-size: 15px;
          font-weight: 700;
        }
        .rsdoc-party-line {
          font-size: 12.5px;
          color: #444;
          margin-top: 1px;
        }
        .rsdoc-intro {
          margin: 14px 0 8px;
        }
        .rsdoc-clauses {
          padding-left: 22px;
          margin: 0;
          counter-reset: none;
        }
        .rsdoc-clauses > li {
          margin-bottom: 11px;
          text-align: justify;
        }
        .rsdoc-custom {
          margin: 8px 0;
        }
        .rsdoc-pay {
          margin-top: 16px;
          padding: 10px 14px;
          border: 1px dashed #ccc;
          border-radius: 8px;
          background: #fafafa;
        }
        .rsdoc-pay-h {
          font-size: 11.5px;
          font-weight: 700;
          color: #777;
          margin-bottom: 3px;
        }
        .rsdoc-pay-line {
          font-size: 13px;
          color: #222;
          font-weight: 600;
        }
        .rsdoc-pay-note {
          font-size: 12.5px;
          color: #555;
          margin-top: 2px;
        }
        .rsdoc-attach {
          margin-top: 18px;
          padding-top: 12px;
          border-top: 1px dashed #ccc;
          font-size: 12.5px;
          color: #555;
        }
        .rsdoc-attach-h {
          font-weight: 700;
          color: #444;
        }
        .rsdoc-signs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 40px;
          margin-top: 44px;
        }
        .rsdoc-sign {
          text-align: center;
        }
        .rsdoc-sign-space {
          height: 48px;
        }
        .rsdoc-sign-img {
          height: 48px;
          display: flex;
          align-items: flex-end;
          justify-content: center;
        }
        .rsdoc-sign-img :global(img) {
          max-height: 48px;
          max-width: 180px;
        }
        .rsdoc-sign-line {
          border-top: 1px solid #333;
          margin: 0 12px;
        }
        .rsdoc-sign-role {
          font-size: 13px;
          font-weight: 600;
          margin-top: 6px;
        }
        .rsdoc-sign-name {
          font-size: 12.5px;
          color: #444;
          margin-top: 2px;
        }
        .rsdoc-sign-stamp {
          font-size: 11.5px;
          color: #16a34a;
          margin-top: 4px;
          font-weight: 600;
        }
        @media (max-width: 640px) {
          .rsdoc {
            padding: 18px 16px 24px;
          }
          .rsdoc-parties {
            grid-template-columns: 1fr;
            gap: 10px;
          }
          .rsdoc-signs {
            grid-template-columns: 1fr;
            gap: 28px;
            margin-top: 32px;
          }
        }
        /* พิมพ์ฉบับเต็ม — กันตัดขวางกลางข้อสัญญา/กล่องคู่สัญญา/ช่องลายเซ็น */
        @media print {
          .rsdoc {
            padding: 0;
            font-size: 12.5px;
            line-height: 1.6;
          }
          /* ให้เส้นประ/พื้นหลังจาง/ตราเซ็นออนไลน์ พิมพ์ติดกระดาษจริง */
          .rsdoc,
          .rsdoc * {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .rsdoc-party,
          .rsdoc-pay,
          .rsdoc-attach,
          .rsdoc-signs {
            break-inside: avoid;
          }
          .rsdoc-clauses > li,
          .rsdoc-custom > p,
          .rsdoc-custom > li,
          .rsdoc-custom > div {
            break-inside: avoid;
          }
          /* กันหัวเอกสาร/อารัมภบท ตกค้างท้ายหน้า */
          .rsdoc-title,
          .rsdoc-intro {
            break-after: avoid;
          }
          /* กันบล็อกลายเซ็นโดดเดี่ยวขึ้นหน้าใหม่ทันทีหลังเอกสารแนบ */
          .rsdoc-attach {
            break-after: avoid;
          }
          .rsdoc-signs {
            margin-top: 32px;
          }
          /* ลายเซ็นที่วาดสูงไม่ให้ถูกครอปตอนพิมพ์ */
          .rsdoc-sign-img {
            height: auto;
          }
          .rsdoc-sign-img :global(img) {
            max-height: 70px;
          }
        }
      `}</style>
    </div>
  );
}
