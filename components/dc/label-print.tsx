"use client";

// DC · พิมพ์ฉลาก 58มม. (เครื่องพิมพ์สติกเกอร์ความร้อน) — สร้างในเครื่อง (offline ได้)
//   บนป้าย 1 ดวงมีครบ 3 อย่าง: บาร์โค้ดแท่ง (ปืน 1D ยิงได้) + QR (มือถือ/ปืน 2D) + รหัสตัวหนังสือ (พิมพ์มือ/อ่านด้วยตา)
import { useState } from "react";
import { Printer } from "lucide-react";
import { qrDataUrl } from "@/lib/dc/qr";
import { code128DataUrl } from "@/lib/dc/barcode";

export type DcLabelItem = { code: string; name: string; sku?: string | null; qty?: number };

/** เปิดหน้าต่างพิมพ์ฉลาก 58มม. (1 ดวง/สินค้า × จำนวน) */
export async function printDcLabels(items: DcLabelItem[]): Promise<void> {
  const cards: string[] = [];
  for (const it of items) {
    const copies = Math.max(1, it.qty ?? 1);
    const qr = await qrDataUrl(it.code, 200);
    const barcode = code128DataUrl(it.code); // null ถ้ารหัสมีอักษรไทย → เหลือ QR+ตัวหนังสือ
    const barcodeImg = barcode ? `<img src="${barcode}" class="bc" alt="" />` : "";
    for (let i = 0; i < copies; i++) {
      cards.push(`
        <div class="lbl">
          <div class="name">${escapeHtml(it.name)}</div>
          ${barcodeImg}
          <div class="row">
            <div class="code">${escapeHtml(it.sku || it.code)}</div>
            <img src="${qr}" class="qr" alt="" />
          </div>
        </div>`);
    }
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>ฉลาก DC</title>
    <style>
      @page { size: 58mm auto; margin: 0; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: -apple-system, "IBM Plex Sans Thai", sans-serif; }
      .lbl { width: 58mm; padding: 3mm; page-break-after: always; }
      .name { font-size: 11pt; font-weight: 700; line-height: 1.2; }
      .bc { display: block; width: 52mm; height: 12mm; margin: 1.5mm 0 0.5mm; }
      .row { display: flex; justify-content: space-between; align-items: flex-end; gap: 2mm; margin-top: 0.5mm; }
      .code { font-size: 10pt; color: #111; font-family: monospace; letter-spacing: 0.5px; word-break: break-all; }
      .qr { width: 15mm; height: 15mm; flex-shrink: 0; }
    </style></head><body>${cards.join("")}
    <script>window.onload=function(){window.print();setTimeout(function(){window.close()},400)}</script>
    </body></html>`;
  const w = window.open("", "_blank", "width=400,height=600");
  if (!w) { alert("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ · อนุญาต popup แล้วลองใหม่"); return; }
  w.document.write(html);
  w.document.close();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
}

export function DcLabelButton({ items, label = "พิมพ์ฉลาก (บาร์โค้ด+QR)" }: { items: DcLabelItem[]; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="dc-btn-xl dc-btn-xl--ghost"
      disabled={busy || items.length === 0}
      onClick={async () => { setBusy(true); try { await printDcLabels(items); } finally { setBusy(false); } }}
    >
      <Printer size={18} /> {label}
    </button>
  );
}
