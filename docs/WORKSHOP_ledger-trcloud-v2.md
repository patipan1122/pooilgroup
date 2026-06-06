# Workshop Spec · LedgerLine → TRCloud v2 · JP Sync Group
> สถานะ: **APPROVED — ทุก Decision ยืนยันแล้ว · พร้อม Build**
> เขียนโดย: Thai CFO/CPA + TRCloud Specialist · อ้างอิง workshop 2026-06-06
> Target: pooilgroup-web · branch `tax-invoice` → merge to `setup`
> ห้ามแก้ไข GL code, SKU, department mapping โดยไม่ปรึกษาสำนักงานบัญชี

---

## 1. เป้าหมายและ Definition of Done

### เป้าหมายทางธุรกิจ

LedgerLine ทำหน้าที่ "รับใบเสร็จ + จัดหมวด" ส่วน TRCloud ทำหน้าที่ "สมุดบัญชีกลาง" ของ JP Sync Group การเชื่อมต่อ v2 นี้คือการทำให้ข้อมูลที่ไหลจาก LedgerLine เข้า TRCloud **ถูกต้องตามกฎหมายภาษีและมาตรฐานบัญชีไทย** ไม่ใช่แค่ส่งผ่านข้อมูลได้

**ปัญหาของ v1 (ที่ต้องแก้):**
1. ทะเบียนสินค้าใน TRCloud บานปลาย — ทุกชื่อใบเสร็จสร้าง SKU ใหม่ (ปัจจุบัน LDG* ขยะ)
2. ไม่มีข้อมูลสาขา (department/project) ในใบ AP → รายงานต้นทุนรายสาขาไม่ได้
3. ภาษีซื้อที่ขอคืนไม่ได้ ถูกส่งเข้า ภ.พ.30 ทุกใบ → ความเสี่ยงสรรพากร
4. ส่งเข้า company 31 (ใช้ร่วมกับ FuelOS) แทน company 45 (JPS GROUP) ที่ถูกต้อง
5. GL account ว่างเปล่า → งบกำไรขาดทุนแยกหมวดค่าใช้จ่ายไม่ได้

### Definition of Done (ตรวจได้ทุกข้อ)

| # | Criteria | วิธีตรวจ |
|---|---|---|
| D1 | AP ทุกใบใช้ company_id=45 (JPS GROUP) | ดู AP ใหม่ใน TRCloud → company name = "JPS GROUP" |
| D2 | SKU = JPS-100, JPS-101 หรือ JPS-103 เท่านั้น — ไม่มี LDG* | inventory/list → นับ SKU ที่ LedgerLine แตะ ≤ 3 |
| D3 | ทุกบรรทัดมี GL (acc_code) ถูกต้องตามผังบัญชี | AP detail → product line → acc_code ≠ blank |
| D4 | ทุกใบมี project = รหัสสาขา TRCloud | AP header → project ≠ blank สำหรับสาขาที่ map แล้ว |
| D5 | ค่าใช้จ่าย VAT ขอคืนไม่ได้ → tax_report=0 (ไม่เข้า ภ.พ.30) | ค่าเช่าสำนักงาน/ค่ารับรอง → tax_report field = "0" |
| D6 | ใบที่สาขายังไม่ map → บล็อก push พร้อม error message ชัดเจน | กดส่ง AP สาขาที่ไม่มี trcloudProject → แสดง error |
| D7 | ใบที่หมวดยังไม่มี GL → บล็อก push | กดส่ง AP หมวดที่ไม่มี trcloudAccCode → แสดง error |
| D8 | ใบที่ push แล้วกด push ซ้ำ → skip อัตโนมัติ | ใบที่มี trcloudDocId → ระบบ return alreadySent=true |
| D9 | approve_status = "wait" ทุกใบ — นักบัญชีต้อง approve ใน TRCloud ก่อน | AP TRCloud → status = "รอตรวจสอบ" |
| D10 | Settings UI: แอดมินตั้ง branch→department + category→SKU ได้ | /ledger/settings → กำหนดค่าครบ แล้ว push สำเร็จ |

---

## 2. ผู้ใช้งานที่ได้รับผลกระทบ

### ผู้ใช้งานหลัก

| บทบาท | ได้รับผลกระทบอย่างไร |
|---|---|
| **พนักงานสาขา (Staff)** | ไม่เปลี่ยนแปลง — ถ่ายใบเสร็จผ่าน LINE เหมือนเดิม ไม่เห็น TRCloud เลย |
| **ผู้จัดการสาขา (Branch Manager)** | ไม่เปลี่ยนแปลง — ยืนยัน/แก้ใบเหมือนเดิม |
| **นักบัญชี (Accountant)** | **เปลี่ยนมากที่สุด** — เห็น AP ใหม่ใน TRCloud สมบูรณ์กว่าเดิม (มี GL + สาขา + draft status); ต้อง approve ใน TRCloud ก่อน post |
| **แอดมิน LedgerLine (Admin)** | ต้องเข้า /ledger/settings ตั้งค่า: สาขา→department + หมวด→SKU ครั้งเดียว |
| **CEO / ผู้บริหาร** | รายงานต้นทุนรายสาขารายหมวดใน TRCloud ถูกต้องขึ้น → ตัดสินใจธุรกิจได้ดีขึ้น |
| **สำนักงานบัญชีภายนอก** | ตรวจ AP ได้ง่ายขึ้น — ทุกใบมี GL + สาขา + ลิงก์ไปใบเสร็จต้นฉบับ |

### ผู้ที่ไม่ได้รับผลกระทบ (ยืนยัน)

- ผู้ใช้งานโมดูลอื่น (ChairOps, FuelOS, repairs, clawfleet) — ไม่แตะ Branch model ที่ใช้ร่วม
- ผู้ใช้งาน TRCloud ที่ไม่เกี่ยว LedgerLine — ไม่ใช่ company 45 ไม่กระทบ

---

## 3. Architecture — LedgerLine → TRCloud Field Mapping

### 3.1 ภาพรวม Flow (ภาษาธุรกิจ)

