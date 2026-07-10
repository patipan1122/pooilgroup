// DC · เอกสารเป็น "รูป PNG" (ส่งลงไลน์) — ตัวเรนเดอร์กลาง ใช้ next/og ImageResponse (Satori).
//
// WHY: ผู้ใช้อยากส่งใบสั่งซื้อ/ใบโอน/ใบนับ ให้เพื่อนร่วมงานทางไลน์ — รูปแชร์ง่ายกว่า PDF บนมือถือ.
// route `/image` เรียก renderDocImage(...) แล้ว set Content-Disposition: attachment → กดแล้ว "โหลดลงเครื่อง".
//
// ดีไซน์: เอกสารทางการขาว-ดำ (เหมือน <DcPrintDoc>) — หัวโลโก้+ชื่อบริษัท · ชื่อเอกสาร+เลขที่ · meta ·
//   ตารางมีเส้น · ยอดรวมชิดขวา · โน้ต. กว้าง ~840px · สูงคำนวณจากจำนวนแถว.
//
// ★ Satori ต้องการ "ฟอนต์ไทยเป็น bytes" ไม่งั้นตัวไทยกลายเป็นสี่เหลี่ยม — โหลด TTF จาก Google Fonts
//   (UA เก่า → ได้ truetype ไม่ใช่ woff2 · pattern เดียวกับ apply/[slug]/opengraph-image.tsx).
//   ทุกอย่างที่ fail ได้ (ฟอนต์/โลโก้) degrade แบบ graceful — ไม่ throw 500.

import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";

// ── ประเภทข้อมูลเอกสาร (parallel กับ props ของ <DcPrintDoc>) ─────────────
export type DocImageColumn = {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  /** สัดส่วนความกว้าง (flex-grow). ปล่อยว่าง = 1 */
  flex?: number;
};
export type DocImageRow = { cells: Record<string, string> };
export type DocImageMeta = { label: string; value: string };
export type DocImageTotal = { label: string; value: string; strong?: boolean };

export type DocImageInput = {
  org: { name: string; logoUrl: string | null };
  docTitle: string;
  docTitleEn?: string;
  code: string;
  /** ข้อมูลมุมขวาบน (วันที่/สถานะ) */
  headerRight?: DocImageMeta[];
  metaLeft?: DocImageMeta[];
  metaRight?: DocImageMeta[];
  columns: DocImageColumn[];
  rows: DocImageRow[];
  totals?: DocImageTotal[];
  note?: string | null;
  /** ชื่อไฟล์ (ไม่ต้องใส่ .png) */
  filename: string;
};

const WIDTH = 840;
const ROW_CAP = 60; // ตัดที่ 60 แถว (กันภาพสูงเกินไป) — ที่เหลือบอกให้ดูใน PDF
const INK = "#111827";
const MUTED = "#6b7280";
const LINE = "#c8ccd4";
const HEAD_BG = "#eef1f5";

// ── ฟอนต์ไทย (โหลด TTF จาก Google Fonts · UA เก่า = truetype) ────────────
async function loadThaiFont(text: string, weight: 400 | 700): Promise<ArrayBuffer | null> {
  try {
    const api = `https://fonts.googleapis.com/css2?family=Anuphan:wght@${weight}&text=${encodeURIComponent(text)}`;
    const css = await fetch(api, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/32.0.1700.77 Safari/537.36",
      },
    }).then((r) => (r.ok ? r.text() : ""));
    const m = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:opentype|truetype)'\)/);
    if (!m) return null;
    const res = await fetch(m[1]!);
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

