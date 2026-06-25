"use client";

// RentSpace — live A4 preview of a contract document. Renders the filled body
// (template/custom HTML) from the current form values so admins SEE the contract
// update as they type. Pure-render: takes plain values, no data fetching.
import { useMemo } from "react";
import { contractPlaceholders, fillPlaceholders, LAND_TAX_CLAUSE } from "@/lib/rentspace/contract-doc";

export type ContractPreviewValues = {
  tenantName: string;
  unitCode: string;
  unitName?: string | null;
  rentAmountThb: number;
  depositAmountThb: number;
  depositMonths?: number;
  rentDueDay?: number;
  startDate: string; // ISO yyyy-mm-dd
  endDate?: string | null;
  vatPercent?: number;
};

export type ContractPreviewProject = {
  name: string;
  billCompanyName?: string | null;
  address?: string | null;
  bankName?: string | null;
  bankAccountNo?: string | null;
  bankAccountHolder?: string | null;
  promptpayId?: string | null;
  paymentNote?: string | null;
};

function baht(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function thaiDateLong(iso?: string | null): string {
  if (!iso) return "ไม่มีกำหนด";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" });
}

/** Build a ContractLike-shaped object so we can reuse the shared placeholder logic. */
function toPlaceholders(values: ContractPreviewValues, project: ContractPreviewProject) {
  return contractPlaceholders({
    rentAmountThb: values.rentAmountThb,
    depositAmountThb: values.depositAmountThb,
    depositMonths: values.depositMonths ?? 0,
    rentDueDay: values.rentDueDay ?? null,
    startDate: values.startDate || new Date().toISOString().slice(0, 10),
    endDate: values.endDate || null,
    unit: { code: values.unitCode || "—", name: values.unitName ?? null },
    // tenantDisplayName accepts a {firstName/bizName/...}; we already have the display string,
    // so pass it through as bizName which the helper surfaces verbatim.
    tenant: { bizName: values.tenantName || "ผู้เช่า" } as never,
    project,
  });
}

export function ContractPreview({
  values,
  project,
  bodyHtml,
}: {
  values: ContractPreviewValues;
  project: ContractPreviewProject;
  /** template / custom-terms HTML; when empty we render the standard clause set. */
  bodyHtml?: string | null;
}) {
  const ph = useMemo(() => toPlaceholders(values, project), [values, project]);
  const filledBody = useMemo(
    () => (bodyHtml && bodyHtml.trim() ? fillPlaceholders(bodyHtml, ph) : ""),
    [bodyHtml, ph],
  );

  const landlord = project.billCompanyName?.trim() || project.name;
  const rent = values.rentAmountThb || 0;
  const deposit = values.depositAmountThb || 0;
  const vat = values.vatPercent || 0;
  const hasBank =
    !!(project.bankName || project.bankAccountNo || project.bankAccountHolder || project.promptpayId);

  return (
    <div id="rs-contract-preview" className="rs-pv-a4">
      {/* title */}
      <div className="rs-pv-title">
        <div className="rs-pv-h1">สัญญาเช่าพื้นที่</div>
        <div className="rs-pv-sub">{project.name}</div>
        <div className="rs-pv-sub">ทำ ณ วันที่ {ph.today}</div>
      </div>

      {/* parties */}
      <div className="rs-pv-parties">
        <div className="rs-pv-party">
          <div className="rs-pv-party-h">ผู้ให้เช่า</div>
          <div className="rs-pv-party-name">{landlord}</div>
          {project.address && <div className="rs-pv-party-line">{project.address}</div>}
        </div>
        <div className="rs-pv-party">
          <div className="rs-pv-party-h">ผู้เช่า</div>
          <div className="rs-pv-party-name">{ph.tenantName}</div>
          <div className="rs-pv-party-line">ห้อง {ph.unitCode}</div>
        </div>
      </div>

      <p className="rs-pv-intro">
        คู่สัญญาทั้งสองฝ่ายตกลงทำสัญญาเช่าพื้นที่ตามข้อกำหนดและเงื่อนไขดังต่อไปนี้
      </p>

      {/* body — filled template/custom HTML, else the standard clause set */}
      {filledBody ? (
        // มาจากแม่แบบที่ผู้ดูแลสร้างเอง (พรีวิวเท่านั้น)
        <div className="rs-pv-custom" dangerouslySetInnerHTML={{ __html: filledBody }} />
      ) : (
        <ol className="rs-pv-clauses">
          <li>
            <b>ห้อง / วัตถุประสงค์การเช่า</b> — ผู้ให้เช่าตกลงให้เช่าพื้นที่ห้อง {ph.unitCode} ภายใน{" "}
            {project.name} เพื่อใช้ประกอบกิจการของผู้เช่า
          </li>
          <li>
            <b>ค่าเช่า เงินประกัน</b> — ค่าเช่าเดือนละ {baht(rent)} บาท
            {vat > 0 ? ` (รวมภาษีมูลค่าเพิ่ม ${vat}%)` : ""} ผู้เช่าวางเงินประกันจำนวน {baht(deposit)} บาท
            {values.depositMonths ? ` (เทียบเท่า ${values.depositMonths} เดือน)` : ""}
            {" "}ซึ่งผู้ให้เช่าจะคืนเมื่อสิ้นสุดสัญญาหลังหักค่าเสียหาย (ถ้ามี)
          </li>
          <li>
            <b>ระยะเวลาและการชำระเงิน</b> — สัญญานี้มีกำหนดตั้งแต่ {thaiDateLong(values.startDate)} ถึง{" "}
            {thaiDateLong(values.endDate)} ผู้เช่าตกลงชำระค่าเช่าภายในวันที่ {ph.rentDueDay} ของทุกเดือน
          </li>
          <li>
            <b>ภาษีและค่าส่วนกลาง</b> — {LAND_TAX_CLAUSE}
          </li>
        </ol>
      )}

      {/* payment / bank block */}
      {(hasBank || project.paymentNote) && (
        <div className="rs-pv-pay">
          <div className="rs-pv-pay-h">ช่องทางชำระเงิน</div>
          {hasBank && (
            <div className="rs-pv-pay-line">
              {ph.bankInfo}
              {project.promptpayId ? `${ph.bankInfo ? " · " : ""}พร้อมเพย์ ${project.promptpayId}` : ""}
            </div>
          )}
          {project.paymentNote && <div className="rs-pv-pay-note">{project.paymentNote}</div>}
        </div>
      )}

      {/* signatures */}
      <div className="rs-pv-signs">
        <div className="rs-pv-sign">
          <div className="rs-pv-sign-space" />
          <div className="rs-pv-sign-line" />
          <div className="rs-pv-sign-role">ผู้ให้เช่า</div>
          <div className="rs-pv-sign-name">( {landlord} )</div>
        </div>
        <div className="rs-pv-sign">
          <div className="rs-pv-sign-space" />
          <div className="rs-pv-sign-line" />
          <div className="rs-pv-sign-role">ผู้เช่า</div>
          <div className="rs-pv-sign-name">( {ph.tenantName} )</div>
        </div>
      </div>

      <style jsx>{`
        .rs-pv-a4 {
          background: #fff;
          color: #111;
          padding: 28px 30px 34px;
          font-size: 13.5px;
          line-height: 1.7;
          /* on a phone the pane scales to fit its container width */
          width: 100%;
        }
        .rs-pv-title {
          text-align: center;
          margin-bottom: 18px;
        }
        .rs-pv-h1 {
          font-size: 20px;
          font-weight: 800;
          letter-spacing: 0.5px;
        }
        .rs-pv-sub {
          font-size: 12px;
          color: #555;
          margin-top: 2px;
        }
        .rs-pv-parties {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
          margin-bottom: 14px;
        }
        .rs-pv-party {
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 10px 12px;
        }
        .rs-pv-party-h {
          font-size: 11px;
          font-weight: 700;
          color: #777;
          margin-bottom: 3px;
        }
        .rs-pv-party-name {
          font-size: 14.5px;
          font-weight: 700;
        }
        .rs-pv-party-line {
          font-size: 12px;
          color: #444;
          margin-top: 1px;
        }
        .rs-pv-intro {
          margin: 12px 0 8px;
        }
        .rs-pv-clauses {
          padding-left: 20px;
          margin: 0;
        }
        .rs-pv-clauses > li {
          margin-bottom: 10px;
          text-align: justify;
        }
        .rs-pv-custom {
          margin: 8px 0;
        }
        .rs-pv-pay {
          margin-top: 16px;
          padding: 10px 12px;
          border: 1px dashed #ccc;
          border-radius: 8px;
          background: #fafafa;
        }
        .rs-pv-pay-h {
          font-size: 11px;
          font-weight: 700;
          color: #777;
          margin-bottom: 3px;
        }
        .rs-pv-pay-line {
          font-size: 12.5px;
          color: #222;
          font-weight: 600;
        }
        .rs-pv-pay-note {
          font-size: 12px;
          color: #555;
          margin-top: 2px;
        }
        .rs-pv-signs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 36px;
          margin-top: 40px;
        }
        .rs-pv-sign {
          text-align: center;
        }
        .rs-pv-sign-space {
          height: 40px;
        }
        .rs-pv-sign-line {
          border-top: 1px solid #333;
          margin: 0 10px;
        }
        .rs-pv-sign-role {
          font-size: 12.5px;
          font-weight: 600;
          margin-top: 6px;
        }
        .rs-pv-sign-name {
          font-size: 12px;
          color: #444;
          margin-top: 2px;
        }
        @media (max-width: 640px) {
          .rs-pv-a4 {
            padding: 18px 16px 24px;
          }
          .rs-pv-parties {
            grid-template-columns: 1fr;
            gap: 8px;
          }
          .rs-pv-signs {
            grid-template-columns: 1fr;
            gap: 24px;
            margin-top: 28px;
          }
        }
      `}</style>
    </div>
  );
}