```
[พนักงานถ่ายใบเสร็จ LINE]
         ↓
[AI OCR → draft ใน LedgerLine]
         ↓
[นักบัญชี LedgerLine ยืนยัน (confirm)]
         ← ณ จุดนี้: snapshot GL + SKU + department ลงบน expense
         ↓
[นักบัญชีกด "ส่งเข้า TRCloud" (manual)]
         ↓
[ระบบ validate 5 ข้อ → ถ้าผ่าน → ส่ง AP เข้า TRCloud company 45]
         ↓
[AP ปรากฏใน TRCloud สถานะ "รอตรวจสอบ"]
         ↓
[นักบัญชีตรวจ → approve → TRCloud post บัญชี Dr/Cr อัตโนมัติ]
```

**Golden Rule ที่ห้ามละเมิด:** draft ออกจากระบบไม่ได้ — ต้อง confirmed เท่านั้น

### 3.2 Field Mapping Table (LedgerLine → TRCloud ap/create.php)

| TRCloud Field | ค่าที่ส่ง | แหล่งข้อมูล | หมายเหตุ |
|---|---|---|---|
| `company_id` | `45` | env `TRCLOUD_COMPANY_ID` | **เปลี่ยนจาก 31 → 45** |
| `company_format` | `JPS_AP` | hardcode | **เปลี่ยนจาก AP → JPS_AP** |
| `tax_option` | `in` | hardcode | **เปลี่ยนจาก ex → in** (VAT รวมแล้ว) |
| `approve_status` | `wait` | hardcode | draft เสมอ นักบัญชี approve ใน TRCloud |
| `type` | `Cash[AP]` | expense.paymentStatus=paid | จ่ายแล้ว = Cash · ยังไม่จ่าย = Deposit[AP] |
| `issue_date` | วันที่ในใบเสร็จ | expense.docDate | |
| `tax_date` | เดียวกับ issue_date | expense.docDate | |
| `project` | รหัสสาขา TRCloud | branch.trcloudProject | **ใหม่ v2** |
| `reference` | LedgerLine docCode | expense.docCode | back-reference กลับมา LedgerLine |
| `wht` | ยอด WHT | expense.wht | |
| `discount` | ส่วนลด | expense.discount | |
| `tax_report` | `1` หรือ `0` | expense.inputVatClaimable | **ใหม่ v2** — ต่อ flag ที่มีอยู่แล้ว |
| `invoice_note` | "ระบบบัญชี (LedgerLine) · อ้างอิง EXP-..." | template | |
| `product[].product_id` | JPS-100/101/103 | category.trcloudProductCode | **เปลี่ยนจาก LDG+sha1** |
| `product[].acc_code` | รหัส GL เช่น 5220020 | category.trcloudAccCode | **ใหม่ v2** |
| `product[].price` | ราคาต่อหน่วย | คำนวณจาก amount/qty | |
| `product[].vat` | VAT รายบรรทัด | กระจายตามสัดส่วน | |
| `customer.contact_id` | TRCloud contact id | search-before-create by tax_id | คงเดิม |
| `customer.group_code` | `S` (Supplier) | hardcode | คงเดิม |

### 3.3 VAT Inclusive Calculation (tax_option=in)

เมื่อ tax_option=in หมายความว่า **ยอดที่ส่งเป็นยอดรวม VAT แล้ว** TRCloud จะคำนวณ VAT ย้อนกลับเอง:

```
ยอดที่ส่ง = expense.total (รวม VAT แล้ว)
price ต่อบรรทัด = amount (รวม VAT แล้ว) / qty
vat ต่อบรรทัด = กระจายตามสัดส่วน (ยอดรวม = expense.vat)
```

> ⚠️ **CFO Warning:** การเปลี่ยนจาก tax_option=ex → in ต้องทำพร้อมกับเปลี่ยน price calculation ทั้งหมด มิฉะนั้น TRCloud จะบันทึกยอดเกิน 7%

---

## 4. ผังบัญชีและ SKU Taxonomy

### 4.1 SKU 3 ตัว (Fixed — ห้ามเพิ่ม)

| SKU Code | ชื่อใน TRCloud | ใช้กับ | status TRCloud |
|---|---|---|---|
| **JPS-100** | ซื้อสินค้าทั่วไป | สินค้า วัสดุ ของที่จับต้องได้ (consumables) | 0 = Service (ไม่นับ stock) |
| **JPS-101** | ซื้อบริการ | ค่าไฟ ค่าน้ำ ค่าโทรศัพท์ ค่าเช่า ค่าจ้าง บริการทุกชนิด | 0 = Service |
| **JPS-103** | วัสดุก่อสร้าง/ต่อเติม | วัสดุก่อสร้าง งานซ่อม งานต่อเติม | 0 = Service |

**กฎการใช้ SKU:**
- ตรวจว่า SKU มีอยู่จริงใน TRCloud company 45 ก่อน → ถ้าไม่เจอ throw error (ห้าม auto-create)
- รายละเอียดค่าใช้จ่ายจริงใส่ใน field `product` (description) ไม่ใช่ใน SKU
- ตัวอย่าง: ค่าไฟ AMAZON → SKU=JPS-101, description="ค่าไฟฟ้า สาขาเทศบาลจักราช ก.ค. 67"

### 4.2 ผังบัญชี (GL Chart of Accounts) — ยืนยันโดยนักบัญชี JP Sync

