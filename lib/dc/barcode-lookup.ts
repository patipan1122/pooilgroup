"use server";

// DC · เดาชื่อ+รูปสินค้าจากบาร์โค้ด EAN ผ่าน Open Food Facts (ฟรี ไม่ต้อง API key)
//   • ใช้ "ตอนลงทะเบียนสินค้าใหม่ครั้งแรก" เท่านั้น — ฐานสินค้าเราเองยังเป็น source of truth
//   • ยิงเฉพาะบาร์โค้ดมาตรฐานสากล (ตัวเลข 8/12/13/14 หลัก) → ไม่ส่ง SKU ภายในออกนอกบริษัท
//   • ครอบคลุมจริงแค่ของกิน/ของแบรนด์ — ของนำเข้าจีน/อะไหล่มักไม่พบ (กรอกเอง)
//   • ทำฝั่ง server: ไม่ติด CORS · เผยแค่บาร์โค้ดสาธารณะ · เผื่อ cache ในอนาคต

export type BarcodeLookupResult =
  | { found: true; name: string; imageUrl: string | null; brand: string | null; source: string }
  | { found: false; reason: "invalid" | "notfound" | "error" };

export async function lookupBarcodeInfo(barcodeRaw: string): Promise<BarcodeLookupResult> {
  const code = (barcodeRaw ?? "").trim();
  // บาร์โค้ดสากล = ตัวเลขล้วน EAN-8 (8) หรือ UPC/EAN/GTIN (12–14) — กันเผลอส่งรหัส SKU ภายในออกไป
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return { found: false, reason: "invalid" };

  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_th,brands,image_front_url,image_url`,
      {
        headers: {
          // Open Food Facts ขอให้ระบุ User-Agent บอกว่าใครเรียก (มารยาท + กันโดนบล็อก)
          "User-Agent": "PooilGroup-DC/1.0 (warehouse inventory app; contact patipan@jpsyncgroup.com)",
        },
        signal: AbortSignal.timeout(6000), // กันค้าง ถ้าฐานช้า → ถือว่าไม่พบ
        cache: "no-store",
      },
    );
    if (!res.ok) return { found: false, reason: "error" };

    const data: unknown = await res.json();
    const d = data as { status?: number; product?: Record<string, unknown> };
    if (d?.status !== 1 || !d.product) return { found: false, reason: "notfound" };

    const p = d.product;
    const nameTh = typeof p.product_name_th === "string" ? p.product_name_th.trim() : "";
    const nameEn = typeof p.product_name === "string" ? p.product_name.trim() : "";
    const name = nameTh || nameEn;
    const brandsStr = typeof p.brands === "string" ? p.brands.trim() : "";
    const brand = brandsStr ? brandsStr.split(",")[0].trim() : null;
    const imgFront = typeof p.image_front_url === "string" ? p.image_front_url : "";
    const imgAny = typeof p.image_url === "string" ? p.image_url : "";
    const imageUrl = imgFront || imgAny || null;

    if (!name && !imageUrl) return { found: false, reason: "notfound" };
    return { found: true, name, imageUrl, brand, source: "Open Food Facts" };
  } catch {
    return { found: false, reason: "error" };
  }
}
