# รายงานวิเคราะห์: เราต้องเทรน OCR เองไหม? (Thai Receipt OCR สำหรับโมดูล JP Link)

> เขียนสำหรับ CEO (ไม่ใช่ developer) · มี English technical appendix ท้ายแต่ละหัวข้อสำหรับวิศวกร
> ข้อมูลปี 2026 · ตัวเลขทุกตัวอ้างอิงงานวิจัย + การ fact-check แบบ adversarial
> สร้างจาก deep-research workflow `thai-receipt-ocr-research` (8 มุม + 14 claim verify + 23 agents) 2026-06-02

---

## 1. คำตอบตรงๆ ของ CEO

**ไม่ต้องครับ — ความกลัวนี้ "หมดอายุ" ไปแล้ว 2-3 ปี**

เราไม่ต้องเทรนโมเดล OCR เอง และไม่ต้องนั่งเก็บรูปใบเสร็จเป็นหมื่นๆ ใบมาสอน AI เลย เปรียบเทียบง่ายๆ คือ "เมื่อก่อน" (ปี 2020-2023) การอ่านใบเสร็จต้องสร้างเครื่องอ่านเฉพาะทางเอง เหมือนต้องจ้างช่างมาฝึกพนักงานอ่านลายมือทีละคนเป็นปีๆ (เทคโนโลยีชื่อ Tesseract / EasyOCR + เทรน LayoutLM/Donut เอง ซึ่ง *จำเป็น* ต้องมีข้อมูลติดป้ายกำกับหลายพันใบ) แต่ "ตอนนี้" AI รุ่นใหม่ที่อ่านภาพได้ (vision-LLM) อ่านใบเสร็จไทยได้ทันทีแบบ **zero-shot** — แปลว่าเราแค่ส่งรูปถ่าย + บอกว่าอยากได้ข้อมูลช่องไหนบ้าง (ยอดเงิน, ร้านค้า, วันที่, เลขผู้เสียภาษี, VAT) แล้ว AI ก็คืนข้อมูลเป็นตารางให้เลย โดยไม่ต้องสอนมันก่อน