| หมวดค่าใช้จ่าย | รหัส GL | SKU | VAT ขอคืน? | WHT | หมายเหตุบัญชี |
|---|---|---|---|---|---|
| ค่าโทรศัพท์ | 5220010 | JPS-101 | ✅ ได้ | — | |
| ค่าอินเทอร์เน็ต | 5220021 | JPS-101 | ✅ ได้ | — | |
| ค่าไฟฟ้า | 5220020 | JPS-101 | ✅ ได้ | — | |
| ค่าน้ำประปา | 5220030 | JPS-101 | ✅ ได้ | — | |
| ค่าน้ำมันยานพาหนะ | 5210470 | JPS-101 | ⚠️ ขึ้นอยู่กับประเภทรถ | — | รถยนต์นั่ง ≤10 ที่นั่ง = ขอคืนไม่ได้ |
| ค่าเดินทาง | 5210070 | JPS-101 | ✅ ได้ | — | |
| ค่าโฆษณา/การตลาด | 5200500 | JPS-101 | ✅ ได้ | 2% | ออก ภ.ง.ด.3 |
| ค่าเช่าสำนักงาน | 5210360 | JPS-101 | ❌ ไม่ได้ | 5% | ส่วนใหญ่บุคคลธรรมดาให้เช่า = ไม่มี VAT + ออก ภ.ง.ด.1 |
| ค่าเช่ายานพาหนะ | 5210365 | JPS-101 | ✅ ได้ | 5% | |
| ค่าซ่อมบำรุง | 5210330 | JPS-101 หรือ JPS-103 | ✅ ได้ | 3% | ใช้ JPS-103 ถ้าเป็นงานโครงสร้าง |
| วัสดุสิ้นเปลือง | 5210310 | JPS-100 | ✅ ได้ | — | |
| เครื่องเขียน/อุปกรณ์สำนักงาน | 5210320 | JPS-100 | ✅ ได้ | — | |
| วัสดุก่อสร้าง | 5210350 | JPS-103 | ✅ ได้ | — | |
| ค่าจ้าง/บริการทั่วไป | 5210430 | JPS-101 | ✅ ได้ | 3% | ออก ภ.ง.ด.53 (นิติบุคคล) / ภ.ง.ด.3 (บุคคล) |
| ค่าทำบัญชี | 5210180 | JPS-101 | ✅ ได้ | 3% | ออก ภ.ง.ด.53 |
| ค่าสอบบัญชี | 5210190 | JPS-101 | ✅ ได้ | 3% | ออก ภ.ง.ด.53 |
| ค่าที่ปรึกษา | 5210290 | JPS-101 | ✅ ได้ | 3% | ออก ภ.ง.ด.53 หรือ ภ.ง.ด.3 |
| ค่าธรรมเนียมธนาคาร | 5210220 | JPS-101 | ❌ ไม่มี VAT | — | ธนาคารได้รับยกเว้น VAT |
| ภาษีป้าย | 5210270 | JPS-101 | ❌ ไม่มี VAT | — | ภาษีหน่วยงานรัฐ ไม่มี VAT |
| ค่ารับรอง | 5901200 | JPS-101 | ❌ ห้ามขอคืนเด็ดขาด | — | กฎหมาย ม.65 ตรี (10) ห้ามหักต้นทุน+ห้ามขอ VAT เกิน 0.3% รายได้ |
| ค่าใช้จ่ายเบ็ดเตล็ด | 5210450 | JPS-101 | ⚠️ พิจารณาแต่ละรายการ | — | ใช้เป็น fallback รอนักบัญชีจัดหมวด |

### 4.3 GL พิเศษ (ไม่ใช้เป็น default หมวด)

| รหัส GL | ชื่อบัญชี | ใช้เมื่อ |
|---|---|---|
| 5911100 | ภาษีซื้อไม่ขอคืน | VAT ที่ขอคืนไม่ได้ (ค่ารับรอง, ค่าเช่าสำนักงาน, ฯลฯ) → TRCloud จัดการอัตโนมัติ |
| 5919999 | รายจ่ายยังไม่แยกประเภท | fallback ชั่วคราว รอนักบัญชีจัดหมวด |
| 1432000 | ภาษีซื้อ | Input VAT ขอคืนได้ → TRCloud จัดการอัตโนมัติ |
| 2101000 | เจ้าหนี้การค้า | AP Payable → TRCloud จัดการอัตโนมัติ |

> 💡 **CFO Note:** GL 5911100 และ 1432000 ไม่ต้องส่งตรง — TRCloud จะ route ให้อัตโนมัติตาม `inputVatClaimable` flag ที่ส่งผ่าน `tax_report` field

---

## 5. Department → Project Mapping (ทุก 31 สาขา)

### 5.1 หลักการสำคัญ

> **แผนก (Department) ใน TRCloud = นิติบุคคล (legal entity + VAT branch)** ไม่ใช่ประเภทธุรกิจ
> **โปรเจกต์ (Project) ใน TRCloud = สาขาจริง** เช่น AMAZON-001, SNOWDIP-002

การบันทึกค่าใช้จ่ายต้องระบุ **ทั้งคู่** เพื่อให้งบกำไรขาดทุนแยกตามนิติบุคคลและตามสาขาได้

### 5.2 Mapping Table ครบทุกสาขา

