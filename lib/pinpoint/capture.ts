// Pinpoint — best-effort page capture (client only).
//
// Architecture decisions (workshop):
//  • snapdom, NOT html2canvas — html2canvas breaks on modern Tailwind (oklch,
//    backdrop-filter, web fonts). snapdom clones the node + inlines CSS/fonts.
//  • Lazy-imported ONLY here, so the ~library cost is paid only when comment
//    mode is actually used (0 bundle cost on every other admin page).
//  • Capture MUST NEVER block saving a pin — every failure resolves to null and
//    the pin still saves with its structured target (url + selector + comment).
//  • VIEWPORT-ONLY: snapdom renders the whole document.body, then we crop to the
//    visible viewport (จอที่ผู้ใช้เห็นจริง ณ ตำแหน่งเลื่อนนั้น) — ไม่เก็บทั้งหน้ายาว
//    เหมือนปริ้น. ถ่ายตอนผู้ใช้กดปักจริง → เนื้อหาโหลดเสร็จแล้ว ไม่ติด skeleton.

const MAX_DIM = 2600; // cap longest side (raster) — สูงพอให้ Claude Code/คนรีวิว อ่านตัวหนังสือออก

/** กรอบ "จอที่เห็น" ที่จะตัดเก็บ — พิกัดเลื่อนหน้า + ขนาดจอ (CSS px).
 *  ถ้าไม่ส่งมา = ใช้ค่าปัจจุบันของหน้าต่าง. ผู้เรียกควรส่งค่า ณ "ตอนกดปัก" เพื่อ
 *  ให้ภาพตรงกับสิ่งที่ผู้ใช้เห็นตอนนั้น แม้จะเลื่อนหน้าไปก่อนกดบันทึก. */
export interface ViewportCrop {
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
}

// เก็บเหตุผลที่จับภาพล่าสุดล้มเหลว — ให้ provider เอาไปโชว์ toast (ก่อนหน้านี้เงียบ → CEO ไม่รู้ว่าทำไมไม่มีภาพ)
let lastError: string | null = null;
export function lastCaptureError(): string | null {
  return lastError;
}

type SnapResult = {
  toBlob: (o?: Record<string, unknown>) => Promise<Blob>;
  toCanvas: (o?: Record<string, unknown>) => Promise<HTMLCanvasElement>;
};

/** Capture the VISIBLE VIEWPORT to a compressed webp Blob — snapdom renders the
 *  whole document.body, then we crop to the `crop` region (จอที่เห็นจริง). Returns
 *  null on any failure (capture is decoration; the pin's structured target is the
 *  real record). เหตุผลที่ล้มเหลวอ่านได้จาก lastCaptureError() เพื่อโชว์ให้ผู้ใช้รู้.
 *  ส่ง `crop` = ค่าตอน "กดปัก" เพื่อให้ภาพตรงกับสิ่งที่เห็นตอนนั้น (ไม่ส่ง = จอปัจจุบัน). */
export async function captureBody(crop?: ViewportCrop): Promise<Blob | null> {
  lastError = null;
  try {
    if (typeof window === "undefined") return null;
    // Wait for fonts so text/icons render in the clone.
    if (document.fonts?.ready) {
      await Promise.race([
        document.fonts.ready,
        new Promise((r) => setTimeout(r, 800)),
      ]);
    }

    let mod: unknown;
    try {
      mod = await import("@zumer/snapdom");
    } catch (e) {
      lastError = "โหลดตัวจับภาพไม่ได้ (snapdom)";
      console.warn("[pinpoint] snapdom import failed", e);
      return null;
    }
    const snapdom = (mod as { snapdom?: unknown }).snapdom ?? (mod as { default?: unknown }).default;
    if (typeof snapdom !== "function") {
      lastError = "ตัวจับภาพไม่พร้อมใช้งาน";
      return null;
    }

    // ถ่ายตามความละเอียดจริงของจอ (Retina = DPR 2) → ตัวหนังสือคม ไม่เบลอ. เดิม scale≤1
    // = ถ่ายแค่ครึ่งความละเอียดบนจอ Retina → เบลอตั้งแต่ต้นทาง. คุมไม่ให้เกิน MAX_DIM (กันไฟล์บวม).
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
    const longestCss = Math.max(window.innerWidth, window.innerHeight || 1);
    const scale = Math.min(dpr, MAX_DIM / longestCss);
    const opts = {
      backgroundColor: "#ffffff",
      scale: scale > 0 ? scale : 1,
      fast: true,
      embedFonts: true,
      // Drop our own overlay UI from the capture so pins/toolbar never appear
      // in the screenshot (snapdom removes matched nodes from the clone).
      exclude: ["[data-pinpoint-ui]"],
      excludeMode: "remove",
    };
    const run = snapdom as (el: Element, o?: Record<string, unknown>) => Promise<SnapResult>;

    // กรอบจอที่จะตัดเก็บ — ไม่ส่งมา = ใช้จอปัจจุบัน
    const region: ViewportCrop = crop ?? {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      width: window.innerWidth,
      height: window.innerHeight,
    };

    // snapdom → canvas เต็มหน้า → ตัดเหลือเฉพาะกรอบจอที่เห็น → webp (เผื่อ png).
    try {
      const result = await run(document.body, opts);
      const full = await result.toCanvas();
      const view = cropToViewport(full, region);
      const blob = await new Promise<Blob | null>((res) =>
        view.toBlob((b) => res(b), "image/webp", 0.9),
      );
      if (blob && blob.size > 0) return blob;
      const png = await new Promise<Blob | null>((res) =>
        view.toBlob((b) => res(b), "image/png"),
      );
      if (png && png.size > 0) return png;
    } catch (e) {
      lastError = "จับภาพหน้านี้ไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e));
      console.warn("[pinpoint] capture+crop failed", e);
      return null;
    }

    lastError = "จับภาพได้แต่ภาพว่าง";
    return null;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    console.warn("[pinpoint] captureBody failed (non-fatal)", err);
    return null;
  }
}