// ── โลโก้ → data URL. R2/http = fetch · path ในเครื่อง (/logos/..) = อ่านไฟล์ตรง ────────
async function loadLogoDataUrl(logoUrl: string | null): Promise<string | null> {
  const src = logoUrl && logoUrl.trim() ? logoUrl.trim() : "/logos/jpsync-logo-full.png";
  try {
    if (/^https?:\/\//.test(src)) {
      const r = await fetch(src);
      if (!r.ok) return null;
      const ct = r.headers.get("content-type") ?? "image/png";
      if (!ct.startsWith("image/")) return null;
      const b64 = Buffer.from(await r.arrayBuffer()).toString("base64");
      return `data:${ct};base64,${b64}`;
    }
    // local public asset — อ่านจาก filesystem (เชื่อถือได้กว่า fetch localhost ตอน build/runtime)
    const rel = src.replace(/^\//, "");
    const file = path.join(process.cwd(), "public", rel);
    const buf = await readFile(file);
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    // ลอง fallback โลโก้กลุ่มถ้า logoUrl ที่ส่งมาพัง
    if (src !== "/logos/jpsync-logo-full.png") {
      try {
        const buf = await readFile(path.join(process.cwd(), "public", "logos", "jpsync-logo-full.png"));
        return `data:image/png;base64,${buf.toString("base64")}`;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * เรนเดอร์เอกสารเป็นรูป PNG แล้วคืน Response (attachment → โหลดลงเครื่อง).
 * ★ เรียกจาก route handler ที่ตั้ง runtime="nodejs" (ต้องใช้ fs + Buffer + font fetch).
 */
export async function renderDocImage(input: DocImageInput): Promise<Response> {
  const rows = input.rows;
  const shown = rows.slice(0, ROW_CAP);
  const overflow = rows.length - shown.length;

  // ข้อความทั้งหมดที่จะเรนเดอร์ → ขอ glyph ฟอนต์เฉพาะที่ใช้ (เล็ก/เร็ว)
  const allText =
    input.org.name +
    input.docTitle +
    (input.docTitleEn ?? "") +
    input.code +
    (input.note ?? "") +
    [...(input.headerRight ?? []), ...(input.metaLeft ?? []), ...(input.metaRight ?? []), ...(input.totals ?? [])]
      .map((m) => m.label + m.value)
      .join("") +
    input.columns.map((c) => c.header).join("") +
    shown.map((r) => input.columns.map((c) => r.cells[c.key] ?? "").join("")).join("") +
    "เลขที่หมายเหตุและอีกรายการดูครบใน PDF" +
    "0123456789.,-+/()฿¥ ";

  const [fontRegular, fontBold, logo] = await Promise.all([
    loadThaiFont(allText, 400),
    loadThaiFont(allText, 700),
    loadLogoDataUrl(input.org.logoUrl),
  ]);

  const colFlex = (c: DocImageColumn) => c.flex ?? 1;
  const cellAlign = (c: DocImageColumn): "flex-start" | "flex-end" | "center" =>
    c.align === "right" ? "flex-end" : c.align === "center" ? "center" : "flex-start";

  // ประมาณความสูง (Satori คำนวณเองได้ แต่ ImageResponse ต้องรู้ height ล่วงหน้า)
  const headH = 96;
  const metaRows = Math.max((input.metaLeft ?? []).length, (input.metaRight ?? []).length);
  const metaH = metaRows > 0 ? 24 + metaRows * 22 : 8;
  const tableH = 40 + shown.length * 34 + (overflow > 0 ? 34 : 0);
  const totalsH = (input.totals?.length ?? 0) * 28 + 12;
  const noteH = input.note ? 60 : 0;
  const footH = 60;
  const PAD = 40;
  const height = Math.max(560, PAD * 2 + headH + metaH + tableH + totalsH + noteH + footH);

  const fontFamily = fontRegular || fontBold ? "Anuphan, sans-serif" : "sans-serif";

  const el = (
    <div
      style={{
        width: `${WIDTH}px`,
        height: `${height}px`,
        display: "flex",
        flexDirection: "column",
        background: "#ffffff",
        color: INK,
        fontFamily,
        padding: `${PAD}px`,
      }}
    >
      {/* หัวเอกสาร: โลโก้+บริษัท (ซ้าย) · ชื่อเอกสาร+เลขที่ (ขวา) */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" width={56} height={56} style={{ objectFit: "contain", marginRight: 14 }} />
          ) : null}
          <div style={{ display: "flex", fontSize: 22, fontWeight: 700, letterSpacing: "-0.3px" }}>
            {input.org.name}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <div style={{ display: "flex", fontSize: 24, fontWeight: 700 }}>{input.docTitle}</div>
          {input.docTitleEn ? (
            <div style={{ display: "flex", fontSize: 12, color: MUTED, letterSpacing: "1px", marginTop: 1 }}>
              {input.docTitleEn.toUpperCase()}
            </div>
          ) : null}
          <div style={{ display: "flex", fontSize: 14, fontWeight: 700, marginTop: 4 }}>เลขที่: {input.code}</div>
          {(input.headerRight ?? []).map((m, i) => (
            <div key={i} style={{ display: "flex", fontSize: 13, color: "#374151", marginTop: 2 }}>
              {m.label}: {m.value}
            </div>
          ))}
        </div>
      </div>

      {/* เส้นคั่นหนา */}
      <div style={{ display: "flex", height: 3, background: INK, marginTop: 12, marginBottom: 14 }} />

      {/* meta 2 คอลัมน์ */}
      {metaRows > 0 ? (
        <div style={{ display: "flex", marginBottom: 14 }}>
          {[input.metaLeft ?? [], input.metaRight ?? []].map((col, ci) => (
            <div key={ci} style={{ display: "flex", flexDirection: "column", flex: 1, paddingRight: 20 }}>
              {col.map((m, i) => (
                <div key={i} style={{ display: "flex", fontSize: 13.5, marginBottom: 4 }}>
                  <span style={{ display: "flex", color: MUTED, width: 96 }}>{m.label}</span>
                  <span style={{ display: "flex", fontWeight: 700 }}>{m.value}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {/* ตารางรายการ */}
      <div style={{ display: "flex", flexDirection: "column", border: `1px solid ${LINE}` }}>
        {/* หัวตาราง */}
        <div style={{ display: "flex", background: HEAD_BG, borderBottom: `1px solid ${LINE}` }}>
          {input.columns.map((c) => (
            <div
              key={c.key}
              style={{
                display: "flex",
                flex: colFlex(c),
                justifyContent: cellAlign(c),
                padding: "8px 10px",
                fontSize: 12.5,
                fontWeight: 700,
              }}
            >
              {c.header}
            </div>
          ))}
        </div>
        {/* แถว */}
        {shown.length === 0 ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "16px", color: MUTED, fontSize: 13 }}>
            — ไม่มีรายการ —
          </div>
        ) : (
          shown.map((r, ri) => (
            <div key={ri} style={{ display: "flex", borderBottom: `1px solid ${LINE}` }}>
              {input.columns.map((c) => (
                <div
                  key={c.key}
                  style={{
                    display: "flex",
                    flex: colFlex(c),
                    justifyContent: cellAlign(c),
                    padding: "7px 10px",
                    fontSize: 12.5,
                  }}
                >
                  {r.cells[c.key] ?? ""}
                </div>
              ))}
            </div>
          ))
        )}
        {overflow > 0 ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "8px", color: MUTED, fontSize: 12 }}>
            … และอีก {overflow} รายการ (ดูครบใน PDF)
          </div>
        ) : null}
      </div>

      {/* ยอดรวม (ชิดขวา) */}
      {(input.totals?.length ?? 0) > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", marginTop: 12 }}>
          {(input.totals ?? []).map((t, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                width: 300,
                fontSize: t.strong ? 16 : 13.5,
                fontWeight: t.strong ? 700 : 500,
                borderTop: t.strong ? `2px solid ${INK}` : "none",
                paddingTop: t.strong ? 6 : 2,
                marginTop: t.strong ? 4 : 0,
              }}
            >
              <span style={{ display: "flex", color: t.strong ? INK : MUTED }}>{t.label}</span>
              <span style={{ display: "flex" }}>{t.value}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* โน้ต */}
      {input.note ? (
        <div
          style={{
            display: "flex",
            marginTop: 14,
            padding: "9px 12px",
            border: `1px dashed ${LINE}`,
            borderRadius: 6,
            fontSize: 12.5,
          }}
        >
          <span style={{ display: "flex", fontWeight: 700, marginRight: 6 }}>หมายเหตุ:</span>
          <span style={{ display: "flex" }}>{input.note}</span>
        </div>
      ) : null}

      {/* footer */}
      <div style={{ display: "flex", flex: 1 }} />
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          borderTop: `1px solid #e5e7eb`,
          paddingTop: 8,
          fontSize: 10.5,
          color: "#9ca3af",
        }}
      >
        ออกจากระบบคลัง DC · {input.org.name} — เอกสารประกอบการสื่อสารภายใน
      </div>
    </div>
  );

  const fonts: { name: string; data: ArrayBuffer; style: "normal"; weight: 400 | 700 }[] = [];
  if (fontRegular) fonts.push({ name: "Anuphan", data: fontRegular, style: "normal", weight: 400 });
  if (fontBold) fonts.push({ name: "Anuphan", data: fontBold, style: "normal", weight: 700 });

  const img = new ImageResponse(el, {
    width: WIDTH,
    height,
    fonts: fonts.length ? fonts : undefined,
  });

  // แปลงเป็น attachment (โหลดลงเครื่อง) — คัดลอก body + set header ชื่อไฟล์
  const safeName = input.filename.replace(/[^A-Za-z0-9._-]+/g, "_") || "document";
  const headers = new Headers(img.headers);
  headers.set("Content-Disposition", `attachment; filename="${safeName}.png"`);
  headers.set("Cache-Control", "no-store");
  return new Response(img.body, { status: img.status, headers });
}