| LedgerLine Branch | TRCloud Project | TRCloud Department | นิติบุคคล |
|---|---|---|---|
| AMAZON จักราช (สาขาเทศบาล) | AMAZON-001-สาขาเทศบาลจักราช | JPS_00001 | บจก.เจพีซิงค์ สาขา 1 |
| AMAZON หัวทะเล | ANAZON-002-สาขาชุมชนหัวทะเล | JPS_00005 | บจก.เจพีซิงค์ สาขา 5 |
| PUNTHAI โคกสูง 2 | PUNTHAI-001-สาขาโคกสูง 2 | VEDIK_00002 | บจก.วีดิคเอ็นเทอร์ไพร์ สาขา 2 |
| SNOWDIP แคนดง | SNOWDIP-001-สาขา ปตท.แคนดง | JPS_00000 | บจก.เจพีซิงค์ สนง.ใหญ่ |
| SNOWDIP ตลาดแค | SNOWDIP-002-สาขา ปตท.ตลาดแค | JPS_00002 | บจก.เจพีซิงค์ สาขา 2 |
| Swensens โนนคอย | Swen-001-สาขา ปตท.โนนคอย จักราช | JPS_00004 | บจก.เจพีซิงค์ สาขา 4 |
| OWL CHA โนนคอย | OWLCHA-001 ปตท.โนนคอย | JPS_00000 | บจก.เจพีซิงค์ สนง.ใหญ่ |
| OWL CHA ชุมพวง | OWLCHA-002 ปตท.ชุมพวง | JPS_00000 | บจก.เจพีซิงค์ สนง.ใหญ่ |
| OWL CHA พิมาย | OWLCHA-003 ปตท.พิมาย | JPS_00000 | บจก.เจพีซิงค์ สนง.ใหญ่ |
| OWL CHA ลำทะเมนชัย | OWLCHA-004 ปตท.ลำทะเมนชัย | JPS_00000 | บจก.เจพีซิงค์ สนง.ใหญ่ |
| OWL CHA รังกาใหญ่ | OWLCHA-005 ปตท.รังกาใหญ่ | JPS_00000 | บจก.เจพีซิงค์ สนง.ใหญ่ |
| MR.WOOF โนนแดง | MRWOOF-001-สาขา ปตท.โนนแดง | JPS_00000 | บจก.เจพีซิงค์ สนง.ใหญ่ |
| DOLL ชุมพวง | DOLL-000 ปตท.ชุมพวง | JPS_00000 | บจก.เจพีซิงค์ สนง.ใหญ่ |
| DOLL แคนดง | DOLL-001 ปตท.แคนดง | JPS_00000 | บจก.เจพีซิงค์ สนง.ใหญ่ |
| DOLL ลำทะเมนชัย | DOLL-002 ปตท.ลำทะเมนชัย | JPS_00000 | บจก.เจพีซิงค์ สนง.ใหญ่ |
| DOLL โนนคอย | DOLL-003 ปตท.โนนคอย | JPS_00000 | บจก.เจพีซิงค์ สนง.ใหญ่ |
| DOLL โนนแดง | DOLL-004 ปตท.โนนแดง | JPS_00000 | บจก.เจพีซิงค์ สนง.ใหญ่ |
| DOLL เมืองยาง | DOLL-005 ปตท.เมืองยาง | JPS_00000 | บจก.เจพีซิงค์ สนง.ใหญ่ |
| DOLL ประทาย | DOLL-006 ปตท.ประทาย | JPS_00000 | บจก.เจพีซิงค์ สนง.ใหญ่ |
| DOLL เก็บรายวัน | DOLL-008 เก็บรายวัน | JPS_00000 | บจก.เจพีซิงค์ สนง.ใหญ่ |
| DOLL ต่างอำเภอ | DOLL-009 ต่างอำเภอ | JPS_00000 | บจก.เจพีซิงค์ สนง.ใหญ่ |
| DOLL รายสัปดาห์ | DOLL-010 รายสัปดาห์ | JPS_00000 | บจก.เจพีซิงค์ สนง.ใหญ่ |
| Hotel MIX | Hotel_001-โรงแรม MIX | JPS_00003 | บจก.เจพีซิงค์ สาขา 3 |
| Massage Chair | Massage Chair | JPS_00000 | บจก.เจพีซิงค์ สนง.ใหญ่ |
| ลูกชิ้นไจ้แอน จักราช | ลูกชิ้นไจ้แอน-จักราช | JPS_00000 | บจก.เจพีซิงค์ สนง.ใหญ่ |
| ลูกชิ้นไจ้แอน ชุมพวง | ลูกชิ้นไจ้แอน-ชุมพวง | JPS_00000 | บจก.เจพีซิงค์ สนง.ใหญ่ |
| ลูกชิ้นไจ้แอน ตลาดแค 1 | ลูกชิ้นไจ้แอน-ตลาดแค1 | JPS_00002 | บจก.เจพีซิงค์ สาขา 2 |
| ลูกชิ้นไจ้แอน ตลาดแค 2 | ลูกชิ้นไจ้แอน-ตลาดแค2 | JPS_00002 | บจก.เจพีซิงค์ สาขา 2 |
| ลูกชิ้นไจ้แอน โนนแดง | ลูกชิ้นไจ้แอน-โนนแดง | JPS_00000 | บจก.เจพีซิงค์ สนง.ใหญ่ |
| 62 STATION หลังโลตัส | 62 STATION-001-หลังโลตัส | YMP_00002 | บจก.ยายเอ็มพลัส สาขา 2 |
| B-0001 พื้นที่ให้เช่า | B-0001-พื้นที่ให้เช่า | JPS_00000 | บจก.เจพีซิงค์ สนง.ใหญ่ |
| สำนักงานกลาง | (ไม่มี project) | JPS_00000 | บจก.เจพีซิงค์ สนง.ใหญ่ |

### 5.3 สาขาที่ไม่อยู่ใน Scope (Skip)

| สาขา | เหตุผล |
|---|---|
| PATIPAN | บัญชีส่วนตัว ไม่ใช่บัญชีนิติบุคคล |
| JANELILTA | บัญชีส่วนตัว ไม่ใช่บัญชีนิติบุคคล |
| LWP_00001 | อนาคต — ยังไม่เปิดใช้งาน |

---

## 6. Validation Rules (บล็อก Push ถ้า Fails)

ทุก rule ต้องผ่านก่อนส่ง AP เข้า TRCloud — ถ้า fail ใด fail หนึ่ง = throw error ชัดเจน + หยุด

| # | Rule | ตรวจยังไง | Error Message |
|---|---|---|---|
| V1 | **SKU ต้องมีอยู่จริงใน TRCloud** | อ่าน inventory/list → ตรวจ JPS-100/101/103 ใน company 45 | "SKU [X] ไม่พบใน TRCloud company 45 — แจ้งนักบัญชีเพิ่ม SKU ก่อน" |
| V2 | **หมวดต้องมี GL code** | LedgerCategory.trcloudAccCode ≠ null | "หมวด [X] ยังไม่ตั้งรหัสบัญชี — ไปที่ Settings → หมวดค่าใช้จ่าย" |
| V3 | **สาขาต้องมี TRCloud Project** | Branch.trcloudProject (settings JSON หรือ column) ≠ null | "สาขา [X] ยังไม่ตั้งค่าโปรเจกต์ TRCloud — ไปที่ Settings → สาขา" |
| V4 | **สาขาต้องมี TRCloud Department** | Branch.trcloudDept ≠ null | "สาขา [X] ยังไม่ตั้งค่าแผนกนิติบุคคล — ไปที่ Settings → สาขา" |
| V5 | **company_id = 45 เท่านั้น** | env TRCLOUD_COMPANY_ID = "45" | "company_id ผิด — ตั้ง env TRCLOUD_COMPANY_ID=45 ใน Vercel" |

**กฎเสริม (ไม่บล็อก แต่ warning):**

| # | Warning | เหตุผล |
|---|---|---|
| W1 | ค่าน้ำมัน (GL 5210470) + inputVatClaimable=true | เตือนให้ตรวจว่าเป็นรถกระบะ/รถบรรทุก (ขอคืนได้) หรือรถยนต์นั่ง (ขอคืนไม่ได้) |
| W2 | ค่าเบ็ดเตล็ด (GL 5210450) | เตือนให้นักบัญชีตรวจสอบว่าควรจัดหมวดให้ถูกก่อน |
| W3 | wht > 0 แต่ไม่มี vendorTaxId | เตือนว่า WHT ต้องมีเลขผู้เสียภาษีผู้รับจ้างเพื่อออกหนังสือรับรอง |

