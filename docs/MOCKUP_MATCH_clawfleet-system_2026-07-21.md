# Mockup-Match · ClawFleet ระบบตู้คีบ (full system) · 2026-07-21

Mockup: claude.ai/design `1050db4c-e115-4416-ae74-0428994b8ac7` → `ระบบตู้คีบ.dc.html`
Inventory: 5-agent ultracode workflow · **124 rows · 37 💰money · 62 🆕new-feature**
Legend: look/func = ตรง/ต่าง/ขาด/เกิน · 💰=แตะเงิน · 🆕=ฟีเจอร์ใหม่(ไม่ใช่ reskin)

## หลังบ้าน · รายงานตู้ 7-11 (screen 711)
18 rows · 💰2 · 🆕18

| ID | จอ | องค์ประกอบ | mockup | ของจริง | 👁️ | ⚙️ | 💰 | 🆕 |
|---|---|---|---|---|---|---|---|---|
| BO711-01 | ทั้งหน้า (data mod | หน้าเฉพาะ 'ตู้ 7-11' (fleet) | LOOK: หน้าย่อยใน DC OS แสดงตู้ที่ตั้งในร้าน 7-11 แต่ละสาขา · ตู้แต่ละตัวผูกกับรห | ไม่มี — grep 7-11/711/fleet ใน app/(admin)/clawfleet/os | ขาด | ขาด |  | 🆕 |
| BO711-02 | ทั้งหน้า | แท็บสลับ รายตู้ / รายงานสรุป | LOOK: pill 2 ปุ่มในกล่องขาว border #E8EAED radius12 padding4 margin-bottom18; ปุ | ไม่มี — matrix-client มี view toggle (ตู้×วัน/สาขา×วัน  | ขาด | ขาด |  | 🆕 |
| BO711-03 | Fleet (รายตู้) | การ์ด KPI 4 ใบ (ตู้ทั้งหมด/ร | LOOK: grid 4 คอลัมน์ gap14 mb18; การ์ด bg#fff border#E8EAED radius14 padding 15x | pattern มีอยู่: dashboard-client.tsx ใช้ Kpi component  | ขาด | ขาด |  | 🆕 |
| BO711-04 | Fleet (รายตู้) | Toolbar: ช่องค้นหา + ตัวเลือ | LOOK: แถบ padding 14x20 border-bottom #F0F1F4 flex gap12. ช่องค้นหา flex:1 max-w | ไม่มี toolbar ค้นหา/ช่วงวันสำหรับ fleet 7-11; matrix-cl | ขาด | ขาด |  | 🆕 |
| BO711-05 | Fleet (รายตู้) | หัวตาราง fleet 9 คอลัมน์ | LOOK: grid-template 0.6fr 1.25fr 0.8fr 0.7fr 0.8fr 0.8fr 0.7fr 0.7fr 0.9fr; padd | ไม่มี — ตารางตู้ใน branches/stock-client คนละ schema (ไ | ขาด | ขาด |  | 🆕 |
| BO711-06 | Fleet (รายตู้) | แถวตู้ (fleet rows ×10) คลิก | LOOK: class rowh, grid เดียวกับ header, padding 13x20 border-bottom#F4F5F7 curso | branches-client.tsx มีแถวตู้คลิกเปิด detail; stock/mach | ขาด | ขาด |  | 🆕 |
| BO711-07 | Fleet (รายตู้) | Badge สถานะตู้ (ปกติ/ต้องเติ | LOOK: pill inline font11 weight600 padding 3x9 radius20. ปกติ bg#E7F4EC text#158 | kit Pill + format tone มีสีระบบเดียวกัน (components/cla | ต่าง | ขาด |  | 🆕 |
| BO711-08 | Fleet (รายตู้) | Badge อัตราออก (เฉลี่ย ฿/ตัว | LOOK: pill font12 weight600 padding 2x8 radius20, สี+bg จาก bandPure(avg) (avg=r | format มี bandPure/avgWin logic (kit AvgWinBar, dashboa | ต่าง | ขาด |  | 🆕 |
| BO711-09 | Fleet (รายตู้) | Badge เงินตรง / ตุ๊กตาตรง (c | LOOK: 2 badge กลางคอลัมน์ font10.5 weight700 padding 2x8 radius20. matchBadge(ok | ไม่มีหน้าโชว์ — logic cross-check เงิน/มิเตอร์อยู่ใน co | ขาด | ขาด | 💰 | 🆕 |
| BO711-10 | Report (รายงานสรุป | Toggle รายวัน/รายเดือน (f711 | LOOK: pill 2 ปุ่มในกล่องขาว border#E8EAED radius11 padding4; active bg#4F46E5 #f | reports-client / matrix มี range toggle แต่ไม่ใช่ day/m | ขาด | ขาด |  | 🆕 |
| BO711-11 | Report (รายงานสรุป | การ์ดสรุป 3 ใบ (เก็บเงินรวม  | LOOK: grid 3 คอลัมน์ gap14 mb18. ใบแรก bg#1E2230 (เข้ม) text#fff, label rgba(255 | dashboard-client มีการ์ด KPI สรุปแต่คนละชุด/ไม่มีใบ dar | ขาด | ขาด |  | 🆕 |
| BO711-12 | Report (รายงานสรุป | ตารางสรุป transaction ต่อช่ว | LOOK: หัวข้อ 'สรุป transaction ต่อ<ช่วง>' font12 weight700 #454B54. การ์ดตาราง r | reports-client มีตาราง period/staff (l.304,368) คนละ sh | ขาด | ขาด |  | 🆕 |
| BO711-13 | Report + drill | ตารางเจาะรายตู้ต่อวันที่เลือ | LOOK: แสดงเมื่อ f711HasDrill (เลือกวันในรายวัน). หัวข้อ 'รายตู้ · <วัน> · เก็บได | ไม่มี drill รายตู้ต่อวันสำหรับ fleet; matrix cell เจาะไ | ขาด | ขาด |  | 🆕 |
| BO711-14 | Report (matrix) | Toggle metric (เงิน/ตุ๊กตาออ | LOOK: 2 กลุ่ม pill. metric bg#fff border#E8EAED radius10 padding3, active bg#4F4 | matrix-client.tsx:177 มี metric toggle (cost/cash/dolls | ต่าง | ต่าง |  | 🆕 |
| BO711-15 | Report (matrix) | ตาราง matrix ทุกตู้ × วัน/เด | LOOK: การ์ด radius14 overflow:auto. grid-template f711MxColTmpl='150px repeat(N, | matrix-client.tsx:259-362 สร้าง heatmap grid + sticky + | ต่าง | ต่าง |  | 🆕 |
| BO711-16 | Report (matrix) | คอลัมน์ 'รวม' รายตู้ (total  | LOOK: cell ขวาสุดต่อแถว bg#FBFBFE, total font12 weight800, days 'N/30' font9.5 # | matrix footer มี per-machine total (l.335-361) — patter | ต่าง | ต่าง |  | 🆕 |
| BO711-17 | Report (matrix) | แถว footer รวมต่อวัน (dark)  | LOOK: แถวล่าง bg#1E2230 text#fff. label ซ้าย sticky 'รวมเงินต่อวัน'/'ตุ๊กตาออกต่ | matrix มี footer เฉลี่ยตู้ (l.335) แต่ไม่มีแถว dark รวม | ต่าง | ต่าง |  | 🆕 |
| BO711-18 | ทั้งหน้า (write-pa | แหล่งข้อมูลจริง (ตัวเลขทุกช่ | LOOK: ตัวเลขสวยครบ. DOES: mockup เป็น prototype — fleetRaw hard-code 10 ตู้, cas | ต้องดึงจริงจาก lib/clawfleet: pnl-queries/matrix-querie | ขาด | ขาด | 💰 | 🆕 |

## มือถือ · ทัวร์เติมตู้ 7-11 (เบิก/เติม/คืน + เก็บเงินต่อตู้)
28 rows · 💰17 · 🆕24

| ID | จอ | องค์ประกอบ | mockup | ของจริง | 👁️ | ⚙️ | 💰 | 🆕 |
|---|---|---|---|---|---|---|---|---|
| TOUR-01 | หน้าแรก (front hom | ปุ่ม CTA ม่วง "เริ่มทัวร์เติ | LOOK: ปุ่มเต็มความกว้าง gradient linear(100deg,#4F46E5→#6D5DF0) ตัวอักษรขาว radi | ไม่มี — ถูกแทนที่ด้วยปุ่ม "ตั้งค่าตู้ใหม่" staff-app-cl | ขาด | ขาด |  | 🆕 |
| TOUR-02 | หน้าแรก (front hom | กล่อง "เก็บค้างไว้ · รอกรอกม | LOOK: หัวข้อ 13px/700 + badge นับ 11px/700 #B45309 บน #FCF1E2 pill · แบนเนอร์อธิ | มี — staff-app-client.tsx:1866-1893 (draftList, badge,  | ตรง | ตรง |  |  |
| TOUR-03 | หน้าแรก (front hom | ปุ่ม "ตั้งค่าตู้ใหม่ (ครั้งแ | LOOK: ปุ่มขาว border #E3E6EA radius13 · ไอคอน 38px #EEF0FE · หัวข้อ 13.5px/700 + | มี — staff-app-client.tsx:1854-1864 (radius14, ซับ = "ต | ต่าง | ตรง |  |  |
| TOUR-04 | หน้าแรก · ลิสต์เส้ | การ์ดตู้ในเส้นทาง + ปุ่มลัด  | LOOK: การ์ดตู้ badge code 40px, ชื่อสาขา 13.5px + zone, hint 11px · ป้ายสถานะ pi | มี — RowActionBtn staff-app-client.tsx:1948-1971 (เก็บเ | ตรง | ตรง | 💰 |  |
| TOUR-05 | ทัวร์ · แถบ pill 3 | pill "1·เบิก / 2·เติม / 3·คื | LOOK: 3 pill flex:1 fontSize11/700 padding7/4 radius8 · active=#4F46E5/ขาว, done | มี (แต่ใน panel ที่เข้าไม่ถึง) — staff-app-client.tsx:4 | ตรง | ตรง |  |  |
| TOUR-06 | ทัวร์ ขั้น1 · เบิก | แบนเนอร์อธิบายเบิก + รายการ  | LOOK: แบนเนอร์ #EEF0FE 12px #4F46E5 "เลือก SKU จากคลังกลาง...พอสำหรับ 8 ตู้" · แ | เดโม่ตาย — staff-app-client.tsx:4357-4369 ใช้ TOUR_PROD | ต่าง | ต่าง |  | 🆕 |
| TOUR-07 | ทัวร์ ขั้น1 · เบิก | แถบสรุป "รวมเบิกจากคลังกลาง" | LOOK: แถบดำ #1A1D21 ขาว radius12 padding13/16 · ซ้าย 13px opacity.8, ขวา "{total | มี(เดโม่) — staff-app-client.tsx:4370-4373 totalDrawn = | ตรง | ต่าง |  | 🆕 |
| TOUR-08 | ทัวร์ ขั้น1 · เบิก | ปุ่ม "ยืนยันเบิก · เริ่มไล่เ | LOOK: ปุ่มเต็ม #4F46E5 ขาว 14.5px/700 padding14 radius13 marginTop14. DOES(tourS | เดโม่ — staff-app-client.tsx:4374 onClick=setTourStep(1 | ตรง | ต่าง | 💰 | 🆕 |
| TOUR-09 | ทัวร์ ขั้น2 · เติม | แถบ header กระเป๋า/เก็บได้/ค | LOOK: การ์ดขาว 3 ช่อง: "ตุ๊กตาในกระเป๋า(เหลือ)" bagLeft 20px #4F46E5, "เก็บได้แล | เดโม่บางส่วน — staff-app-client.tsx:4380-4384 มี bagLef | ต่าง | ต่าง | 💰 | 🆕 |
| TOUR-10 | ทัวร์ ขั้น2 · เติม | การ์ดตู้ในเส้นทาง (tMachines | LOOK: การ์ด badge code 42px, "7-11 สาขา" 13.5px, ซับ "เติม N · ฿เงิน" 11px, ป้าย | เดโม่ตื้น — staff-app-client.tsx:4386-4396 การ์ด TOUR_M | ต่าง | ต่าง | 💰 | 🆕 |
| TOUR-11 | ทัวร์ ขั้น2 · จอรา | header ตู้ + ปุ่มกลับ "กลับร | LOOK: ลิงก์กลับ chevron+ "กลับรายการตู้" 12.5px #6B7280 · การ์ดหัว #FCF8EC borde | ไม่มี — จอรายตู้ในทัวร์ไม่มีเลย (ทัวร์เป็นแค่ toggle) · | ขาด | ขาด |  | 🆕 |
| TOUR-12 | ทัวร์ ขั้น2 · จอรา | "1 · สินค้าในตู้ปัจจุบัน · น | LOOK: หัวข้อ 11px/700 · แถว SKU: รูป 36px, ชื่อ 12.5px, "คงเหลือในตู้ · prevLabe | มีใน FlowScreen ไม่ใช่ในทัวร์ — staff-app-client.tsx st | ขาด | ขาด | 💰 | 🆕 |
| TOUR-13 | ทัวร์ ขั้น2 · จอรา | "2 · เติมสินค้า (เลือกจากที่ | LOOK: แถวเติม #F6F5FE border #DDD8F7: รูป 36px, ชื่อ, bagLabel, input "เติมกี่ตั | บางส่วนใน FlowScreen (refillLines หลาย SKU actions.ts:2 | ขาด | ขาด | 💰 | 🆕 |
| TOUR-14 | ทัวร์ ขั้น2 · จอรา | popover "เลือก SKU จากที่เบิ | LOOK: กล่องขาว border #DDD8F7 radius12 · หัว "เลือก SKU จากที่เบิกมา" + "ปิด" ·  | ไม่มี — ไม่มี popover เลือกจากถุงเบิกในแอปจริง | ขาด | ขาด | 💰 | 🆕 |
| TOUR-15 | ทัวร์ ขั้น2 · จอรา | แถบสรุป 3 ช่อง เติมรวม/คืนสโ | LOOK: 3 กล่อง flex:1 radius9: "เติมรวม" refillTotal 15px #4F46E5, "คืนสโตว์" ret | ไม่มีในทัวร์ — FlowScreen มีตรรกะเติม/คงเหลือแต่ layout | ขาด | ขาด | 💰 | 🆕 |
| TOUR-16 | ทัวร์ ขั้น2 · จอรา | "3 · มิเตอร์ตุ๊กตา (บน=ล่าง  | LOOK: 2 กล่อง flex:1 border #E8EAED radius11: label(บน/ล่าง) 10px, input 15px +  | มีใน FlowScreen (dollGear/dollDigi phase prize_meter, P | ขาด | ขาด | 💰 | 🆕 |
| TOUR-17 | ทัวร์ ขั้น2 · จอรา | "4 · มิเตอร์เหรียญ (บน=ล่าง  | LOOK: 2 กล่องเหมือนส่วน3 · บรรทัดสรุป coinMatchLabel สี coinMatchColor "· รอบก่อ | มีใน FlowScreen (coinGear/coinDigi phase meter_after) · | ขาด | ขาด | 💰 | 🆕 |
| TOUR-18 | ทัวร์ ขั้น2 · จอรา | "5 · แนบรูปก่อนเติม / หลังเต | LOOK: กริด 2 คอลัมน์ · ช่อง border ตามสถานะ, ✓เขียวเมื่อถ่ายแล้ว/ไอคอนกล้องเมื่อ | มีใน PhotoHub/FlowScreen (before/after phase stock/stoc | ขาด | ขาด |  | 🆕 |
| TOUR-19 | ทัวร์ ขั้น2 · จอรา | "6 · เงินสดที่เก็บได้" + กระ | LOOK: การ์ดขาว ฿ 20px + input เงิน 20px/800 borderBottom · ใต้ช่อง cashMatchLabe | มีใน FlowScreen (cash + reconcile เทียบ server, money-p | ขาด | ขาด | 💰 | 🆕 |
| TOUR-20 | ทัวร์ ขั้น2 · จอรา | ปุ่ม "บันทึกตู้นี้ · กลับราย | LOOK: ปุ่มเต็ม (saveStyle ตามความพร้อม) marginTop. DOES(tmActive.save): บันทึกรอ | ต้องผูก submitBranchEvent actions.ts:275 (มี refillLine | ขาด | ขาด | 💰 | 🆕 |
| TOUR-21 | ทัวร์ ขั้น2 · ลิสต | ปุ่ม "ไปคืนของ · สรุป & ฝากเ | LOOK: ปุ่มเต็ม #15803D ขาว 14.5px/700 radius13 marginTop16. DOES(tourToReturn):  | เดโม่ — staff-app-client.tsx:4398 onClick=setTourStep(2 | ต่าง | ต่าง |  | 🆕 |
| TOUR-22 | ทัวร์ ขั้น3 · คืน | ตารางกระทบยอดตุ๊กตา (เบิก=เต | LOOK: การ์ดตาราง grid 1.6/0.7/0.7/0.7: หัว สินค้า/เบิก/เติม/คืน 10.5px · แถว: ชื | เดโม่ — staff-app-client.tsx:4405-4421 มีตารางแต่ used= | ต่าง | ต่าง | 💰 | 🆕 |
| TOUR-23 | ทัวร์ ขั้น3 · คืน | แถบสรุป 3 ช่อง เบิกไป/เติมไป | LOOK: 3 กล่อง radius11: เบิกไป totalDrawn, เติมไป usedDolls(เขียว), คืนคลัง bagL | มี(เดโม่) — staff-app-client.tsx:4422-4426 layout ตรง ค | ตรง | ต่าง | 💰 | 🆕 |
| TOUR-24 | ทัวร์ ขั้น3 · คืน | ตาราง "สรุปเงินที่เก็บได้ ·  | LOOK: การ์ดขาว รายตู้: badge code 40px, "7-11 สาขา" + "เติม N · ตุ๊กตาออก N", เง | ไม่มี — ขั้นคืนในแอปจริงไม่มีสรุปเงินรายตู้/ยอดฝากรวมเล | ขาด | ขาด | 💰 | 🆕 |
| TOUR-25 | ทัวร์ ขั้น3 · คืน | ปุ่ม "ฝากเงิน {cashTotal} เข | LOOK: ปุ่มเต็ม #15803D ขาว 14.5px/700. DOES(deposit): บันทึกฝากเงินรวบทัวร์เข้าร | ไม่มี — ทัวร์เดโม่ไม่มีปุ่มฝากเงิน · แอปมี depositId/mo | ขาด | ขาด | 💰 | 🆕 |
| TOUR-26 | ทัวร์ ขั้น3 · หลัง | แถบยืนยัน "ฝากเงินแล้ว · คืน | LOOK: แถบเขียว #F2FBF5 border #BFE6CB ✓ "ฝากเงิน X เข้าระบบแล้ว · คืนตุ๊กตาครบ"  | เดโม่ต่าง — staff-app-client.tsx:4427 ปุ่มเดียว "ยืนยัน | ขาด | ต่าง |  | 🆕 |
| TOUR-27 | ทัวร์ (ระบบ) · การ | เส้นทางเข้าถึง panel ทัวร์ | LOOK/DOES: openTour จากปุ่ม CTA หน้าแรก → panelOpen + pTour · panel title "ทัวร์ | ตายสนิท — panel==="tour" render TourPanel (staff-app-cl | ขาด | ขาด |  | 🆕 |
| TOUR-28 | ทัวร์ (ระบบ) · ข้อ | แหล่งข้อมูล SKU/ตู้ในทัวร์ | DOES: tDrawRows=SKU จากคลังกลางจริง (มี stock+ราคา), tMachines=ตู้ 8 ตู้ในเส้นทา | ปลอมทั้งหมด — TOUR_PRODUCTS 4 SKU ฮาร์ดโค้ด (4319-4324) | ต่าง | ต่าง | 💰 | 🆕 |

## มือถือ · ประวัติ + หน้าหลัก + เปลี่ยน/เติม (swap) + ตั้งค่าตู้ (ClawFleet staff-app)
32 rows · 💰8 · 🆕0

| ID | จอ | องค์ประกอบ | mockup | ของจริง | 👁️ | ⚙️ | 💰 | 🆕 |
|---|---|---|---|---|---|---|---|---|
| HIST-01 | หน้าหลัก · header  | แถบหัวสีม่วง (avatar + ทักทา | LOOK: gradient ม่วง #4F46E5→#6D5CE8, avatar วงกลม 42px #EDEBFB อักษร 'ส', 'สวัสด | staff-app-client.tsx:1808-1819 — gradient #4F46E5→#5B4F | ต่าง | เกิน |  |  |
| HIST-02 | หน้าหลัก · การ์ดคื | การ์ด 'รอบเก็บเงินวันนี้' +  | LOOK: การ์ด gradient ม่วง radius16, subtitle 'รอบเก็บเงินวันนี้ · เส้นทางรังสิต– | staff-app-client.tsx:1820-1828 — กล่องโปร่ง rgba บนหัวม | ต่าง | ตรง |  |  |
| HIST-03 | หน้าหลัก · เมนูลัด | กริดเมนูลัด 4 ช่อง | LOOK: หัวข้อ 'เมนูลัด' 13px, กริด 4 คอลัมน์ การ์ดขาว border #E8EAED radius12 ไอค | staff-app-client.tsx:1834-1851 — กริด 4 การ์ด: ประวัติเ | ต่าง | ตรง |  |  |
| HIST-04 | หน้าหลัก · ปุ่มทัว | ปุ่ม gradient 'เริ่มทัวร์เติ | LOOK: ปุ่ม gradient ม่วงเต็มแถว radius14 padding14, ไอคอนร้าน 40px, 'เริ่มทัวร์เ | ไม่มีบนหน้าหลัก — ถูกแทนด้วยปุ่มตั้งค่า (memory: redesi | ขาด | ขาด |  |  |
| HIST-05 | หน้าหลัก · ปุ่มตั้ | ปุ่ม 'ตั้งค่าตู้ใหม่ (ครั้งแ | LOOK: ปุ่มขาว border radius13, ไอคอน gear 38px bg #EEF0FE, 'ตั้งค่าตู้ใหม่ (ครั้ | staff-app-client.tsx:1854-1864 — ปุ่มขาว border radius1 | ตรง | ตรง |  |  |
| HIST-06 | หน้าหลัก · draft ค | section 'เก็บค้างไว้ · รอกรอ | LOOK: หัวข้อ + badge count สีส้ม #B45309 bg #FCF1E2, แถบอธิบายสีครีม #FCF8EC, กา | staff-app-client.tsx:1867-1893 — ตรงเกือบเป๊ะ: หัวข้อ+b | ตรง | ตรง |  |  |
| HIST-07 | หน้าหลัก · แถวตู้  | การ์ดตู้ + ปุ่ม เก็บเงิน / เ | LOOK: การ์ดขาว radius, code badge 40px, branch·zone + hint, tag pill 'รอเก็บ', ป | staff-app-client.tsx:1938-1971 — การ์ดขาว code 38px + d | ตรง | ตรง |  |  |
| HIST-08 | หน้าหลัก · แถวตู้  | สถานะ 'เก็บแล้ว' + ปุ่ม ดูใบ | LOOK: tag เขียว 'เก็บแล้ว' bg #E7F4EC, ปุ่ม 52px 'ดูใบ' bg #F2FBF5 border เขียว  | staff-app-client.tsx:1956-1963 — tag เขียว 'เก็บแล้ว' + | ตรง | เกิน |  |  |
| HIST-09 | หน้าหลัก · แถวตู้ | แถบ chips 'ตอนนี้ในตู้' ใต้ก | ไม่มีใน mockup — mockup แถวตู้จบที่ปุ่ม action ไม่มี chips ราย SKU. | staff-app-client.tsx:1974 + 4179 InMachineStrip — chips | เกิน | เกิน |  |  |
| HIST-10 | หน้าหลัก · แถวตู้  | สถานะ ตั้งค่าครั้งแรก / แจ้ง | mockup มี tag 'ตั้งง่าย/ยาก' ระดับ dashboard แต่แถวตู้พนักงานมีแค่ notDone/done. | staff-app-client.tsx:1925-1933 — 5 สถานะ: skipped(แจ้งซ | เกิน | เกิน |  |  |
| HIST-11 | ประวัติ · แท็บวัน | แถบแท็บวันเลื่อนแนวนอน | LOOK: histDays วน — แต่ละวัน label + cashLabel เขียว. (mockup ใช้ header วัน + เ | staff-app-client.tsx:2250-2263 — แท็บ pill เลื่อนแนวนอน | ต่าง | เกิน |  |  |
| HIST-12 | ประวัติ · การ์ดสรุ | การ์ดสรุปยอด indigo 2×2 | LOOK (mockup: 3 กล่องแนวนอน): เก็บเงิน(เขียว)/เปลี่ยน-เติม(ม่วง)/ยังไม่เก็บ(แดง) | staff-app-client.tsx:2265-2280 — การ์ด gradient indigo  | ต่าง | เกิน |  |  |
| HIST-13 | ประวัติ · รายการรอ | แถวรายการรอบเก็บ/เปลี่ยน | LOOK: การ์ดขาว border radius11 — icon 30px (สี bg ตามชนิด) + 'code · action' 12. | staff-app-client.tsx:2285-2311 — ปุ่มแถวขาว: statusSqua | ตรง | เกิน |  |  |
| HIST-14 | ประวัติ · รายละเอี | หน้า detail เต็มจอ (collect) | ไม่มีใน mockup section นี้ — mockup ประวัติจบที่ list (แตะไม่เปิดหน้าใหม่). | staff-app-client.tsx:2317-2412 — dialog เต็มจอ absolute | เกิน | เกิน |  |  |
| HIST-15 | ประวัติ · detail ( | หน้า detail รอบเปลี่ยนตุ๊กตา | ไม่มีใน mockup. | staff-app-client.tsx:2370-2396 — โหมด isSwap: 2 การ์ด ค | เกิน | เกิน |  |  |
| HIST-16 | ประวัติ · detail | แนบรูปเพิ่มย้อนหลัง (AttachP | ไม่มีใน mockup. | staff-app-client.tsx:2289/2632 AttachPhotosSheet — ป้าย | เกิน | เกิน |  |  |
| HIST-17 | ประวัติ · detail | แก้เลขในใบเดิม (EditRoundShe | ไม่มีใน mockup. | staff-app-client.tsx:2173/2536 EditRoundSheet — แก้เลขร | เกิน | เกิน | 💰 |  |
| HIST-18 | ประวัติ · empty/de | empty state + แบนเนอร์ตัวอย่ | ไม่มีใน mockup (mockup มีข้อมูล placeholder เสมอ). | staff-app-client.tsx:2238-2246 — ComingSoonBanner 'กำลั | เกิน | เกิน |  |  |
| HIST-19 | เปลี่ยน/เติม (swap | หน้าจอ swap header + คำอธิบา | LOOK: panel ในหน้าหลัก (มี backHome + panelTitle), การ์ดหัว bg #EEF0FE code 38px | staff-app-client.tsx:3718-3752 RefillDollsSheet — full- | ต่าง | ตรง |  |  |
| HIST-20 | เปลี่ยน/เติม · ขั้ | รายการ SKU ในตู้ + นับที่เหล | LOOK: หัวข้อ '1 · สินค้าในตู้ปัจจุบัน · นับที่เหลือ', แถว SKU: รูป 34px + ชื่อ + | staff-app-client.tsx:3755-3803 — หัวข้อ 'นับตุ๊กตาในตู้ | ต่าง | ตรง | 💰 |  |
| HIST-21 | เปลี่ยน/เติม · ขั้ | เติมสินค้า + เลือก SKU จากคล | LOOK: หัวข้อ '2 · เติมสินค้า (เลือกจากคลังสาขา)', แถวเติม bg #F6F5FE input 56px  | staff-app-client.tsx:3808-3853 — หัวข้อ 'เติมตุ๊กตา' +  | ต่าง | ตรง | 💰 |  |
| HIST-22 | เปลี่ยน/เติม · เพิ | เพิ่มตุ๊กตาแบบใหม่เข้าคลัง | ไม่มีใน mockup (mockup เลือกจากคลังที่มีเท่านั้น). | staff-app-client.tsx:3855-3881 — ปุ่ม 'ไม่มีในคลัง? เพิ | เกิน | เกิน |  |  |
| HIST-23 | เปลี่ยน/เติม · กล่ | สรุปเติม/คืน/หลังเติม | LOOK: 3 กล่องแนวนอน — เติมรวม(#EEF0FE ม่วง)/คืนสโตว์(#FCF8EC ส้ม)/หลังเติม(#F8F9 | staff-app-client.tsx:3902-3911 — การ์ดเดียว bg #EEF6FF  | ต่าง | เกิน | 💰 |  |
| HIST-24 | เปลี่ยน/เติม · ขั้ | แนบรูปก่อนเติม / หลังเติม | LOOK: หัวข้อ '3 · แนบรูปก่อนเติม / หลังเติม', 2 ปุ่มครึ่งจอ border 1.5px — ยังไม | staff-app-client.tsx:3883-3900 — หัวข้อ 'รูปยืนยัน (ก่อ | ต่าง | ต่าง |  |  |
| HIST-25 | เปลี่ยน/เติม · บัน | ปุ่มบันทึกการเปลี่ยน/เติม | LOOK: ปุ่ม 'บันทึกการเปลี่ยน/เติม · กลับหน้าหลัก' (swSaveStyle). DOES: swSave →  | staff-app-client.tsx:3915-3920 — ปุ่ม disabled จนกว่าจะ | ต่าง | ตรง | 💰 |  |
| HIST-26 | เปลี่ยน/เติม · สำเ | overlay 'เปลี่ยนตุ๊กตาสำเร็จ | ไม่มี overlay ใน mockup (mockup แค่กลับหน้าหลัก). | staff-app-client.tsx:3735-3745 — overlay เขียวเต็มจอ ✓  | เกิน | เกิน |  |  |
| HIST-27 | ตั้งค่าตู้ · เปลือ | panel ตั้งค่าครั้งแรก + แถบเ | LOOK: pSetup — แถบ #EEF0FE ไอคอนนาฬิกา 'บันทึกยอดตั้งต้น (ตุ๊กตา · เงิน · มิเตอร | staff-app-client.tsx:1490/2055 BaselineScreen → compone | ตรง | ตรง |  |  |
| HIST-28 | ตั้งค่าตู้ · สินค้ | รายการสินค้าในตู้ (−/N/+) +  | LOOK: หัวข้อ 'สินค้าในตู้' + badge 'รวม N ตัว', แถว SKU: ชื่อ + 'price/ตัว' + −/ | BaselineForm.tsx:58-70 + ต่อ — ตุ๊กตาในตู้ราย SKU (ยอดร | ตรง | ตรง | 💰 |  |
| HIST-29 | ตั้งค่าตู้ · มิเตอ | อ่านมิเตอร์ 4 ตัว (กริด 2×2) | LOOK: หัวข้อ 'อ่านมิเตอร์ 4 ตัว' + suMeterTag, กริด 2×2 — แต่ละกล่อง label (เฟือ | BaselineForm.tsx:38-70 — 4 มิเตอร์: มิเตอร์เงิน(บน)/เงิ | ต่าง | ตรง | 💰 |  |
| HIST-30 | ตั้งค่าตู้ · บันทึ | ปุ่ม 'บันทึกยอดตั้งต้น · เริ | LOOK: ปุ่มเขียว #15803D เต็มแถว 'บันทึกยอดตั้งต้น · เริ่มนับรอบ' + หลังบันทึกโชว | BaselineForm.tsx onDone → staff-app-client.tsx:1509 — บ | ตรง | ตรง | 💰 |  |
| HIST-31 | หน้าหลัก · empty ต | empty 'ยังไม่มีตู้ที่ได้รับม | ไม่มีใน mockup. | staff-app-client.tsx:1902-1906 — EmptyState เมื่อ machi | เกิน | เกิน |  |  |
| HIST-32 | หน้าหลัก · จัดกลุ่ | หัวข้อคั่นสาขา (เมื่อ >1 สาข | ไม่มีใน mockup (mockup 1 เส้นทางเดียว). | staff-app-client.tsx:1767/1909-1916 — showBranchHeaders | เกิน | เกิน |  |  |

## หลังบ้าน · เช็คลิสต์เก็บเงิน (screen checklist)
21 rows · 💰4 · 🆕12

| ID | จอ | องค์ประกอบ | mockup | ของจริง | 👁️ | ⚙️ | 💰 | 🆕 |
|---|---|---|---|---|---|---|---|---|
| BOCHK-01 | ทางเข้า/แท็บ | เมนู/แท็บ "เช็คลิสต์เก็บเงิน | LOOK: เป็น nav item ระดับบนสุดใน sidebar ซ้าย ไอคอน check-square (paths M9 11l3  | matrix-client.tsx:449-450 — ไม่ใช่เมนูหลัก แต่เป็นปุ่ม  | ต่าง | ต่าง |  |  |
| BOCHK-02 | แถบสรุปบนสุด | แถวการ์ดสรุป 5 ใบ (คอนเทนเนอ | LOOK: grid-template-columns repeat(5,1fr) gap13px margin-bottom18px (system.dc.h | ไม่มี — ChecklistClient ไม่มีการ์ดสรุปใด ๆ เลย (checkli | ขาด | ขาด |  | 🆕 |
| BOCHK-03 | แถบสรุปบนสุด | การ์ด "สาขาทั้งหมด" | LOOK: bg #fff border 1px #E8EAED radius14 pad15/17px · label 12px #6B7280 'สาขาท | ไม่มี | ขาด | ขาด |  | 🆕 |
| BOCHK-04 | แถบสรุปบนสุด | การ์ด "ต้องรีบเก็บ" (overdue | LOOK: bg #FFF9F8 border #F3D9D5 radius14 · label 12px #B42318 'ต้องรีบเก็บ' · เล | ไม่มี — ของจริงไม่มีแนวคิด cadence/overdue ในเช็คลิสต์เ | ขาด | ขาด |  | 🆕 |
| BOCHK-05 | แถบสรุปบนสุด | การ์ด "ตุ๊กตา≠มิเตอร์" (mete | LOOK: bg #FFF9F8 border #F3D9D5 · #B42318 · เลข 23px/700 '{n} สาขา' · sub 11px # | ไม่มี — ไม่มีการเทียบตุ๊กตาออกกับมิเตอร์ที่ใดในเช็คลิสต | ขาด | ขาด | 💰 | 🆕 |
| BOCHK-06 | แถบสรุปบนสุด | การ์ด "สาขาขาดทุน" (loss) | LOOK: bg #FFFBF4 border #F0E2BE · #B45309 · เลข 23px/700 '{n} สาขา' · sub 11px # | ไม่มี — ไม่มีการคำนวณกำไร/ขาดทุนเทียบต้นทุนในเช็คลิสต์ | ขาด | ขาด | 💰 | 🆕 |
| BOCHK-07 | แถบสรุปบนสุด | การ์ด "เฉลี่ยเก็บครบ" (avgPc | LOOK: bg #fff border #E8EAED · label 12px #6B7280 'เฉลี่ยเก็บครบ' · เลข 23px/700 | ไม่มี — ของจริงมีแค่ collected/total รายสาขา (checklist | ขาด | ขาด |  | 🆕 |
| BOCHK-08 | ตารางเช็คลิสต์ | คอนเทนเนอร์ตาราง + แถวหัวคอล | LOOK: การ์ดขาว border #E8EAED radius14 overflow hidden · header grid cols 158px/ | checklist-client.tsx:218-267 — มีตารางแต่โครงต่างสิ้นเช | ต่าง | ต่าง |  | 🆕 |
| BOCHK-09 | แถวสาขา | ช่อง "สาขา" — ชื่อ + gap/cad | LOOK: ชื่อ 14px/700 '{r.name}' · บรรทัดล่าง 11px/600 สี {r.gapColor} '{r.gapLabe | checklist-client.tsx:291-305 — th sticky: ชื่อสาขา 12px | ต่าง | ต่าง |  | 🆕 |
| BOCHK-10 | แถวสาขา | ช่อง "ความครบ" — แถบ progres | LOOK: flex gap10 · แถบ flex:1 height9 bg #EEF0F3 radius6 · fill width {r.barWidt | ไม่มีแถบ progress — collected/total โชว์เป็นตัวเลขล้วนใ | ขาด | ขาด |  | 🆕 |
| BOCHK-11 | แถวสาขา | ช่อง "7 วันล่าสุด" — แถบ 7 ช | LOOK: flex gap4 wrap width104px · sc-for r.cells (7 ช่อง) แต่ละช่อง 13×13px radi | checklist-client.tsx:307-314 — มีแนวคิดใกล้เคียง (จุดต่ | ต่าง | ต่าง |  |  |
| BOCHK-12 | แถวสาขา (leaf) | ช่องสีเดี่ยวใน 7 วัน (แต่ละว | LOOK: span 13×13px radius4 bg จาก cell.bg — indigo #4F46E5 = เก็บ / #EEF0F3 = ไม | checklist-client.tsx:85-107 StatusDot — วงกลม 10×10 (CO | ต่าง | ต่าง |  |  |
| BOCHK-13 | แถวสาขา | ช่อง "ตุ๊กตาออก ↔ มิเตอร์" + | LOOK: '{dollsOut} / {meterDoll}' 13px/700 (slash สีเทา #C2C7CF) · ป้าย inline 10 | ไม่มี — เช็คลิสต์ไม่มีการเทียบมิเตอร์เลย (มิเตอร์อยู่ใน | ขาด | ขาด | 💰 | 🆕 |
| BOCHK-14 | แถวสาขา | ช่อง "เฉลี่ย/ตัว · กำไร–ขาดท | LOOK: avgPerLabel 15px/800 สี {r.profitColor} (฿X ต่อตัว) · perProfitLabel 10.5p | ไม่มี — เฉลี่ย/ตัว มีในมุมมอง 'ตู้ × วัน' (matrix) แต่ไ | ขาด | ขาด | 💰 | 🆕 |
| BOCHK-15 | แถวสาขา | ช่อง "สถานะ" — ป้ายสถานะรายส | LOOK: ชิดขวา · pill 11px/700 pad5/12 radius20 bg {statusBg} color {statusColor}  | ไม่มีป้ายสถานะรวมรายสาขา — มีแค่ pill 'รอตั้งค่า' เฉพาะ | ขาด | ขาด |  | 🆕 |
| BOCHK-16 | ท้ายตาราง | แถบ legend + หมายเหตุต้นทุน | LOOK: flex gap18 pad12/20 bg #FAFBFC 11px #9AA1AB · swatch indigo 13×13 'วันที่เ | checklist-client.tsx:191-208 — มี legend แต่คนละชุด: 5  | ต่าง | ต่าง |  |  |
| BOCHK-17 | ของจริงมีเกิน | โหมด DEMO/ตัวอย่าง (banner + | ไม่มีใน mockup — mockup เองเป็น placeholder static (chkRows/chkSummary ไม่ถูก bu | checklist-client.tsx:60-76,168-185,212-216 — DB ว่าง →  | เกิน | เกิน |  |  |
| BOCHK-18 | ของจริงมีเกิน | สถานะ DEPOSITED (เก็บ + ฝากธ | ไม่มีใน mockup — 7 วันของ mockup เป็น binary เก็บ/ไม่เก็บ เท่านั้น | checklist-client.tsx:41,102-104 — DEPOSITED = จุดเขียว  | เกิน | เกิน |  |  |
| BOCHK-19 | ของจริงมีเกิน | grid 31 วัน sticky header/co | ไม่มีใน mockup — mockup โชว์ 7 วัน inline คงที่ ไม่มี scroll/sticky | checklist-client.tsx:211-217,240-266 — หัววัน sticky to | เกิน | เกิน |  |  |
| BOCHK-20 | ของจริงมีเกิน | บรรทัดอธิบาย "แต่ละช่อง = .. | ไม่มีตรง ๆ ใน mockup (mockup ใช้หมายเหตุต้นทุนใน footer แทน) | checklist-client.tsx:187-189 — 12px #co-muted-2 'แต่ละช | เกิน | เกิน |  |  |
| BOCHK-21 | ของจริงมีเกิน | Empty state "ยังไม่มีสาขาตู้ | ไม่มีใน mockup (mockup โชว์ 8 แถวคงที่ ไม่มีสถานะว่าง) | checklist-client.tsx:154-163 — เมื่อมีข้อมูลจริงแต่ 0 ส | เกิน | เกิน |  |  |

## หลังบ้าน · ตรวจเงิน & กระทบยอด (screen collect)
25 rows · 💰6 · 🆕8

| ID | จอ | องค์ประกอบ | mockup | ของจริง | 👁️ | ⚙️ | 💰 | 🆕 |
|---|---|---|---|---|---|---|---|---|
| BOCOL-01 | control bar | ตัวเลือกสาขา (dropdown) | LOOK: กล่องขาว border #E3E6EA radius 10px pad 7/12px · ไอคอนตึก 15px stroke #6B7 | collections-client.tsx:350-364 มี select สาขา style เดี | ตรง | ตรง |  |  |
| BOCOL-02 | control bar | แท็บสถานะ (colTabs) | LOOK: ปุ่ม pill เรียงแนวนอน gap 8px style จาก t.style (active/inactive). DOES: t | collections-client.tsx:418-436 มี 5 แท็บ (ทั้งหมด/ตรงกั | ต่าง | เกิน |  |  |
| BOCOL-03 | control bar | ตัวกรองช่วงวันที่ + ปุ่มลัด  | LOOK/DOES: mockup ไม่มี — control bar มีแค่ สาขา + แท็บ | collections-client.tsx:366-453 มี date range picker (จา | เกิน | เกิน |  |  |
| BOCOL-04 | coverage strip | การ์ด 'ความคืบหน้าการเก็บวัน | LOOK: การ์ดไล่สี linear-gradient(135deg,#4F46E5,#6D5CE8) radius 14px pad 16/18px | ไม่มี — การ์ดใบแรกของแถวสรุปคือ 'รอบเก็บทั้งหมด' (total | ขาด | ขาด |  | 🆕 |
| BOCOL-05 | coverage strip | การ์ด 'ยังไม่ได้เก็บ' (pendi | LOOK: การ์ดขาว border #E8EAED radius 14px pad 15/17px · label 'ยังไม่ได้เก็บ' 12 | ไม่มี — แอปจริงไม่คำนวณ 'ตู้ที่ยังไม่ได้เก็บ' (query อ่ | ขาด | ขาด |  | 🆕 |
| BOCOL-06 | coverage strip | การ์ด 'เก็บข้ามวัน' (overdue | LOOK: การ์ด #FFFBF4 border #F0E2BE radius 14px · label #B45309 12px · เลข 24/700 | ไม่มี — ไม่มีข้อมูลกำหนดเก็บ/cadence ต่อตู้ → คำนวณ ove | ขาด | ขาด |  | 🆕 |
| BOCOL-07 | coverage strip | การ์ด 'ไม่ตรง · ต้องสอบ' (au | LOOK: การ์ด #FFF9F8 border #F3D9D5 radius 14px · label #B42318 12px · เลข 24/700 | collections-client.tsx:468-475 การ์ด 'เงินไม่ตรง · ต้อง | ตรง | ตรง | 💰 |  |
| BOCOL-08 | summary strip | การ์ดสรุปที่แอปจริงมีเพิ่ม ( | LOOK/DOES: mockup ไม่มีการ์ดพวกนี้ (mockup ใช้ coverage 4 ใบด้านบนแทน) | collections-client.tsx:460-484 มี 'รอบเก็บทั้งหมด' (tot | เกิน | เกิน | 💰 |  |
| BOCOL-09 | pending machines | แบนเนอร์ 'เก็บครบทุกตู้แล้ว' | LOOK: แถบ #F2FAF5 border #CDE9D7 radius 12px pad 13/18px · เช็ค 18px stroke #158 | ไม่มี — ไม่มีคอนเซ็ปต์ 'ครบตามกำหนด' (ต้องมีข้อมูลตู้ที | ขาด | ขาด |  | 🆕 |
| BOCOL-10 | pending machines | บล็อกรายการตู้ที่ลืม/เกินกำห | LOOK: การ์ดขาว border #E8EAED radius 14px · หัว #FFFBF4 นาฬิกา 17px stroke #B453 | ไม่มี — แอปจริงไม่มี list ตู้ค้าง/เกินกำหนด เลย | ขาด | ขาด |  | 🆕 |
| BOCOL-11 | list header | หัวรายการ 'รอบที่เก็บมาแล้ว  | LOOK: แถวหัว justify-between · ซ้าย 'รอบที่เก็บมาแล้ว · ตรวจกระทบยอด' 13/700 #45 | ต่าง — แอปจริงใช้ย่อหน้าอธิบาย 'รอบเก็บเงินทั้งหมดที่ปิ | ต่าง | ตรง |  |  |
| BOCOL-12 | collection card (h | หัวการ์ดรอบ: ไอคอนสถานะ + co | LOOK: แถวกดได้ pad 15/20px gap 16px · ไอคอนสถานะ 38×38 radius 10px bg/color ตาม  | collections-client.tsx:741-754 ปุ่มกางเหมือนกัน (icon 3 | ตรง | ตรง |  |  |
| BOCOL-13 | collection card (h | สถิติหัวการ์ด: เก็บเงินได้ / | LOOK: 3 คอลัมน์ gap 26px · label 10.5px #9AA1AB · value 15/700 · ส่วนต่างสี c.di | collections-client.tsx:755-768 มี 4 สถิติ: เก็บเงินได้( | ต่าง | ตรง | 💰 |  |
| BOCOL-14 | collection card (h | chip สถานะ + chevron | LOOK: chip statusLabel 12/700 pad 6/13 radius 20px bg/color ตาม status · chevron | collections-client.tsx:776-781 chip meta.label 12/700 p | ตรง | ตรง |  |  |
| BOCOL-15 | collection card (h | แอปจริงเพิ่ม: chip 'รูปยังไม | LOOK/DOES: mockup ไม่มี — รูปอยู่ในแผงตอนกางเท่านั้น | collections-client.tsx:769-775 chip amber 'รูปยังไม่ครบ | เกิน | เกิน |  |  |
| BOCOL-16 | drill-down | เส้นทางตุ๊กตา (doll track) | LOOK: การ์ด bg c.dollRowBg radius 12px pad 15/16px · หัวไอคอนตุ๊กตา 16px 'เส้นทา | collections-client.tsx:829-850 มีการ์ด 'เส้นทางตุ๊กตา'  | ต่าง | ตรง |  |  |
| BOCOL-17 | drill-down | เส้นทางเงิน 3-way reconcile  | LOOK: การ์ด bg c.coinRowBg radius 12px · หัว Coins 16px 'เส้นทางเงิน' + cashOkLa | collections-client.tsx:852-899 การ์ด 3-way ReconCell (ม | ตรง | ตรง | 💰 |  |
| BOCOL-18 | drill-down | แบนเนอร์ 'มิเตอร์ต่อเนื่อง'  | LOOK: แถบ #F2FAF5 border #CDE9D7 radius 10px pad 11/14px · เช็ค 16px #15803D · ' | ไม่มี — ถูกถอดออก (collections-client.tsx:903-905 คอมเม | ขาด | ขาด | 💰 | 🆕 |
| BOCOL-19 | drill-down | กริดรูปมิเตอร์ (meterPhotos) | LOOK: หัว 'รูปมิเตอร์ที่พนักงานถ่าย · เทียบเลขที่กรอก' 11px #9AA1AB · กริด 4 คอล | collections-client.tsx:907-948 กริดรูป 'ต่อตู้' (per-ma | ต่าง | ตรง |  |  |
| BOCOL-20 | drill-down (c.isDi | แผง 'ข้อมูลดิบของตู้นี้' (ra | LOOK: แสดงเฉพาะ c.isDiff · การ์ดขาว border #E8EAED radius 12px pad 14/16px · หัว | ไม่มี — แอปจริงไม่มีตารางข้อมูลดิบตอนไม่ตรง | ขาด | ขาด |  | 🆕 |
| BOCOL-21 | drill-down (c.isDi | checklist 'สาเหตุที่เป็นไปได | LOOK: แสดงเฉพาะ c.isDiff · การ์ดขาว radius 12px · หัว 'สาเหตุที่เป็นไปได้ — ไล่ต | ไม่มี — แอปจริงมีแค่บรรทัด 'แนะนำ: action' บรรทัดเดียว  | ขาด | ขาด |  | 🆕 |
| BOCOL-22 | drill-down (footer | แถบ 'แนะนำ action' | LOOK: กล่อง #F8F9FB radius 11px pad 14/16px · ไอคอน info 17px สี c.actionColor · | collections-client.tsx:951-955 กล่อง #F8F9FB radius 11p | ตรง | ตรง |  |  |
| BOCOL-23 | drill-down (footer | ปุ่ม review เปลี่ยนสถานะ (re | LOOK: 'พนักงานตรวจแล้ว เปลี่ยนสถานะ →' 11.5px #9AA1AB + ปุ่ม pbtn 3 ปุ่ม (ra.sty | collections-client.tsx:956-960 ปุ่ม ReviewBtn 3 ปุ่ม (อ | ตรง | ตรง | 💰 |  |
| BOCOL-24 | drill-down (footer | chip ผลตรวจ (reviewed / revi | LOOK: ถ้า reviewedShow → chip เขียว 'ตรวจแล้ว · reviewedLabel' 11.5/700 #15803D  | collections-client.tsx:962-970 chip 'อนุมัติแล้ว/ส่งตรว | ตรง | ตรง |  |  |
| BOCOL-25 | lightbox / empty | แอปจริงเพิ่ม: lightbox ขยายร | LOOK/DOES: mockup มีแค่ไอคอนขยายบนรูป (นัยว่าเปิดดูได้) ไม่มี overlay จริง · ไม่ | collections-client.tsx:976-1015 lightbox overlay เต็มจอ | เกิน | เกิน |  |  |
