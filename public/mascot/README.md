# JP Sync — Brand & Mascot Pack 🦭

ชุดแบรนด์พร้อมใช้สำหรับ **ระบบบัญชี (LedgerLine / JP Link)** ที่รันบน LINE OA
มาสคอท = น้องแมวน้ำหมอนวด · โลโก้ = JPSYNC GROUP "BE THE FUTURE"

> เปิด `index.html` ในเบราว์เซอร์เพื่อดูทุกชิ้นแบบรูปภาพ

## สี
- **Brand Blue** `#2020F8` (rgb 32,32,248)
- **Cream** `#EEEEE6`

## โลโก้ (`/public/logos/`)
| ไฟล์ | ใช้ตอนไหน |
|---|---|
| `jpsyncgroup-logo.pdf` | ต้นฉบับเวกเตอร์ (มาสเตอร์ · ขยายไม่แตก) |
| `jpsync-logo-full.png` | โลโก้พื้นใส · ใช้ทั่วไป (หัวเว็บ/เอกสาร) |
| `jpsync-logo-white.png` | โลโก้พื้นขาว |
| `jpsync-badge-circle-white.png` | วงกลม ตรามาร์คน้ำเงินบนขาว |
| `jpsync-badge-circle-blue.png` | วงกลม มาร์คขาวบนน้ำเงิน · **โปรไฟล์ LINE OA** |
| `favicon-512/192/32.png` | ไอคอนเว็บ |

## มาสคอท (`/public/mascot/`)
| โฟลเดอร์ | ไฟล์ | ใช้ตอนไหน |
|---|---|---|
| `poses/` | seal-wave / thumbsup / laugh / thankyou / massage `.png` | มีคำพูดในตัว · พื้นใส |
| `clean/` | seal-*-clean.png | **ตัวล้วน ไม่มีคำพูด** · เอาไปใส่ข้อความเองในเว็บ |
| `avatars/` | seal-*-avatar-cream/blue.png + 256/128 | **รูปวงกลม** · โปรไฟล์ LINE OA / ไอคอน |
| `banner/` | seal-onsen.jpg | ภาพฉากผ่อนคลาย · แบนเนอร์ |

## วิธีเรียกใช้ใน Next.js
```tsx
import Image from "next/image";

// โลโก้
<Image src="/logos/jpsync-logo-full.png" alt="JPSYNC GROUP" width={180} height={90} />

// มาสคอทตัวล้วน
<Image src="/mascot/clean/seal-wave-clean.png" alt="" width={120} height={140} />

// โปรไฟล์ LINE OA (วงกลม)
<Image src="/mascot/avatars/seal-wave-avatar-cream.png" alt="" width={96} height={96} />
```

## หมายเหตุ
- ตัด/ลบพื้นหลังด้วย Pillow (flood-fill + defringe) — เนียนบนพื้นสว่าง; ถ้าต้องการขอบเป๊ะระดับสตูดิโอบนพื้นเข้มมาก ใช้ rembg/remove.bg เพิ่มได้
- อยากได้ **ท่าใหม่** → ใช้สูตร prompt ล็อกหน้าน้อง (ดู memory `jpsync-mascot-and-logo-2026-06-02`) สร้างในตัวที่ทำรูปเดิม แล้วส่งไฟล์มา ผมเก็บเข้าชุดให้
- ต้นฉบับทั้งหมดอยู่ใน Google Drive โฟลเดอร์ `vscode/Mascot`