---

## 7. Feature Spec — Must / Should / Could

### MUST (ต้องมีก่อน Go-Live)

#### M1 — เปลี่ยน company + format + tax_option
- `lib/ledger/trcloud-push.ts` line 24-27: เปลี่ยน defaults
  - `COMPANY_ID` default จาก "" → validate เป็น "45"
  - `AP_TYPE_CASH` = "Cash[AP]" (คงเดิม)
  - เพิ่ม constant `AP_COMPANY_FORMAT = process.env.TRCLOUD_COMPANY_FORMAT ?? "JPS_AP"`
  - เพิ่ม constant `AP_TAX_OPTION = process.env.TRCLOUD_TAX_OPTION ?? "in"`
- payload line 388-395: ส่ง `company_format: AP_COMPANY_FORMAT` + `tax_option: AP_TAX_OPTION`
- ยืนยัน: env TRCLOUD_COMPANY_ID=45, TRCLOUD_COMPANY_FORMAT=JPS_AP ใน Vercel

#### M2 — ฆ่า path ปั๊ม SKU "LDG+sha1" ทั้งหมด
- `lib/ledger/trcloud-push.ts`:
  - ลบ `productCodeFor()` ออก
  - ลบ `createInventory()` ออก
  - ลบ `searchInventoryByName()` ออก
  - rewrite `resolveProductId()` → รับ `trcloudProductCode: string | null` จาก LedgerCategory → return ทันทีถ้า JPS-100/101/103 · throw error ถ้า null
- `app/(admin)/ledger/_actions.ts`: `loadPushable()` select `category.trcloudProductCode` ด้วย
- ล้างแถว `LDG*` ใน table `ledger_trcloud_product` (migration หรือ one-time SQL script)

#### M3 — เพิ่ม trcloudProductCode ใน LedgerCategory
- **Migration:** เพิ่มคอลัมน์ `trcloud_product_code VARCHAR(50) NULL` ใน `ledger_category`
- **Schema:** `LedgerCategory.trcloudProductCode String? @map("trcloud_product_code")`
- **Settings UI:** `CategoryManager.tsx` — เพิ่ม dropdown SKU 3 ตัว (JPS-100/101/103) ต่อหมวด
- **Action:** `createCategory/updateCategory` persist `trcloudProductCode`

#### M4 — เพิ่ม trcloudProject + trcloudDept ใน Branch
- เลือก implementation: `Branch.settings` JSON (ไม่ต้อง migration) หรือคอลัมน์แยก (migration)
  - **แนะนำ:** ใช้ `settings` JSON key `trcloudProject` + `trcloudDept` → ไม่ต้อง migration, ไม่กระทบโมดูลอื่น
- **Settings UI:** `GroupBranchManager.tsx` — เพิ่ม field "โปรเจกต์ TRCloud" + "แผนกนิติบุคคล" ต่อสาขา (dropdown ค่าจาก mapping table §5)
- **loadPushable():** select `branch.settings` หรือคอลัมน์ใหม่ → ส่งเป็น `trcloudProject` + `trcloudDept` ใน `PushableExpense`

#### M5 — ส่ง project + department ใน AP payload
- `lib/ledger/trcloud-push.ts` payload block: เพิ่ม `project: e.trcloudProject` + `department: e.trcloudDept` (ถ้ามีค่า)
- ถ้า branch.trcloudProject = null → throw error V3 (บล็อก)
- ถ้า branch.trcloudDept = null → throw error V4 (บล็อก)

#### M6 — ส่ง acc_code รายบรรทัด
- `lib/ledger/trcloud-push.ts` ใน `buildLines()` → เพิ่ม `acc_code: e.categoryAccCode` ต่อทุก line
- **ข้อควรระวัง:** ต้องทดสอบว่า TRCloud รับ `acc_code` รายบรรทัดใน `product[]` จริงหรือไม่ — ถ้าไม่รับ ให้ส่ง `acc_code` ระดับ header แทน

#### M7 — ต่อ inputVatClaimable → tax_report
- `PushableExpense` type: เพิ่ม `inputVatClaimable: boolean | null`
- `loadPushable()`: select `expense.inputVatClaimable`
- payload: `tax_report: e.inputVatClaimable === false ? "0" : "1"` (เลิก hardcode "1")
- ผลลัพธ์: ค่ารับรอง/ค่าเช่าสำนักงาน/ค่าธรรมเนียมธนาคาร → ไม่เข้า ภ.พ.30

#### M8 — 5 Validation Rules ก่อน push
- ใน `sendExpenseToTrcloud()` และ `sendExpensesToTrcloud()` เพิ่ม preflight check V1-V5
- V1 ตรวจ SKU: อ่าน cache ก่อน → ถ้าไม่มีใน cache อ่าน inventory/list จาก TRCloud ครั้งเดียวตอนตั้งค่า
- V2-V4 ตรวจ local fields

#### M9 — Test run 1 ใบก่อน Go-Live
- ยิง AP 1 ใบ sandbox หรือ company 45 ด้วย product_id=JPS-101 + department=JPS_00001 + project=AMAZON-001
- ยืนยัน: TRCloud รับ acc_code รายบรรทัด / project / department ครบ
- ยืนยัน: ยอด Dr/Cr ถูกต้อง (tax_option=in ไม่บวม)

### SHOULD (ทำหลัง Must ผ่าน)

#### S1 — Validator UI ตอนตั้งค่า
- หน้า Settings → ปุ่ม "ทดสอบการเชื่อมต่อ TRCloud" → เรียก inventory/list + department/list → แสดง checkmarks เขียว/แดงรายหมวด+รายสาขา
- ช่วยแอดมินจับ misconfiguration ก่อน push จริง

#### S2 — Snapshot 3 ค่าตอน Confirm
- ตอนนักบัญชียืนยัน expense (status → confirmed) → snapshot `trcloudProductCode` + `trcloudAccCode` + `trcloudProject` + `trcloudDept` ลงบน LedgerExpense
- ป้องกัน race condition: แก้ category/branch settings ภายหลัง ≠ กระทบใบที่ push ไปแล้ว
- Migration: เพิ่ม 4 คอลัมน์ snapshot บน `ledger_expense` (nullable)