หลักฐานที่หนักแน่นที่สุด: งานวิจัยวิชาการไทยชื่อ **ThaiOCRBench** (ตีพิมพ์ในงานประชุม IJCNLP-AACL 2025, โดยทีม SCB 10X — arXiv 2511.04479, https://arxiv.org/abs/2511.04479) ทดสอบ AI ชั้นนำ 24 ตัวกับเอกสารไทยจริง **ในโหมด zero-shot (ไม่เทรนเลย)** แล้วมันก็อ่านได้ดี โดยเฉพาะใบเสร็จที่ "พิมพ์" ออกมา และที่สำคัญที่สุด — **Claude API ที่เราจ่ายเงินใช้อยู่แล้ว ทำงานนี้ได้ทันที** ค่าอ่านใบเสร็จ 1 รูปตกประมาณ **0.12-0.55 บาท** เท่านั้น (https://platform.claude.com/docs/en/build-with-claude/vision)

**ข้อแม้เดียวที่ต้องยอมรับตรงๆ:** ลายมือเขียน (handwriting) ภาษาไทยยังเป็นจุดอ่อนของ AI *ทุกตัว* ไม่ใช่แค่ตัวใดตัวหนึ่ง — ตรงนี้แก้ด้วยการเทรนโมเดลก็ไม่คุ้มสำหรับ SME แต่แก้ด้วยการใส่ "ขั้นตอนให้คนกดยืนยันก่อนบันทึก" แทน (ดูหัวข้อ 4 และ 6)

> **Technical appendix:** The "train your own OCR" paradigm (Tesseract/EasyOCR/PaddleOCR + fine-tuned LayoutLMv3/Donut requiring labeled image-JSON pairs) is obsolete for this use case. Zero-shot vision-LLMs treat extraction as whole-document understanding configured by prompt, not template-bound character recognition (https://www.vellum.ai/blog/document-data-extraction-llms-vs-ocrs). Donut/LayoutLMv3 remain relevant ONLY at very high volume + strict on-prem — not a no-IT-team SME's first build.

---

## 2. ทำไม Bainy ถึงทำได้ถูก/เร็ว

Bainy, Unyhub, Zendai Bills, FlowAccount AutoKey, PEAK PEAKConnect, Paypers — **ทุกเจ้าทำเหมือนกันหมด และเป็นวิธีที่เราทำได้เองวันนี้**

สิ่งที่พวกเขาทำคือ **"ห่อ" (thin wrapper)** — ไม่ได้สร้าง AI เอง แต่เป็นการรับรูปจาก LINE → ส่งเข้า AI อ่านภาพตัวใดตัวหนึ่ง (หรือ API OCR ไทยสำเร็จรูป) → ได้ข้อมูลกลับมาเป็นตาราง → เก็บลงระบบ ไม่มีเจ้าไหนให้ลูกค้านั่งเทรนอะไรเลย:
- Zendai Bills ทำงานในไลน์ล้วนๆ แพ็กส่วนตัวอ่าน 100 รูป/เดือน (https://www.zendaibills.com/en)
- PEAK PEAKConnect ถ่ายรูปในไลน์ → OCR แยก ร้านค้า/วันที่/วิธีจ่าย/ยอดรวม (https://www.peakaccount.com/peak-connect)
- FlowAccount AutoKey = AI OCR สำหรับบิล/ใบเสร็จ/ใบกำกับภาษี แบบ "อัปโหลด → ตรวจ → บันทึก" (https://flowaccount.com/en/autokey)

ส่วน Bainy/Unyhub ค้นแทบไม่เจอข้อมูลวิศวกรรมเลย — เจอแค่บัญชี Instagram/TikTok การตลาด (https://www.instagram.com/unyhub/) **การที่ "ไม่มีข้อมูล" นี่แหละคือหลักฐาน** ว่าทีมเล็กขนาดนี้ไม่มีปัญญา (และไม่จำเป็นต้อง) ลงทุนวิจัย OCR ไทยเอง พวกเขาแค่ "เช่า" AI มาใช้

**ทำไมราคา ~1 บาท/สแกนถึงทำกำไรได้:** เพราะต้นทุน AI จริงต่ำกว่านั้นมาก
- ค่า Claude Haiku 4.5 ต่อรูป ≈ **0.12 บาท**, Sonnet 4.6 ≈ **0.37 บาท** (https://platform.claude.com/docs/en/build-with-claude/vision)
- ค่า Gemini Flash-Lite ≈ **0.01-0.05 บาท/รูป** (https://ai.google.dev/gemini-api/docs/pricing)
- เคล็ดลับสำคัญสำหรับ **สลิปโอนเงิน** — เจ้าพวกนี้ *ไม่ใช้ OCR กับสลิป* แต่ "อ่าน QR ในสลิป" แล้วยิงเช็คกับธนาคารแห่งประเทศไทยโดยตรง (ผ่าน SlipOK/EasySlip) ได้ข้อมูลแม่นยำเกือบ 100% + จับสลิปปลอม/สลิปซ้ำได้ ในราคาแค่ **~0.36 บาท/สลิป** (https://slipok.com/api/)

สรุป: ราคา ~1 บาท คือราคาขาย แต่ต้นทุนจริงเป็นเศษสตางค์ → มี margin ตั้งแต่วันแรก และ **จุดต่างของเราไม่ควรเป็น "OCR แม่นกว่า" แต่ควรเป็น "เชื่อมต่อ + จัดหมวดหมู่อัตโนมัติดีกว่า"**

> **Technical appendix:** Competitors are orchestration layers over a vision-LLM or a hosted Thai OCR API + LINE webhook plumbing + a ledger UI. The defensible moat is integration/categorization/UX, not OCR accuracy. Slips use QR/PromptPay payload verification against BoT rails (deterministic, fraud-detecting), NOT pixel OCR.

---

## 3. ตารางเปรียบเทียบตัวเลือก

> ตัวเลข "ค่าใช้จ่าย/1,000 ใบ" คิดรวมรูป + prompt + JSON output แล้ว (ไม่ใช่ค่ารูปอย่างเดียว) · ค่าเงิน 1 USD ≈ 36 บาท

| ตัวเลือก | คุณภาพอ่านไทย (พิมพ์ / ลายมือ) | ต้องเทรน? | ค่าใช้จ่าย/1,000 ใบ | ความเร็ว | ความเป็นส่วนตัว (data residency) | ข้อดี | ข้อเสีย |
|---|---|---|---|---|---|---|---|
| **Claude Haiku 4.5** (มีในสแตกแล้ว) | พิมพ์: ดี / ลายมือ: อ่อน | ❌ ไม่ | **~$5-7 (180-250 บาท)** | เร็วสุด ~0.85s, ~100 tok/s | ส่งไป US/cloud · ไม่เทรนกับข้อมูลเรา · ลบใน 7 วัน · มี Zero-Data-Retention | ใช้ key + budget-guard เดิม · เร็ว+ถูก · ฮอลลูซิเนชันต่ำ | ลายมือไทยอ่อน · ไม่ใช่ผู้เชี่ยวชาญไทย |
| **Claude Sonnet 4.6** (มีในสแตกแล้ว) | พิมพ์: ดีมาก (94.2%* ฮอลลูฯ 0.09%) / ลายมือ: ปานกลาง | ❌ ไม่ | **~$11-21 (400-750 บาท)** | ~2.8s/หน้า | เหมือน Haiku | ฮอลลูซิเนชันต่ำสุดบนเอกสารการเงิน · เหมาะเป็น fallback ของเคสยาก | แพงกว่า Haiku · ลายมือไทยยังต้องคนช่วย |
| **Gemini 2.5 Flash-Lite** | พิมพ์: แข็งแรง / ลายมือ: อ่อน (ต้อง fallback ขึ้น Pro) | ❌ ไม่ | **~$0.19-0.50 (7-18 บาท)** | เร็วมาก | ส่งไป Google · ใช้ Vertex AI ได้ data-residency | ถูกที่สุดที่ใช้งานได้จริง · Batch ลด 50% | คนละ vendor กับ Claude (ต้องคุม budget guard เพิ่ม) · ลายมืออ่อน |
| **Gemini 2.5 Pro** (เก็บไว้เป็น fallback ลายมือ) | พิมพ์: ดีที่สุด (0.910) / **ลายมือ: ดีที่สุดในโลก (0.714)** | ❌ ไม่ | **~$3.5/พัน (~126 บาท)** | ช้ากว่า Flash | เหมือน Flash-Lite | **#1 บน ThaiOCRBench (0.777)** ชนะทุกตัว · ลายมือไทยนำขาด | แพง ~10x ของ Flash-Lite ถ้าใช้เป็น default · เกินจำเป็นกับใบพิมพ์ |
| **GPT-4o-mini / GPT-5.4-mini** | พิมพ์: ดี / ลายมือ: อ่อน (0.489) | ❌ ไม่ | **~$1-10 (36-360 บาท)** | ไม่กี่วินาที | ส่งไป OpenAI US · ไม่เทรนโดย default | Structured Outputs การันตี JSON 100% · ระบบนิเวศตัวอย่างเยอะ | ไม่ใช่ผู้นำ OCR ไทย · เพิ่ม vendor ที่ 2 |
| **Typhoon OCR 1.5** (โอเพนซอร์ส, SCB 10X) | พิมพ์: ดี / **ลายมือไทย: เก่งสุดในกลุ่มฟรี (BLEU 0.522)** | ❌ ไม่ (มีน้ำหนักให้แล้ว) | **ฟรี (จ่ายแค่ค่า GPU)** หรือ API ฟรี 20 req/min | เร็ว (2B เล็ก) | **self-host = ข้อมูลไม่ออกจากเราเลย (ดีที่สุด)** | ฟรี · ไทยแท้ · เก็บข้อมูลในบริษัทได้ 100% | ออกมาเป็น "ข้อความ" ไม่ใช่ JSON 7 ช่อง (ต้องต่อ Claude อีกที) · ต้องดูแล GPU/server เอง · ราคา API Pro ยัง "coming soon" |
| **iApp Thai Receipt OCR** (vendor ไทย) | **พิมพ์: 98.8%* / ลายมือ: 90%+*** (*self-report) | ❌ ไม่ | **~890-1,250 บาท** (0.89-1.25 บาท/หน้า + VAT) | 5-10s/เอกสาร | **ดีสุดด้าน PDPA: datacenter ในไทย (True IDC) · ไม่เก็บข้อมูลหลังประมวลผล** | คืนช่องที่เราต้องการเป๊ะ (เลขผู้เสียภาษี/VAT) · ข้อมูลอยู่ในไทย · 50-100 เครดิตฟรีทดลอง | ตัวเลขเป็น marketing ของเขาเอง (ต้อง pilot จริง) · เพิ่ม vendor + DPA |
| **Google Document AI** (vendor ใหญ่) | พิมพ์: ดี ~92% / ลายมือ: รองรับ แต่ไม่มี benchmark ไทยเฉพาะ | ❌ ไม่ | **~$10/พัน (~360 บาท)** | 5-10s | ภูมิภาคใกล้สุด = สิงคโปร์ (ข้อมูลออกนอกไทย) | enterprise-grade · ช่องสำเร็จรูป | ข้อมูลออกนอกไทย · ไม่มีตัวเลขไทยเฉพาะ · onboarding หนักสำหรับ SME |

> **\*หมายเหตุสำคัญจากการ fact-check (อย่าเชื่อตัวเลขลอยๆ):**
> - **94.2% ของ Claude Sonnet 4.6** มาจากบล็อกเดียว (CodeSOTA) ที่ "ไม่บอกวิธีทดสอบ ไม่บอกจำนวนตัวอย่าง" → **ห้ามเอาไปอ้างกับใครว่าเป็นข้อเท็จจริง** ต้องทดสอบเองก่อน (https://www.codesota.com/ocr/claude-vs-gpt4o-ocr)
> - **ThaiOCRBench (งานวิจัยจริง)** ทดสอบ Claude Sonnet **4** (รุ่นเก่า) ได้ที่ 3 (0.579) ตามหลัง Gemini 2.5 Pro (0.777) และ GPT-4o (0.645) — **บน "ลายมือไทย" Claude Sonnet 4 ได้ต่ำสุดในกลุ่ม proprietary (0.301 เทียบ Gemini 0.714, GPT-4o 0.489)** (https://arxiv.org/abs/2511.04479) ตัวเลข Sonnet 4.6 รุ่นใหม่ยังไม่มีใครวัด → ต้อง pilot เอง
> - **iApp 98.8%** เป็นตัวเลขที่ iApp วัดเองบนชุดข้อมูล 10,000 ใบของเขาเอง — เทียบกับ benchmark อิสระ (Veryfi 98.7%, Google Vision ~94.3%) ตัวเลข iApp อยู่บนสุดของที่เป็นไปได้พอดี = **ควรสงสัยและทดสอบกับใบจริงของเราเอง** (https://iapp.co.th/docs/ocr/receipt)

---

## 4. สถาปัตยกรรมที่แนะนำสำหรับโมดูลเรา

**หลักการ: BUILD-LIGHT บน Claude ที่เรามีอยู่แล้ว + แยกทางเดินของ "สลิป" ออกจาก "ใบเสร็จ/ใบกำกับ"**

### ภาพรวม pipeline (อธิบายแบบ CEO)

```
ลูกค้าส่งรูปในกลุ่ม LINE
        │
        ▼
[1] เก็บรูปต้นฉบับลง R2 (เก็บไว้ตรวจย้อนหลังเสมอ)
        │
        ▼
[2] ย่อรูปให้เหลือด้านยาว ~1,568px + บีบ JPEG ── ลดค่าใช้จ่าย 40-70% โดยไม่เสียความแม่น
        │
        ▼
[3] รูปนี้คืออะไร? ── ถ้าเป็น "สลิปโอนเงิน" (มี QR)
        │                    │
        │                    ▼
        │              [3a] อ่าน QR → เช็คกับธนาคารแห่งประเทศไทย (SlipOK/EasySlip)
        │                    → ได้ ยอด/ผู้โอน/ผู้รับ/เลขอ้างอิง แม่นเกือบ 100% + จับสลิปปลอม/ซ้ำ
        │                    → ไม่ต้องใช้ AI เดา → บันทึกได้เลย
        │
        ▼ (ถ้าเป็นใบเสร็จ/ใบกำกับภาษี/ลายมือ)
[4] ส่งเข้า Claude Haiku 4.5 (ตัวถูก+เร็ว) พร้อม "แม่แบบ JSON" (tool-use)
    → ขอ 8 ช่อง: ยอดเงิน, ร้านค้า, วันที่, เลขผู้เสียภาษี, VAT,
      วิธีจ่าย, ประเภทเอกสาร, หมวดหมู่อัตโนมัติ + "คะแนนความมั่นใจ 0-1 ต่อช่อง"
        │
        ▼
[5] ตรวจเลขด้วยกฎตายตัว (ไม่ใช้ AI): เลขผู้เสียภาษี = 13 หลัก?
    · ยอดย่อย + VAT = ยอดรวม? · VAT ≈ 7% ของยอดย่อย? ── กฎพวกนี้ = ตัวเช็คความมั่นใจฟรี
        │
        ▼
[6] ช่องไหน "ความมั่นใจต่ำ" หรือ "ลายมือ" → ส่งขึ้น Claude Sonnet 4.6 อ่านซ้ำ (escalate)
        │
        ▼
[7] ยังไม่มั่นใจ? → โชว์หน้าจอใน LINE ให้คน "แตะยืนยัน/แก้ไข" ก่อนบันทึก
    (เหมือนปุ่ม "แก้หมวดหมู่" ของ Bainy) ── เก็บการแก้ไขไว้ดูสถิติภายหลัง
        │
        ▼
[8] บันทึกลง Supabase (พร้อม org_id ตาม RLS เดิม + ลิงก์รูปต้นฉบับ)
```

### โมเดลที่แนะนำ

- **PRIMARY (ค่าเริ่มต้น):** **Claude Haiku 4.5** — ถูกสุด เร็วสุด อยู่ในสแตกเราแล้ว ผ่าน budget-guard เดิม (~0.12 บาท/รูป)
- **HYBRID/FALLBACK:** เคสยาก/ลายมือ/ความมั่นใจต่ำ → **escalate ขึ้น Claude Sonnet 4.6** (ฮอลลูซิเนชันต่ำสุดบนเอกสารการเงิน เหมาะกับเงิน)
- **สลิป:** แยกไปใช้ **SlipOK/EasySlip (QR verify)** ไม่ใช่ AI เลย — แม่นกว่า ถูกกว่า จับปลอมได้
- **ทางเลือกอนาคต (ยังไม่ทำตอนนี้):** ถ้าลายมือเยอะมากจน Claude เอาไม่อยู่ → pilot **Typhoon OCR 1.5** (ฟรี, ไทยแท้, self-host เพื่อ data sovereignty) เป็น fallback ของลายมือ หรือเพิ่ม **Gemini 2.5 Pro** (แชมป์ลายมือไทย 0.714) เฉพาะเคสที่ flag แล้ว

**ทำไมถึงเริ่มที่ Claude ไม่ใช่ Gemini ที่ถูกกว่า:** เพราะเรามี Anthropic SDK + budget-guard + token_usage logging อยู่แล้ว → เพิ่ม Gemini = เพิ่ม vendor ที่ 2, key ที่ 2, budget guard ที่ 2, DPA ที่ 2 ความถูกของ Gemini Flash-Lite (7-18 บาท/พัน เทียบ Claude Haiku 180-250 บาท/พัน) ยังไม่คุ้มกับความยุ่งยากที่ระดับ volume ของ SME — แต่ **เก็บ Gemini ไว้เป็น option** ถ้าทดสอบแล้วมันชนะบนใบของเราจริง

> **Technical appendix:** Use Anthropic tool-use against a strict JSON schema (not free-text JSON prompting) — far more reliable, fits existing zod stack. Schema: `{amount, vendorName, date, taxId, vat, paymentMethod, docType, autoCategory, lineItems[], confidence per field}`. temperature 0. Image BEFORE text in the message. Prompt-cache the static prefix (system + schema + Thai few-shot) for 90% off repeated input (min cacheable prefix 1,024 tok Sonnet / 4,096 tok Haiku). Deterministic validators (13-digit Tax ID per Revenue Code §86, subtotal+VAT=total, VAT≈7% through 30 Sep 2026) double as free confidence signals (https://invoicedataextraction.com/blog/thailand-tax-invoice-requirements). Cheap-then-expensive cascade: Haiku → Sonnet on low confidence. Structured Outputs is GA on Sonnet 4.5/4.6, Opus 4.5, Haiku 4.5 — guarantees schema conformance (NOT accuracy) (https://claude.com/blog/structured-outputs-on-the-claude-developer-platform). Slip path: QR/PromptPay payload verify via SlipOK/EasySlip or self-host SDK (https://github.com/maythiwat/slipverify).

---

## 5. ประมาณการต้นทุน

### ต้นทุนต่อ 1,000 ใบเสร็จ (ชุดที่แนะนำ: Haiku เป็นหลัก + Sonnet เฉพาะเคสยาก ~20%)

| รายการ | ต่อ 1,000 ใบ |
|---|---|
| Claude Haiku 4.5 (800 ใบที่ง่าย) | ~$4 (≈145 บาท) |
| Claude Sonnet 4.6 (200 ใบยาก/ลายมือ escalate) | ~$3 (≈108 บาท) |
| SlipOK สลิป (แยกต่างหาก ถ้ามี) | ~0.36 บาท/สลิป |
| **รวมประมาณ (ใบเสร็จล้วน)** | **~$7 ≈ 250 บาท / 1,000 ใบ** |
| ถ้าเปิด Batch API (ลด 50%) + prompt caching | **เหลือ ~125-180 บาท / 1,000 ใบ** |

**ที่มาตัวเลข (ผ่านการ fact-check แล้ว):**
- Claude Haiku 4.5 = $1/M input, $5/M output → รูป ~1,500 tokens + output ~600 tokens ≈ **$0.005/ใบ** (https://platform.claude.com/docs/en/about-claude/pricing)
- Claude Sonnet 4.6 = $3/M input, $15/M output → ค่ารูปอย่างเดียว ~$0.004-0.005 + prompt + JSON output → **รวม ~$0.01-0.02/ใบ** (verdict แก้ตัวเลขแล้ว: ค่ารูปอย่างเดียว ≠ ค่าต่อใบ — ต้องบวก output)
- Batch API ลด 50% ตายตัว, prompt cache ลด 90% บนส่วน schema/instruction ที่ซ้ำ

### เทียบกับการจ่ายค่าสมาชิก Bainy/คู่แข่ง

- Zendai แพ็กส่วนตัว = อ่านได้ **100 รูป/เดือน** (https://www.zendaibills.com/en) → ถ้าเราอ่านเอง 100 รูป/เดือนด้วย Haiku = **~12-25 บาท/เดือน** (ค่า AI ดิบ)
- iApp (ถ้าใช้ vendor ไทย) = **890-1,250 บาท/1,000 ใบ** → แพงกว่า Claude ~5-7 เท่า แต่ได้ data-residency ในไทย
- **สรุป:** ต้นทุน AI ดิบของเราต่อ 1,000 ใบ (~125-250 บาท) **ถูกกว่าราคาตลาด ~1 บาท/สแกน (1,000 บาท/พัน) อยู่ 4-8 เท่า** → ถ้าเราขายต่อในราคาเดียวกับตลาด เรามี margin หนา · ถ้าใช้ภายในเอง ต้นทุนแทบไม่มีนัยสำคัญ (หลักร้อยบาท/เดือนสำหรับ volume SME ทั่วไป) บวกกับเวลา dev ที่เรามีอยู่แล้ว

> **Technical appendix:** Building custom OCR = 100-1000x more expensive (Vellum: traditional OCR $5,000-20,000 upfront + dev; GPT-4 Vision $50-100/10k pages; Gemini Flash 2.0 ~$1.67/10k pages — https://www.vellum.ai/blog/document-data-extraction-llms-vs-ocrs). Measure real `token_usage` on 100 actual receipts to confirm before scaling.

---

## 6. ความเสี่ยง + วิธีกัน

| ความเสี่ยง | คืออะไร (ภาษา CEO) | วิธีกัน |
|---|---|---|
| **1. ลายมือไทยอ่านพลาด** | AI ทุกตัวอ่อนเรื่องลายมือ — ThaiOCRBench ยืนยันลายมือ + ตัวอักษรพิเศษไทยทำคะแนนตกแรงสุดทุกโมเดล (Claude Sonnet 4 ได้แค่ 0.301 บนลายมือ) (https://arxiv.org/abs/2511.04479) | **บังคับ "คนกดยืนยันก่อนบันทึก"** สำหรับเคสลายมือ/ความมั่นใจต่ำ เสมอ · ทางเลือกเสริม: fallback ไป Gemini 2.5 Pro (แชมป์ลายมือ 0.714) หรือ Typhoon OCR (ไทยแท้, ฟรี) เฉพาะเคสที่ flag |
| **2. AI เดาตัวเลขมั่ว (hallucination)** | นี่คือ **ความเสี่ยงจริงที่สุด** — AI "อ่านพลาดแบบเนียน" ยอดรวมที่ผิดดูน่าเชื่อเท่ายอดที่ถูก ต่างจาก OCR แบบเก่าที่พลาดแบบเห็นชัด (https://www.vellum.ai/blog/document-data-extraction-llms-vs-ocrs) | (1) **ห้าม auto-post เด็ดขาด** — confirm-before-save เสมอ · (2) ตรวจเลขด้วยกฎคณิต (ยอดย่อย + VAT = ยอดรวม) · (3) สลิปใช้ QR verify เป็น source of truth ไม่ให้ AI เดา · (4) เก็บรูปต้นฉบับไว้ตรวจ · Claude มีฮอลลูซิเนชันต่ำสุดบนเอกสารการเงิน (~0.09-0.15%) เป็นเหตุผลที่เลือกเป็น primary |
| **3. ความเป็นส่วนตัว/PDPA เอกสารการเงินไทย** | ข้อมูลการเงินส่งออกนอกประเทศไหม? | Claude API: **สัญญาว่าไม่เทรนกับข้อมูลเรา · ลบใน 7-30 วัน · มี Zero-Data-Retention agreement** (https://platform.claude.com/docs/en/manage-claude/api-and-data-retention) — ใช้งานได้ภายใต้ PDPA ด้วย DPA · **แต่ข้อมูลรันบน US/global infra (ออกนอกไทย)** → ถ้ากฎหมาย/ลูกค้าบังคับ "ข้อมูลต้องอยู่ในไทย" ให้สลับไป **iApp (datacenter ในไทย)** หรือ **self-host Typhoon OCR (ข้อมูลไม่ออกจากเราเลย)** |
| **4. โมเดลถูกเลิก (deprecation)** | ปี 2026 โมเดลเปลี่ยนเร็วมาก (Sonnet 4.5→4.6, GPT-5.4→5.5, ราคา GPT-5.5 ขึ้น 2 เท่า) | **แยก model id ไว้ที่ config เดียว** (เปลี่ยนได้ที่เดียว) · อย่า hard-code · ออกแบบ pipeline ให้สลับ vendor ได้ (schema กลางเหมือนกัน) · ทบทวนราคา/รุ่นทุกไตรมาส · เก็บ Typhoon (โอเพนซอร์ส, ไม่มีวันถูกเลิก) เป็น escape hatch ระยะยาว |

> **Technical appendix:** Structured Outputs guarantees schema conformance but NOT accuracy — keep confidence/needs-review flag + human-in-the-loop. Anthropic vision docs warn of hallucination on low-quality/rotated/tiny images; "always verify for high-stakes use cases" — accounting IS high-stakes. Store original image + extraction + corrections for audit trail and future eval (not training).

---

## 7. ขั้นต่อไป — Accuracy Spike (1 วัน)

**เป้าหมาย: พิสูจน์ความแม่นบน "ใบจริงของ JP Link" ก่อนสร้างโมดูลเต็ม** (อย่าสร้างก่อนรู้ตัวเลขจริง)

### แผนทดสอบ 1 วัน

**ขั้นที่ 1 — เก็บตัวอย่างจริง (เช้า, ~1 ชม.)**
- รวบรวม **50 รูปจริงจากกลุ่ม LINE ของ JP Link** — **แบ่งสัดส่วน: 30 ใบพิมพ์ + 20 ใบลายมือ** (จงใจเอนเอียงไปทางลายมือ + รูปยับ/แสงน้อย/เบลอ เพราะนั่นคือจุดที่ตัวเลข marketing พังจริง)
- ทำ "เฉลย" (ground truth) ด้วยมือ: พิมพ์ค่าจริงของแต่ละช่อง (ยอดเงิน, ร้านค้า, วันที่, เลขผู้เสียภาษี, VAT) ลง spreadsheet

**ขั้นที่ 2 — A/B test 2-3 โมเดล (บ่าย, ~3-4 ชม.)**
ยิงรูปชุดเดียวกันผ่าน:
1. **Claude Haiku 4.5** (ตัวที่เราอยากใช้เป็น primary)
2. **Claude Sonnet 4.6** (ตัว escalate)
3. **Gemini 2.5 Pro** (ตัวเทียบ — แชมป์ลายมือไทยตาม ThaiOCRBench เพื่อดูว่าเราเสียอะไรถ้าไม่ใช้)

**ขั้นที่ 3 — วัดผล (เย็น, ~1 ชม.)**
- **เมตริกหลัก = Field-Level Accuracy %** = (จำนวนช่องที่ AI อ่านถูกเป๊ะ ÷ จำนวนช่องทั้งหมด) × 100
  - **สำคัญ:** วัด "ระดับช่อง" ไม่ใช่ "ระดับตัวอักษร" — เพราะ "5,432" อ่านเป็น "5,482" คือ 99.7% ถูกระดับตัวอักษร แต่ **ยอดผิด = ช่องนั้นผิด** (สำหรับบัญชี ตัวเลขที่ถูกเกือบหมดก็คือตัวเลขผิดอยู่ดี)
  - แยกรายงาน: **% ของใบพิมพ์** vs **% ของใบลายมือ** (สองตัวนี้จะต่างกันมาก)
- จับ latency (วินาที/รูป) และต้นทุนจริง (จาก token_usage)

### เกณฑ์ผ่าน/ไม่ผ่าน (pass/fail bar)

| | เกณฑ์ผ่าน | ถ้าไม่ผ่าน → ทำอะไร |
|---|---|---|
| **ใบพิมพ์ (field-level)** | **≥ 95%** | ถ้า Haiku < 95% → ลองตั้ง Sonnet เป็น primary แทน |
| **ใบลายมือ (field-level)** | **≥ 85%** (ตามมาตรฐานอุตสาหกรรม — ลายมือทุกตัวตก) | ถ้า Claude < 85% แต่ Gemini Pro ≥ 85% → เพิ่ม Gemini เป็น fallback ลายมือ |
| **ทุกกรณี** | ต้องมี human-confirm สำหรับช่องที่ confidence ต่ำ — ไม่ว่าผลออกมาดีแค่ไหน | (non-negotiable เสมอ) |

**ผลลัพธ์ที่ได้:** ตัวเลขจริงของ JP Link → ตัดสินใจเลือก primary model + รู้ว่าต้องมี Gemini/Typhoon fallback ไหม → ค่อยสร้างโมดูลเต็มด้วยความมั่นใจ (ลงทุน 1 วันเพื่อกันการสร้างผิดทั้งโมดูล)

> **Technical appendix:** OCR accuracy is measured as CER/WER/edit-distance, NOT BLEU/ROUGE (those are MT/summarization metrics). Published benchmark scores run on clean docs and do NOT transfer to crumpled LINE photos — a 2026 9-tool handwriting test showed WER spread from 0.9% to 95.4% (~100x), so vendor headline numbers tell you nothing about YOUR docs (https://aimultiple.com/handwriting-recognition). Stratify the 50-sample set to over-weight handwritten + degraded receipts. Disregard the CodeSOTA 94.2% figure (single undocumented blog).

---

## 8. สรุป 3 bullets สำหรับ CEO

- **ไม่ต้องเทรน AI เอง ไม่ต้องเก็บ dataset** — ความกลัวนี้เป็นวิธีคิดยุคเก่า (2020-2023) Claude API ที่เราจ่ายอยู่แล้วอ่านใบเสร็จไทยได้ทันทีในราคา ~0.12-0.55 บาท/รูป และ Bainy/คู่แข่งทุกเจ้าก็แค่ "ห่อ" AI แบบเดียวกับที่เราทำได้วันนี้ — งานนี้คือ "ไม่กี่วันของงาน prompt + UI" ไม่ใช่ "หลายเดือนของการเก็บข้อมูล"
- **แผนชนะ = Claude (Haiku หลัก, Sonnet เคสยาก) + แยกสลิปไปเช็ค QR กับธนาคาร + ปุ่มให้คนยืนยันก่อนบันทึก** — ต้นทุน ~125-250 บาท/1,000 ใบ (ถูกกว่าราคาตลาด 1 บาท/สแกน อยู่ 4-8 เท่า) ใช้ key + budget-guard เดิม ไม่ต้องเพิ่ม vendor
- **ความเสี่ยงจริงไม่ใช่ "ยากเกินไป" แต่คือ "AI เดาตัวเลขมั่วแบบเนียน" + "ลายมือ"** — กันด้วยกฎเหล็ก: ห้าม auto-post เด็ดขาด, ตรวจเลขด้วยคณิต (ยอดย่อย+VAT=ยอดรวม), เก็บรูปต้นฉบับไว้เสมอ · และ **ก่อนสร้างโมดูล ลงทุน 1 วันทดสอบกับใบจริง 50 ใบ** (วัด field-level accuracy, เกณฑ์ผ่าน: พิมพ์ ≥95% / ลายมือ ≥85%) เพื่อยืนยันก่อนสร้างจริง
