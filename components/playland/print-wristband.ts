// Playland · shared wristband print helper
//
// Opens a dedicated 58mm-thermal popup and prints one OR several stickers in a
// SINGLE print job. Each sticker carries the SAME band code + QR so staff can
// match the right adult to the right child at pickup. Adult stickers are
// labeled "ผู้ปกครอง".
//
// Extracted from components/playland/wristband-issue-form.tsx so both the issue
// form and the cashier SPA share one implementation.

function esc(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}

export interface PrintWristbandOpts {
  code: string;
  memberName: string;
  nickname?: string | null;
  memberCode?: string | null;
  issuedAt?: Date;
  /** how many ADULT/guardian stickers to print in addition to the 1 child sticker */
  adultCount?: number;
}

function stickerHtml(opts: {
  code: string;
  title: string;
  nick: string | null;
  meta: string;
  role: string | null;
}): string {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(opts.code)}&qzone=1&margin=0`;
  return `<div class="sticker">
  ${opts.role ? `<div class="role">${esc(opts.role)}</div>` : ""}
  <img src="${qrUrl}" alt="${esc(opts.code)}">
  <div class="name">${esc(opts.title)}</div>
  ${opts.nick ? `<div class="nick">${esc(opts.nick)}</div>` : ""}
  <div class="code">${esc(opts.code)}</div>
  <div class="meta">${esc(opts.meta)}</div>
  <div class="brand">PLAY A LOT</div>
</div>`;
}

/**
 * Print 1 child sticker + N adult ("ผู้ปกครอง") stickers, all sharing `code`.
 * Returns false if the popup was blocked (caller can show a manual "พิมพ์ซ้ำ").
 */
export function printWristband(opts: PrintWristbandOpts): boolean {
  const issuedAt = opts.issuedAt ?? new Date();
  const dateStr = issuedAt.toLocaleString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const meta = `${opts.memberCode ?? ""}${opts.memberCode ? " · " : ""}${dateStr}`;
  const adults = Math.max(0, opts.adultCount ?? 0);

  const stickers: string[] = [
    stickerHtml({ code: opts.code, title: opts.memberName, nick: opts.nickname ?? null, meta, role: "เด็ก" }),
  ];
  for (let i = 0; i < adults; i++) {
    stickers.push(
      stickerHtml({
        code: opts.code,
        title: `ผู้ปกครองของ ${opts.memberName}`,
        nick: null,
        meta: `คู่กับสายรัดเด็ก · ${dateStr}`,
        role: "ผู้ปกครอง",
      }),
    );
  }

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.code)}</title>
<style>
  @page { size: 58mm auto; margin: 0; }
  @media print { @page { size: 58mm auto; margin: 0; } body { margin: 0; } .sticker { page-break-after: always; } .sticker:last-child { page-break-after: auto; } }
  html, body { margin: 0; padding: 0; font-family: ui-sans-serif, system-ui, "IBM Plex Sans Thai", sans-serif; }
  .sticker { width: 58mm; padding: 3mm; box-sizing: border-box; text-align: center; color: #000; }
  .sticker .role { font-size: 8pt; font-weight: 700; letter-spacing: 0.08em; color: #2D6CB1; margin-bottom: 1mm; text-transform: uppercase; }
  .sticker img { width: 40mm; height: 40mm; display: block; margin: 0 auto 1mm; }
  .sticker .name { font-size: 11pt; font-weight: 700; line-height: 1.15; word-break: break-word; }
  .sticker .nick { font-size: 9pt; color: #444; }
  .sticker .code { font-family: ui-monospace, "IBM Plex Mono", monospace; font-size: 10pt; font-weight: 700; letter-spacing: 0.05em; margin-top: 1mm; }
  .sticker .meta { font-size: 7.5pt; color: #666; margin-top: 0.5mm; }
  .sticker .brand { font-size: 7pt; color: #888; margin-top: 2mm; letter-spacing: 0.1em; text-transform: uppercase; }
  @media screen { body { background: #eee; padding: 20px; } .sticker { background: white; box-shadow: 0 2px 12px rgba(0,0,0,.15); margin: 0 auto 16px; } .hint { text-align: center; font-family: ui-sans-serif, system-ui; font-size: 12px; color: #555; margin-top: 16px; } }
</style></head><body>
${stickers.join("\n")}
<div class="hint">ถ้าหน้าต่างนี้ไม่ปริ้นอัตโนมัติ · กด Ctrl+P (หรือ Cmd+P)</div>
<script>
  window.addEventListener("load", function(){
    var imgs = Array.prototype.slice.call(document.querySelectorAll("img"));
    var remaining = imgs.length;
    function go(){ setTimeout(function(){ window.print(); }, 250); }
    if (remaining === 0) { go(); return; }
    function done(){ remaining--; if (remaining <= 0) go(); }
    imgs.forEach(function(img){
      if (img.complete) { done(); }
      else { img.addEventListener("load", done); img.addEventListener("error", done); }
    });
    window.addEventListener("afterprint", function(){ setTimeout(function(){ window.close(); }, 300); });
  });
</script>
</body></html>`;

  const w = window.open("", "_blank", "width=420,height=720");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