#### S3 — Staff-Branch Assignment (เพิ่ม Scope Filter)
- แอดมินกำหนด "user นี้ดูแลสาขาไหนบ้าง" ใน `ledger_line_member.scopeBranchIds`
- ตอน staff upload ใบเสร็จบนมือถือ → picker แสดงเฉพาะสาขาที่ตัวเองดูแล
- ถ้ามีสาขาเดียว → auto-select ไม่ต้องเลือก

#### S4 — รายงาน Reconcile ใบเก่า
- หน้า /ledger/settings → แสดง summary: "ใบที่ยังไม่มี GL: X ใบ", "ใบที่สาขายังไม่ map: Y ใบ", "ใบที่ push ด้วย LDG*: Z ใบ"
- export CSV ให้นักบัญชีตรวจ

### COULD (ทำเมื่อมีเวลา — ไม่บล็อก Go-Live)

- ป้ายเตือนบนจอ confirm มือถือ เมื่อสาขาตกเป็น "สำนักงานกลาง" (อาจ map ผิด)
- คอลัมน์จริง `Branch.trcloudDeptCode` แทน settings JSON (migration)
- บัญชีพัก GL 5919999 สำหรับหมวดที่ยังไม่ map (แทนบล็อก)
- Auto-rollout department รายสาขา (omit ถ้ายังไม่ map → push ได้แต่ไม่มี dept)

### WON'T (ไม่ทำชัดเจน)

- Model A (SKU ต่อหมวด ชุดซ้อน) — ปฏิเสธ ผู้สอบบัญชีเห็น 2 ระบบ SKU = ปัญหา
- สร้าง LedgerBranch / ผังบัญชีใน LedgerLine — บ้านของผังบัญชีคือ TRCloud
- สคริปต์ลบ/แก้ AP เก่าอัตโนมัติ — แตะสมุดบัญชีที่อาจมีหน่วยงานอื่นใช้ร่วม
- Auto-post TRCloud — human approval required ทุกใบ
- แตะ stock ขาย (status=1) — LedgerLine ไม่ใช่ระบบ inventory

---

## 8. ความเสี่ยงและ Edge Cases (Top 5)

### R1 — VAT Claim Error จาก tax_option=in ผิด [ความเสี่ยง: สูงมาก]

**สถานการณ์:** ถ้า push ด้วย tax_option=ex แล้วแก้เป็น in โดยไม่แก้ price calculation → ยอด AP ใน TRCloud = ยอดรวม VAT + TRCloud คำนวณ VAT ซ้อนอีก 7% → บันทึกค่าใช้จ่ายสูงกว่าความจริง 7%

**กฎบัญชี:** ม.82/3 ผู้ประกอบการ VAT ต้องออก tax invoice ด้วยยอดที่ถูกต้อง — บันทึกผิดอาจถูกสรรพากรประเมินเพิ่ม

**วิธีป้องกัน:**
- Test 1 ใบก่อน Go-Live (M9) — ตรวจ Dr/Cr ใน TRCloud ว่ายอดตรงกับใบเสร็จจริง
- เขียน unit test: ใบ 214.95 บาท (VAT รวม) → Dr ค่าใช้จ่าย = 200.90 + Dr ภาษีซื้อ = 14.05 + Cr เจ้าหนี้ = 214.95

### R2 — Wrong Legal Entity = ค่าใช้จ่ายผิดนิติบุคคล [ความเสี่ยง: สูง]

**สถานการณ์:** สาขา AMAZON จักราช ใช้ department=JPS_00000 (สนง.ใหญ่) แทน JPS_00001 (สาขา 1) → ค่าใช้จ่ายของ "บจก.เจพีซิงค์ สาขา 1 (Amazon)" ไปตกที่ "บจก.เจพีซิงค์ สนง.ใหญ่" → ยื่น VAT ผิดสาขา → ปัญหาสรรพากรเมื่อถูกตรวจ

**กฎบัญชี:** แต่ละสาขาแบบ "สาขาแยก" มีเลขภาษี VAT สาขาของตัวเอง → ต้องยื่น ภ.พ.30 แยกสาขา

**วิธีป้องกัน:**
- Settings UI dropdown — แสดงชื่อนิติบุคคลเต็มๆ ไม่ใช่แค่รหัส เช่น "JPS_00001 — บจก.เจพีซิงค์ สาขา 1 (AMAZON จักราช)"
- Validation: ก่อน push แสดง preview "ค่าใช้จ่ายนี้จะลงในนาม: บจก.เจพีซิงค์ สาขา 1" ให้นักบัญชียืนยัน

### R3 — ค่ารับรองและ Non-Claimable VAT หลุดเข้า ภ.พ.30 [ความเสี่ยง: สูง — ปัญหา Live อยู่]

**สถานการณ์:** ปัจจุบัน (v1) ทุกใบส่ง tax_report=1 ทุกใบ → ค่ารับรอง, ค่าเช่าสำนักงาน, ค่าธรรมเนียมธนาคาร ถูกรวมใน ภ.พ.30 ขอคืน VAT → ผิดกฎหมาย

**กฎบัญชี:** ม.82/5 ค่ารับรอง + ม.82/5(8) ค่าเช่าที่ดิน/สิ่งปลูกสร้างบุคคลธรรมดา = ห้ามขอคืน VAT → ถ้าขอคืนผิด = เสียภาษีเพิ่ม + เบี้ยปรับ + เงินเพิ่ม

**วิธีป้องกัน:** ทำ M7 — ต่อ inputVatClaimable flag ก่อน Go-Live ทุกกรณี

### R4 — Cache Poisoning จาก LDG* SKU เก่า [ความเสี่ยง: ปานกลาง]

**สถานการณ์:** table `ledger_trcloud_product` ยังมีแถว `LDG*` ค้างอยู่ → resolveProductId ใหม่ข้ามไป JPS SKU แต่ถ้า cache ถูก hit ด้วย logic เก่า → ส่ง SKU ผิดเข้า TRCloud

**วิธีป้องกัน:** ก่อน Go-Live รัน:
```sql
DELETE FROM public.ledger_trcloud_product
WHERE product_id LIKE 'LDG%';
```

### R5 — สมุดร่วม company 45 กระทบโปรเจกต์อื่น [ความเสี่ยง: ปานกลาง]

