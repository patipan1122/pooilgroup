// ขนาดบิตแมปสายรัด K2 · ใช้ร่วมกันระหว่างตัววาด (เบราว์เซอร์) / server action ที่ตรวจงานพิมพ์ / agent
// pure module (ห้าม "use server") · ตัวเลขนี้ผูกกับสต็อก NIIMBOT TS25*206 (25x206 มม. @ 8 จุด/มม.)

export const WRISTBAND_DOTS_ACROSS = 200; // กว้างข้ามสาย (25 มม.)
export const WRISTBAND_DOTS_ALONG = 1648; // ยาวตามสาย (206 มม.) = จำนวนแถวที่ส่งให้เครื่อง
export const WRISTBAND_BYTES_PER_ROW = WRISTBAND_DOTS_ACROSS / 8; // 25 ไบต์/แถว (1 บิตต่อจุด · MSB ก่อน · 1 = จุดดำ)
export const WRISTBAND_BITMAP_BYTES = WRISTBAND_BYTES_PER_ROW * WRISTBAND_DOTS_ALONG; // 41,200
