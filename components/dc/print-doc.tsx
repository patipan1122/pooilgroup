// DC · เอกสารพิมพ์กลาง (ใช้ซ้ำทุกใบ: PO / รับสินค้า / โอน / เบิก / ย้าย).
// presentational ล้วน (server component ได้) — หน้า print route โหลดข้อมูลแล้วส่ง props มา.
// พิมพ์ด้วย window.print() (ปุ่ม <PrintButton>) → @media print ซ่อนทุกอย่างเหลือเฉพาะเอกสารนี้.
//
// ดีไซน์: เอกสารทางการขาว-ดำ อ่านง่าย · หัวบริษัท+โลโก้ · ตารางมีเส้น · ยอดรวมชิดขวา · ช่องเซ็น 3 ช่อง.

import type { ReactNode } from "react";

export type PrintMetaItem = { label: string; value: ReactNode };
export type PrintColumn = {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  width?: string;
};
export type PrintRow = { key: string; cells: Record<string, ReactNode> };
export type PrintTotal = { label: string; value: ReactNode; strong?: boolean };
export type PrintSign = { role: string; name?: string };

export function DcPrintDoc({
  org,
  docTitle,
  docTitleEn,
  code,
  headerRight,
  metaLeft = [],
  metaRight = [],
  columns,
  rows,
  totals = [],
  note,
  signatures = [
    { role: "ผู้จัดทำ" },
    { role: "ผู้อนุมัติ" },
    { role: "ผู้รับ/ผู้ส่ง" },
  ],
}: {
  org: { name: string; logoUrl: string | null };
  docTitle: string;
  docTitleEn?: string;
  code: string;
  /** ข้อมูลมุมขวาบน (วันที่/สถานะ) */
  headerRight?: PrintMetaItem[];
  metaLeft?: PrintMetaItem[];
  metaRight?: PrintMetaItem[];
  columns: PrintColumn[];
  rows: PrintRow[];
  totals?: PrintTotal[];
  note?: string | null;
  signatures?: PrintSign[];
}) {
  return (
    <div className="dc-print-doc">
      <PrintStyle />

      {/* หัวเอกสาร: บริษัท (ซ้าย) + ชื่อเอกสาร/เลขที่ (ขวา) */}
      <div className="dcp-head">
        <div className="dcp-org">
          {org.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logoUrl} alt={org.name} className="dcp-logo" />
          ) : null}
          <div>
            <div className="dcp-org-name">{org.name}</div>
          </div>
        </div>
        <div className="dcp-title-box">
          <div className="dcp-title">{docTitle}</div>
          {docTitleEn ? <div className="dcp-title-en">{docTitleEn}</div> : null}
          <div className="dcp-code">เลขที่: {code}</div>
          {headerRight?.map((m, i) => (
            <div key={i} className="dcp-hr">
              {m.label}: <b>{m.value}</b>
            </div>
          ))}
        </div>
      </div>

      <div className="dcp-rule" />

      {/* meta 2 คอลัมน์ */}
      {(metaLeft.length > 0 || metaRight.length > 0) && (
        <div className="dcp-meta">
          <div className="dcp-meta-col">
            {metaLeft.map((m, i) => (
              <div key={i} className="dcp-meta-row">
                <span className="dcp-meta-label">{m.label}</span>
                <span className="dcp-meta-value">{m.value}</span>
              </div>
            ))}
          </div>
          <div className="dcp-meta-col">
            {metaRight.map((m, i) => (
              <div key={i} className="dcp-meta-row">
                <span className="dcp-meta-label">{m.label}</span>
                <span className="dcp-meta-value">{m.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ตารางรายการ */}
      <table className="dcp-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: c.align ?? "left", width: c.width }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="dcp-empty">
                — ไม่มีรายการ —
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.key}>
                {columns.map((c) => (
                  <td key={c.key} style={{ textAlign: c.align ?? "left" }}>
                    {r.cells[c.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* ยอดรวม (ชิดขวา) */}
      {totals.length > 0 && (
        <div className="dcp-totals">
          {totals.map((t, i) => (
            <div key={i} className={`dcp-total-row${t.strong ? " is-strong" : ""}`}>
              <span className="dcp-total-label">{t.label}</span>
              <span className="dcp-total-value">{t.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* โน้ต */}
      {note ? (
        <div className="dcp-note">
          <span className="dcp-note-label">หมายเหตุ:</span> {note}
        </div>
      ) : null}

      {/* ช่องเซ็น */}
      <div className="dcp-signs">
        {signatures.map((s, i) => (
          <div key={i} className="dcp-sign">
            <div className="dcp-sign-line" />
            <div className="dcp-sign-role">
              ({s.name ?? "..............................."})
            </div>
            <div className="dcp-sign-role2">{s.role}</div>
            <div className="dcp-sign-date">วันที่ ......../......../........</div>
          </div>
        ))}
      </div>

      <div className="dcp-foot">
        พิมพ์จากระบบคลัง DC · {org.name} — เอกสารนี้ออกโดยระบบ ใช้ประกอบการสื่อสารภายใน
      </div>
    </div>
  );
}

function PrintStyle() {
  return (
    <style>{`
      .dc-print-doc {
        color: #111;
        background: #fff;
        font-size: 13px;
        line-height: 1.45;
        font-variant-numeric: tabular-nums;
      }
      @media screen {
        .dc-print-doc {
          max-width: 780px;
          margin: 20px auto;
          padding: 30px 34px;
          box-shadow: 0 3px 20px rgba(20,40,90,.13);
          border-radius: 8px;
        }
      }
      .dc-print-doc .dcp-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; }
      .dc-print-doc .dcp-org { display: flex; gap: 12px; align-items: center; min-width: 0; }
      .dc-print-doc .dcp-logo { width: 54px; height: 54px; object-fit: contain; }
      .dc-print-doc .dcp-org-name { font-size: 18px; font-weight: 800; letter-spacing: -.01em; }
      .dc-print-doc .dcp-title-box { text-align: right; flex: 0 0 auto; }
      .dc-print-doc .dcp-title { font-size: 19px; font-weight: 800; }
      .dc-print-doc .dcp-title-en { font-size: 11px; color: #666; letter-spacing: .04em; text-transform: uppercase; }
      .dc-print-doc .dcp-code { font-size: 13px; margin-top: 4px; font-weight: 700; }
      .dc-print-doc .dcp-hr { font-size: 12px; color: #333; margin-top: 2px; }
      .dc-print-doc .dcp-rule { height: 2px; background: #111; margin: 12px 0 14px; }
      .dc-print-doc .dcp-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin-bottom: 14px; }
      .dc-print-doc .dcp-meta-row { display: flex; gap: 8px; font-size: 12.5px; }
      .dc-print-doc .dcp-meta-label { color: #555; min-width: 72px; flex: 0 0 auto; }
      .dc-print-doc .dcp-meta-value { font-weight: 600; }
      .dc-print-doc .dcp-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
      .dc-print-doc .dcp-table th { background: #f2f4f7; border: 1px solid #999; padding: 7px 9px; font-size: 12px; font-weight: 700; }
      .dc-print-doc .dcp-table td { border: 1px solid #bbb; padding: 6px 9px; font-size: 12.5px; vertical-align: top; }
      .dc-print-doc .dcp-empty { text-align: center; color: #888; padding: 16px; }
      .dc-print-doc .dcp-totals { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; margin-bottom: 14px; }
      .dc-print-doc .dcp-total-row { display: flex; gap: 18px; min-width: 240px; justify-content: space-between; font-size: 13px; }
      .dc-print-doc .dcp-total-row.is-strong { font-size: 15px; font-weight: 800; border-top: 1.5px solid #111; padding-top: 5px; margin-top: 3px; }
      .dc-print-doc .dcp-total-label { color: #444; }
      .dc-print-doc .dcp-note { font-size: 12.5px; border: 1px dashed #bbb; border-radius: 6px; padding: 8px 10px; margin-bottom: 16px; }
      .dc-print-doc .dcp-note-label { font-weight: 700; }
      .dc-print-doc .dcp-signs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; margin-top: 34px; }
      .dc-print-doc .dcp-sign { text-align: center; }
      .dc-print-doc .dcp-sign-line { border-top: 1px dotted #333; margin: 22px 10px 6px; }
      .dc-print-doc .dcp-sign-role { font-size: 12px; color: #333; }
      .dc-print-doc .dcp-sign-role2 { font-size: 12.5px; font-weight: 700; margin-top: 2px; }
      .dc-print-doc .dcp-sign-date { font-size: 11px; color: #777; margin-top: 3px; }
      .dc-print-doc .dcp-foot { margin-top: 26px; padding-top: 8px; border-top: 1px solid #ddd; font-size: 10.5px; color: #999; text-align: center; }
      @media print {
        @page { size: A4; margin: 14mm; }
        html, body { background: #fff !important; }
        body * { visibility: hidden !important; }
        .dc-print-doc, .dc-print-doc * { visibility: visible !important; }
        .dc-print-doc { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 0; box-shadow: none; border-radius: 0; }
      }
    `}</style>
  );
}