**สถานการณ์:** company 45 = JPS GROUP ใน TRCloud อาจมีการใช้งานจาก manual entries หรือโปรเจกต์อื่นในอนาคต → LedgerLine ส่ง department/project ผิดอาจปนกับข้อมูลที่มีอยู่

**วิธีป้องกัน:**
- additive-nullable fields — LedgerLine แค่เพิ่มข้อมูลลง AP ที่มี reference กลับ (`docCode`) → ตามได้
- ไม่แก้ไข/ลบ AP ที่สร้างมือ
- ทุก AP มี `invoice_note: "ระบบบัญชี (LedgerLine) · อ้างอิง EXP-..."` → แยกออกจาก manual ได้

---

## 9. Technical Build Plan

### 9.1 Files to Change

| ไฟล์ | การเปลี่ยนแปลง | ขนาดงาน |
|---|---|---|
| `lib/ledger/trcloud-push.ts` | rewrite resolveProductId · ลบ LDG path · เพิ่ม project/dept/acc_code · เปลี่ยน company_format/tax_option/tax_report | M |
| `app/(admin)/ledger/_actions.ts` | loadPushable() select เพิ่ม fields · V1-V5 preflight · snapshot M9 | M |
| `prisma/schema.prisma` | +`LedgerCategory.trcloudProductCode` | XS |
| Migration SQL | +`ledger_category.trcloud_product_code` nullable | XS |
| `app/(admin)/ledger/settings/_components/CategoryManager.tsx` | +dropdown SKU 3 ตัว | S |
| `app/(admin)/ledger/settings/_components/GroupBranchManager.tsx` | +field branch→project + branch→dept | S |
| `lib/ledger/types.ts` | `PushableExpense`: เพิ่ม inputVatClaimable + trcloudProject + trcloudDept + trcloudProductCode | XS |
| Cleanup script | DELETE LDG* จาก ledger_trcloud_product | XS |

### 9.2 Migration Plan

**Migration: `20260606_ledger_trcloud_v2.sql`**

```sql
-- 1. เพิ่ม trcloudProductCode ใน ledger_category (additive, nullable, zero-downtime)
ALTER TABLE public.ledger_category
  ADD COLUMN IF NOT EXISTS trcloud_product_code VARCHAR(50);

COMMENT ON COLUMN public.ledger_category.trcloud_product_code
  IS 'TRCloud SKU code — 1 ใน 3 ค่า: JPS-100, JPS-101, JPS-103';

-- 2. (Optional Should-S2) Snapshot columns บน ledger_expense
ALTER TABLE public.ledger_expense
  ADD COLUMN IF NOT EXISTS trcloud_snapshot_sku       VARCHAR(50),
  ADD COLUMN IF NOT EXISTS trcloud_snapshot_gl        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS trcloud_snapshot_project   VARCHAR(200),
  ADD COLUMN IF NOT EXISTS trcloud_snapshot_dept      VARCHAR(100);

-- 3. ล้าง LDG* cache (ทำ post-migration)
DELETE FROM public.ledger_trcloud_product
WHERE product_id LIKE 'LDG%';
```

**Prisma Schema additions:**

```prisma
// ใน LedgerCategory
trcloudProductCode String? @map("trcloud_product_code") // JPS-100 / JPS-101 / JPS-103

// ใน LedgerExpense (Should S2)
trcloudSnapshotSku      String? @map("trcloud_snapshot_sku")
trcloudSnapshotGl       String? @map("trcloud_snapshot_gl")
trcloudSnapshotProject  String? @map("trcloud_snapshot_project")
trcloudSnapshotDept     String? @map("trcloud_snapshot_dept")
```

### 9.3 Branch Department/Project Storage

ใช้ `Branch.settings` JSON (ไม่ต้อง migration เพิ่ม) — เก็บ key:

```json
{
  "trcloudProject": "AMAZON-001-สาขาเทศบาลจักราช",
  "trcloudDept": "JPS_00001"
}
```

อ่านใน loadPushable():
```typescript
const branchSettings = row.branch?.settings as Record<string, string> | null;
const trcloudProject = branchSettings?.trcloudProject ?? null;
const trcloudDept = branchSettings?.trcloudDept ?? null;
```

### 9.4 Env Variables ที่ต้องตั้งใน Vercel

| Variable | ค่าสำหรับ JPS GROUP | หมายเหตุ |
|---|---|---|
| `TRCLOUD_COMPANY_ID` | `45` | **เปลี่ยนจาก 31** |
| `TRCLOUD_COMPANY_FORMAT` | `JPS_AP` | ใหม่ |
| `TRCLOUD_TAX_OPTION` | `in` | ใหม่ |
| `TRCLOUD_BASE` | `https://pooil.trcloud.co/application/api-connector2/end-point` | คงเดิม |
| `TRCLOUD_ORIGIN` | `https://pooil.trcloud.co` | คงเดิม |
| `TRCLOUD_PASSKEY` | (จาก TRCloud company 45) | ตรวจว่า passkey ตรงกับ company 45 |
| `TRCLOUD_ENCRYPT_HEAD` | (จาก TRCloud company 45) | ตรวจว่า encrypt_head ตรงกับ company 45 |
| `TRCLOUD_APPROVE_ID` | ถามนักบัญชีว่า approve_id ของ company 45 = อะไร | อาจต่างจาก company 31 |

> ⚠️ **สำคัญ:** TRCLOUD_PASSKEY + TRCLOUD_ENCRYPT_HEAD ของ company 45 อาจต่างจาก company 31 — ต้องขอจาก TRCloud admin ก่อน deploy

---

## 10. กฎการ Deploy (ต้องทำก่อน Go-Live ตามลำดับ)

### Phase 1 — Prepare (ก่อน push code)

```
[ ] 1. ขอ credentials TRCloud company 45 จาก TRCloud admin:
       - company_id = 45
       - passkey
       - encrypt_head
       - approve_id

[ ] 2. ยืนยัน SKU JPS-100/101/103 มีอยู่ใน company 45:
       POST inventory/list → ค้นหา "JPS-100", "JPS-101", "JPS-103"
       ถ้าไม่มี → ให้นักบัญชีสร้างใน TRCloud ก่อน (ห้ามสร้างผ่านโค้ด)

[ ] 3. ยืนยัน department codes JPS_00000–JPS_00005 + VEDIK_00002 + YMP_00002 มีอยู่:
       POST department/list → ตรวจทุกรหัส
       ถ้าไม่มี → ให้นักบัญชีสร้างใน TRCloud ก่อน

[ ] 4. แจ้ง CEO update env ใน Vercel:
       TRCLOUD_COMPANY_ID=45
       TRCLOUD_COMPANY_FORMAT=JPS_AP
       TRCLOUD_TAX_OPTION=in
       TRCLOUD_PASSKEY=[ค่าใหม่จาก company 45]
       TRCLOUD_ENCRYPT_HEAD=[ค่าใหม่จาก company 45]
       TRCLOUD_APPROVE_ID=[ถามนักบัญชี]
```