/** ตัด canvas เต็มหน้า (snapdom เก็บทั้ง body) ให้เหลือเฉพาะกรอบจอที่เห็น.
 *  อัตราส่วน px-ต่อ-CSS-px ได้จาก ขนาด canvas ÷ ขนาด body จริง → รองรับ scale/DPR
 *  ภายในของ snapdom เองโดยไม่ต้องรู้ค่า. หน้าสั้น/เลื่อนสุด → clamp อยู่ในขอบ canvas. */
function cropToViewport(full: HTMLCanvasElement, region: ViewportCrop): HTMLCanvasElement {
  const refW = document.body.scrollWidth || document.documentElement.scrollWidth || region.width;
  const refH = document.body.scrollHeight || document.documentElement.scrollHeight || region.height;
  const ratioX = full.width / refW;
  const ratioY = full.height / refH;
  const rx = refW > 0 && Number.isFinite(ratioX) && ratioX > 0 ? ratioX : 1;
  const ry = refH > 0 && Number.isFinite(ratioY) && ratioY > 0 ? ratioY : 1;

  let sx = Math.round(region.scrollX * rx);
  let sy = Math.round(region.scrollY * ry);
  let sw = Math.round(region.width * rx);
  let sh = Math.round(region.height * ry);

  sx = Math.max(0, Math.min(sx, Math.max(0, full.width - 1)));
  sy = Math.max(0, Math.min(sy, Math.max(0, full.height - 1)));
  sw = Math.max(1, Math.min(sw, full.width - sx));
  sh = Math.max(1, Math.min(sh, full.height - sy));

  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  const ctx = out.getContext("2d");
  if (!ctx) return full; // ตัดไม่ได้ → คืนภาพเต็ม (ยังดีกว่าไม่มีภาพ)
  ctx.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

/** Upload a captured blob through the SERVER (/api/r2/upload → putObject).
 *  ไม่ใช้ browser→R2 presigned PUT — เพราะมันต้องผ่าน R2 CORS allowlist ที่ไม่มี
 *  custom domain (pooilgroup.com) → พังเงียบ → ภาพไม่ขึ้น. ส่งผ่านเซิร์ฟเวอร์ตัด
 *  dependency CORS ทิ้งถาวร. Returns the R2 key (under users/<id>/) or null. */
export async function uploadCapture(blob: Blob): Promise<string | null> {
  try {
    const ext = blob.type === "image/png" ? "png" : "webp";
    const form = new FormData();
    form.append("file", blob, `pinpoint-${Date.now()}.${ext}`);
    const res = await fetch("/api/r2/upload", { method: "POST", body: form });
    if (!res.ok) return null;
    const { key } = (await res.json()) as { key?: string };
    return key ?? null;
  } catch (err) {
    console.warn("[pinpoint] uploadCapture failed (non-fatal)", err);
    return null;
  }
}

/** True when the device is realistically a touch phone — we skip snapdom there
 *  (unstable + heavy) and save pins with structured target only. */
export function isLikelyMobile(): boolean {
  if (typeof window === "undefined") return false;
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  return coarse && window.innerWidth < 768;
}
