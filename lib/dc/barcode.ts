// DC · สร้างบาร์โค้ดแท่ง Code128 ในเครื่อง (client-only — ใช้ canvas)
// ปืนสแกน 1D เลเซอร์ (ถูกสุด) อ่าน QR ไม่ได้ → ต้องมีบาร์โค้ดแท่งบนป้ายด้วย
import JsBarcode from "jsbarcode";

/**
 * Code128 เป็น PNG data-URL (ฝังใน <img> ของหน้าต่างพิมพ์ได้เลย)
 * คืน null ถ้าเข้ารหัสไม่ได้ (เช่นรหัสมีอักษรไทย/นอกช่วง ASCII) → ให้ป้ายใช้ QR+ตัวหนังสือแทน
 */
export function code128DataUrl(text: string): string | null {
  // Code128 มาตรฐานรับได้เฉพาะ ASCII (0x20–0x7E) — มีอักษรไทย/พิเศษ = ข้าม กันป้ายพัง
  if (!text || /[^\x20-\x7E]/.test(text)) return null;
  try {
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, text, {
      format: "CODE128",
      displayValue: false, // โชว์ตัวเลขเองใต้บาร์โค้ด (คุมฟอนต์/ขนาดได้)
      margin: 0,
      height: 60,
      width: 2,
    });
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
