// Playland · plain payment receipt (no wristband QR) — for the face-scan
// checkout path (Wave 2), where there's no physical wristband to hand the
// customer as a token, so staff still need something printable as proof of
// payment. Shares the 58mm-thermal popup pattern with print-wristband.ts.

function esc(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}

export interface PrintReceiptOpts {
  no: string;
  name: string;
  lines: { label: string; amount: number }[];
  total: number;
  note?: string;
  issuedAt?: Date;
  branchName?: string;
  branchPhone?: string;
  /** "HH:mm" — เวลาเข้าเล่น */
  checkInTime?: string;
  /** "HH:mm" — เวลาที่แพ็กเกจหมด (ไม่ใช่เวลาปัจจุบัน) */
  expiresTime?: string;
}

/** Returns false if the popup was blocked (caller can show a manual retry). */
export function printReceipt(opts: PrintReceiptOpts): boolean {
  const issuedAt = opts.issuedAt ?? new Date();
  const dateStr = issuedAt.toLocaleString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const linesHtml = opts.lines
    .map((l) => `<div class="line"><span>${esc(l.label)}</span><span>฿${l.amount}</span></div>`)
    .join("\n");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.no)}</title>
<style>
  @page { size: 58mm auto; margin: 0; }
  @media print { @page { size: 58mm auto; margin: 0; } body { margin: 0; } }
  html, body { margin: 0; padding: 0; font-family: ui-sans-serif, system-ui, "IBM Plex Sans Thai", sans-serif; }
  .receipt { width: 58mm; padding: 4mm; box-sizing: border-box; color: #000; }
  .brand { text-align: center; font-size: 14pt; font-weight: 700; margin-bottom: 1mm; }
  .no { text-align: center; font-size: 8pt; color: #555; margin-bottom: 3mm; }
  .name { text-align: center; font-size: 11pt; font-weight: 700; margin-bottom: 2mm; }
  .divider { border-top: 1px dashed #999; margin: 2mm 0; }
  .line { display: flex; justify-content: space-between; font-size: 10pt; padding: 1mm 0; }
  .total { display: flex; justify-content: space-between; font-size: 12pt; font-weight: 700; padding-top: 1mm; }
  .note { text-align: center; font-size: 8.5pt; color: #444; margin-top: 3mm; line-height: 1.4; }
  .date { text-align: center; font-size: 7.5pt; color: #888; margin-top: 2mm; }
  .branch { text-align: center; font-size: 8.5pt; color: #333; margin-bottom: 1mm; }
  .times { display: flex; justify-content: space-between; font-size: 8.5pt; color: #333; padding: 0.5mm 0; }
  .policy { text-align: center; font-size: 7.5pt; color: #666; margin-top: 2mm; line-height: 1.5; border-top: 1px dashed #ccc; padding-top: 2mm; }
  .footer { text-align: center; font-size: 7.5pt; color: #888; margin-top: 2mm; }
  @media screen { body { background: #eee; padding: 20px; } .receipt { background: white; box-shadow: 0 2px 12px rgba(0,0,0,.15); margin: 0 auto; } .hint { text-align: center; font-family: ui-sans-serif, system-ui; font-size: 12px; color: #555; margin-top: 16px; } }
</style></head><body>
<div class="receipt">
  <div class="brand">Play <span style="color:#F0B323">a</span> lot</div>
  ${opts.branchName ? `<div class="branch">สาขา${esc(opts.branchName)}</div>` : ""}
  <div class="no">ใบเสร็จ ${esc(opts.no)}</div>
  <div class="name">${esc(opts.name)}</div>
  <div class="divider"></div>
  ${linesHtml}
  <div class="divider"></div>
  <div class="total"><span>รวม</span><span>฿${opts.total}</span></div>
  ${opts.checkInTime || opts.expiresTime ? `<div class="divider"></div>` : ""}
  ${opts.checkInTime ? `<div class="times"><span>เริ่มเล่น</span><span>${esc(opts.checkInTime)} น.</span></div>` : ""}
  ${opts.expiresTime ? `<div class="times"><span>หมดเวลา</span><span>${esc(opts.expiresTime)} น.</span></div>` : ""}
  ${opts.note ? `<div class="note">${esc(opts.note)}</div>` : ""}
  <div class="policy">มารับช้าเกิน 15 นาทีหลังหมดเวลา คิดค่าบริการเพิ่มเท่าราคาแพ็กเกจ 1 ชั่วโมง</div>
  <div class="date">${dateStr}</div>
  ${opts.branchPhone ? `<div class="footer">สอบถาม/แนะนำติชม โทร ${esc(opts.branchPhone)}</div>` : ""}
</div>
<div class="hint">ถ้าหน้าต่างนี้ไม่ปริ้นอัตโนมัติ · กด Ctrl+P (หรือ Cmd+P)</div>
<script>
  window.addEventListener("load", function(){
    setTimeout(function(){ window.print(); }, 200);
    window.addEventListener("afterprint", function(){ setTimeout(function(){ window.close(); }, 300); });
  });
</script>
</body></html>`;

  const w = window.open("", "_blank", "width=380,height=560");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