### Phase 2 — Migration (apply ก่อน deploy code เสมอ)

```
[ ] 5. Apply migration 20260606_ledger_trcloud_v2.sql ลง production DB:
       → psql production URL → รัน migration
       → ตรวจว่าคอลัมน์ trcloud_product_code มีอยู่ใน ledger_category
       → ตรวจว่า ledger_trcloud_product ไม่มีแถว LDG* แล้ว

[ ] 6. ตั้งค่า Categories ใน /ledger/settings:
       → ทุกหมวดค่าใช้จ่ายต้องมี trcloudProductCode (JPS-100/101/103)
       → ทุกหมวดต้องมี trcloudAccCode (GL code)
       → ใช้ตารางผังบัญชีใน §4 เป็น reference

[ ] 7. ตั้งค่า Branches ใน /ledger/settings:
       → ทุกสาขาที่ใช้งานต้องมี trcloudProject + trcloudDept
       → ใช้ mapping table ใน §5 เป็น reference
```

### Phase 3 — Deploy Code

```
[ ] 8. Deploy code บน branch tax-invoice → merge to setup → Vercel deploy

[ ] 9. ยิง Test 1 ใบ (sandbox หรือ AP จริง 1 ใบ):
       - เลือก expense ที่ยืนยันแล้ว (AMAZON จักราช ค่าไฟ ยอดเล็ก)
       - กด "ส่งเข้า TRCloud"
       - เข้า TRCloud → ดู AP ใหม่ → ตรวจ:
         ✓ company = JPS GROUP (ไม่ใช่ Pooil Oil หรือ company อื่น)
         ✓ project = AMAZON-001-สาขาเทศบาลจักราช
         ✓ department = JPS_00001
         ✓ product line: SKU = JPS-101, acc_code = 5220020
         ✓ tax_option = in (ยอด Dr/Cr รวม = ยอดบนใบเสร็จ ไม่บวม)
         ✓ approve_status = รอตรวจสอบ
         ✓ invoice_note มี "ระบบบัญชี (LedgerLine)"
       - ถ้าผ่านทุกข้อ → proceed
       - ถ้าไม่ผ่าน → หยุด + แจ้งทีมก่อน
```

### Phase 4 — Rollout

```
[ ] 10. Rollout แบบ "สาขาต่อสาขา":
        - เริ่มที่ AMAZON จักราช 1 สาขาก่อน (1 สัปดาห์)
        - ตรวจ ภ.พ.30 ว่าค่าไม่ขอคืนไม่ปนเข้า
        - ขยายไปทุกสาขาเมื่อมั่นใจ

[ ] 11. แจ้งนักบัญชีว่าต้องทำอะไรต่างกัน:
        - AP ใหม่จาก LedgerLine อยู่ใน status "รอตรวจสอบ" เสมอ
        - ตรวจแล้ว approve ใน TRCloud ก่อน TRCloud จะ post Dr/Cr
        - ถ้าเจอ AP ผิดอย่าลบ — แจ้ง admin LedgerLine void แล้ว push ใหม่
```

---

## A. ภาคผนวก — ตัวอย่าง Dr/Cr รายหมวด (สำหรับนักบัญชีตรวจสอบ)

### ตัวอย่าง 1: ค่าไฟสาขา AMAZON จักราช 214.95 บาท (VAT รวม)

```
AP Header:
  company_format = JPS_AP · company_id = 45
  project = AMAZON-001-สาขาเทศบาลจักราช
  department = JPS_00001
  type = Cash[AP] · tax_option = in · tax_report = 1

AP Line:
  product_id = JPS-101 · product = "ค่าไฟฟ้า สาขาเทศบาลจักราช ก.ค. 67"
  price = 214.95 · qty = 1 · vat = 14.05 (=214.95×7/107) · acc_code = 5220020

TRCloud Post Dr/Cr:
  Dr 5220020 ค่าไฟฟ้า             200.90
  Dr 1432000 ภาษีซื้อ              14.05
  Cr 2101000 เจ้าหนี้             214.95
```

### ตัวอย่าง 2: ค่าเช่าสำนักงาน 5,000 บาท (ไม่มี VAT, WHT 5%)

```
AP Header:
  tax_report = 0 (inputVatClaimable = false)
  type = Cash[AP]

AP Line:
  product_id = JPS-101 · product = "ค่าเช่าสำนักงาน เดือน ก.ค. 67"
  price = 5,000 · qty = 1 · vat = 0 · acc_code = 5210360
  wht = 250 (5% ของ 5,000)

TRCloud Post Dr/Cr:
  Dr 5210360 ค่าเช่าสำนักงาน    5,000.00
  Cr 2101000 เจ้าหนี้           4,750.00
  Cr ภ.ง.ด.1 (WHT payable)       250.00
```

### ตัวอย่าง 3: ค่ารับรอง 3,214 บาท (VAT รวม แต่ขอคืนไม่ได้เด็ดขาด)

```
AP Header:
  tax_report = 0 (inputVatClaimable = false เด็ดขาด)

AP Line:
  product_id = JPS-101 · product = "ค่ารับรอง"
  price = 3,214 · qty = 1 · vat = 210.50 · acc_code = 5901200

TRCloud Post Dr/Cr:
  Dr 5901200 ค่ารับรอง           3,003.50
  Dr 5911100 ภาษีซื้อไม่ขอคืน     210.50
  Cr 2101000 เจ้าหนี้           3,214.00
```

---

*เอกสารนี้สร้างโดยระบบ LedgerLine · ข้อมูลบัญชีรับรองโดยนักบัญชี JP Sync Group · อัปเดต 2026-06-06*
*ห้ามแก้ไข GL code, SKU หรือ department mapping โดยไม่ปรึกษาสำนักงานบัญชี*
