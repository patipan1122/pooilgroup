// DC · local QR generation (no external API — works offline, per workshop W-?).
// `qrcode` runs in both Node (server) and the browser (client print window).

import QRCode from "qrcode";

/** QR as a PNG data-URL (embeddable in print HTML / <img>). */
export async function qrDataUrl(text: string, size = 240): Promise<string> {
  return QRCode.toDataURL(text, {
    width: size,
    margin: 1,
    errorCorrectionLevel: "M",
  });
}

/** QR as an inline SVG string (crisp for thermal print). */
export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
}
