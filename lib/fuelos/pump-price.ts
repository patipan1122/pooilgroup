import "server-only";

// ราคาหน้าปั๊ม PTTOR (SOAP) — endpoint จาก CEO
// operations (จาก WSDL): CurrentOilPrice / CurrentOilPriceProvincial / GetOilPrice / GetOilPriceProvincial
// param: Language (string). หมายเหตุ: ตอนทดสอบ server ตอบ "Language not provided"
// → คาดว่าต้องมี auth/ค่าเฉพาะที่ CEO จะแจ้งภายหลัง. โค้ดนี้ยิงตาม WSDL ถูกต้อง + ดึงผลแบบ best-effort.
const ENDPOINT = "https://orapiweb.pttor.com/oilservice/OilPrice.asmx";
// targetNamespace ของ WSDL = ไม่มี / ท้าย (SOAPAction = NS + "/CurrentOilPrice")
const NS = "https://orapiweb.pttor.com";

export type PumpPrice = { product: string; price: string };
export type PumpPriceResult =
  | { ok: true; prices: PumpPrice[]; raw: string }
  | { ok: false; error: string; raw?: string };

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

// แปลงผลลัพธ์ (อาจเป็น JSON หรือ XML ข้างใน) → list ราคา (best-effort)
function parsePrices(result: string): PumpPrice[] {
  const trimmed = result.trim();
  // JSON?
  try {
    const j = JSON.parse(trimmed);
    const arr = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : Array.isArray(j?.Table) ? j.Table : [];
    const out: PumpPrice[] = [];
    for (const row of arr) {
      const product = row.ProductName ?? row.product ?? row.Name ?? row.name ?? row.PRODUCT ?? null;
      const price = row.Price ?? row.price ?? row.PRICE ?? row.value ?? null;
      if (product != null && price != null) out.push({ product: String(product), price: String(price) });
    }
    if (out.length) return out;
  } catch {
    /* not json */
  }
  // XML rows? (จับคู่ tag ที่ดูเหมือนชื่อสินค้า/ราคา)
  const out: PumpPrice[] = [];
  const rowRe = /<(?:Table|Row|OilPrice|Item)[^>]*>([\s\S]*?)<\/(?:Table|Row|OilPrice|Item)>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(trimmed))) {
    const block = m[1];
    const product = block.match(/<(?:ProductName|Product|Name)>([^<]+)</i)?.[1];
    const price = block.match(/<(?:Price|Value)>([^<]+)</i)?.[1];
    if (product && price) out.push({ product, price });
  }
  return out;
}

export async function fetchPumpPrices(language = "TH"): Promise<PumpPriceResult> {
  const body =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>` +
    `<CurrentOilPrice xmlns="${NS}"><Language>${language}</Language></CurrentOilPrice>` +
    `</soap:Body></soap:Envelope>`;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `${NS}/CurrentOilPrice` },
      body,
      next: { revalidate: 1800 }, // cache 30 นาที
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, raw: text.slice(0, 600) };
    const m = text.match(/<CurrentOilPriceResult>([\s\S]*?)<\/CurrentOilPriceResult>/);
    const result = m ? decodeXml(m[1]) : text;
    const prices = parsePrices(result);
    if (prices.length === 0) {
      return { ok: false, error: result.trim().slice(0, 200) || "ดึงราคาไม่ได้", raw: result.slice(0, 600) };
    }
    return { ok: true, prices, raw: result.slice(0, 600) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}
