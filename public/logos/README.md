# Buildly Go Logos

วาง logo files จาก Looka ที่นี่:

## Suggested filenames
- `wordmark.svg` — โลโก้แบบ "BUILDLY GO" เต็มชื่อ (ใช้ในนาว/footer)
- `wordmark.png` — version PNG (fallback)
- `mark.svg` — โลโก้แบบไอคอน B-mark อย่างเดียว (favicon · social · OG image)
- `mark.png` — version PNG
- `stacked.svg` — โลโก้แบบ vertical (BUILDLY บน GO ใหญ่ใต้)

## How to download from Looka
1. เปิด looka.com → เลือก layout ที่ชอบ
2. กด "Download" ขวาบน → เลือก SVG package
3. Unzip → copy file ลงในโฟลเดอร์นี้
4. แจ้ง Claude ให้ swap ใน code ทีไหนบ้าง

## Currently used in code
ตอนนี้โค้ดใช้ inline SVG "B" mark + iridescent gradient · เมื่อมีไฟล์จริงให้ swap ใน:
- `src/app/page.tsx` — nav logo
- `src/components/cosmic/brand-mark.tsx` (TODO)
- `src/app/layout.tsx` — favicon
