"use client";

// DC · พิมพ์ฉลาก QR 58มม. (เครื่องพิมพ์สติกเกอร์ความร้อน) — QR สร้างในเครื่อง (offline ได้)
import { useState } from "react";
import { Printer } from "lucide-react";
import { qrDataUrl } from "@/lib/dc/qr";

export type DcLabelItem = { code: string; name: string; sku?: string | null; qty?: number };

/** เปิดหน้าต่างพิมพ์ฉลาก 58มม. (1 ดวง/สินค้า × จำนวน) */
export async function printDcLabels(items: DcLabelItem[]): Promise<void> {
  const cards: string[] = [];
  for (const it of items) {
    const copies = Math.max(1, it.qty ?? 1);
    const qr = await qrDataUrl(it.code, 200);
    for (let i = 0; i < copies; i++) {
      cards.push(`
        <div class="lbl">
          <img src="${qr}" class="qr" alt="" />
          <div class="meta">
            <div class="name">${escapeHtml(it.name)}</div>
            <div class="code">${escapeHtml(it.sku || it.code)}</div>
          </div>
        </div>`);
    }
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>ฉลาก DC</title>
    <style>
      @page { size: 58mm auto; margin: 0; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: -apple-system, "IBM Plex Sans Thai", sans-serif; }
      .lbl { width: 58mm; padding: 3mm; display: flex; gap: 3mm; align-items: center; page-break-after: always; }
      .qr { width: 22mm; height: 22mm; }
      .meta { flex: 1; min-width: 0; }
      .name { font-size: 11pt; font-weight: 700; line-height: 1.2; }
      .code { font-size: 9pt; color: #333; margin-top: 1mm; font-family: monospace; }
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

export function DcLabelButton({ items, label = "พิมพ์ฉลาก QR" }: { items: DcLabelItem[]; label?: string }) {
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
