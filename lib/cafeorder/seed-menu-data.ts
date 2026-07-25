// CafeOrder · เมนูจริงจาก research (docs/CafeOrder_menu_research.md · 2026-07-21)
//   ราคา = บาท หน้าร้าน (Amazon เดลิเวอรี≈หน้าร้าน · พันธุ์ไทยเดลิเวอรีดึงไม่ได้)
//   ใช้เติม template ให้โหลด (CEO แก้ราคาให้ตรงสาขาแล้ว import = seed)
//   ⚠️ ยืนยันกับรูปเมนูสาขา pilot ก่อนใช้จริง (เว็บได้ ~80%)

export type SeedMenu = {
  category: string;
  name: string;
  kind: "drink" | "food";
  hot?: number;
  iced?: number;
  blended?: number;
  single?: number; // ของกิน
  upsize?: number; // อัพไซส์ +บาท (เมนูร้อน)
  image?: string;
};

export const AMAZON_MENU: SeedMenu[] = [
  { category: "กาแฟ", name: "เอสเปรสโซ่", kind: "drink", hot: 40, iced: 60, blended: 65, upsize: 10 },
  { category: "กาแฟ", name: "อเมซอน", kind: "drink", hot: 50, iced: 70, blended: 75, upsize: 10 },
  { category: "กาแฟ", name: "อเมซอน เอ็กซ์ตร้า", kind: "drink", iced: 75 },
  { category: "กาแฟ", name: "แบล็คคอฟฟี่", kind: "drink", hot: 40, iced: 60 },
  { category: "กาแฟ", name: "แบล็คคอฟฟี่ น้ำผึ้ง", kind: "drink", iced: 70 },
  { category: "กาแฟ", name: "แบล็คคอฟฟี่ น้ำผึ้งมะนาว", kind: "drink", iced: 75 },
  { category: "กาแฟ", name: "คาปูชิโน", kind: "drink", hot: 50, iced: 65, blended: 70, upsize: 10 },
  { category: "กาแฟ", name: "ลาเต้อเมซอน", kind: "drink", hot: 55, iced: 70, blended: 75, upsize: 10 },
  { category: "กาแฟ", name: "มอคค่า", kind: "drink", hot: 55, iced: 70, blended: 75, upsize: 10 },
  { category: "กาแฟ", name: "ไวท์ช็อกมัคคิอาโต้", kind: "drink", hot: 60, iced: 70, blended: 80, upsize: 10 },
  { category: "ชา", name: "ชา", kind: "drink", hot: 45 },
  { category: "ชา", name: "ชาเขียวนม", kind: "drink", hot: 50, iced: 55, blended: 60 },
  { category: "ชา", name: "ชานม (ชาไทย)", kind: "drink", hot: 45, iced: 50, blended: 55 },
  { category: "ชา", name: "โฮจิฉะ บราวน์ชูการ์ ลาเต้", kind: "drink", iced: 65 },
  { category: "ชา", name: "ชาเขียวน้ำผึ้งมะนาวเจลลี่", kind: "drink", iced: 60 },
  { category: "ชา", name: "มัทฉะถั่วแดง", kind: "drink", blended: 70 },
  { category: "นม/ช็อก", name: "นมสด", kind: "drink", hot: 40, iced: 50, blended: 55 },
  { category: "นม/ช็อก", name: "ช็อกโกแลต", kind: "drink", hot: 45, iced: 55, blended: 60 },
  { category: "นม/ช็อก", name: "สตรอเบอร์รี่ชีสเค้ก", kind: "drink", blended: 75 },
  { category: "น้ำผลไม้", name: "น้ำลิ้นจี่", kind: "drink", iced: 45, blended: 50 },
  { category: "น้ำผลไม้", name: "น้ำสตรอเบอร์รี่ปั่น", kind: "drink", blended: 60 },
  { category: "น้ำผลไม้", name: "น้ำมิกซ์เบอร์รี่ปั่น", kind: "drink", blended: 60 },
  { category: "Amazon Lite", name: "ไลท์คอฟฟี่ฮันนี่", kind: "drink", iced: 60 },
  { category: "Amazon Lite", name: "เฟรชคาเฟ่ลาเต้", kind: "drink", iced: 60 },
  { category: "Amazon Lite", name: "แบล็คทีฮันนี่", kind: "drink", iced: 50 },
  { category: "Amazon Lite", name: "มัทฉะลาเต้", kind: "drink", iced: 60 },
  { category: "เบเกอรี", name: "มัฟฟินบลูเบอร์รี่", kind: "food", single: 55, image: "https://cdn.wongnai.com/p/256x256/2024/02/01/49d370842e3c488da4093788c60c764f.jpg" },
  { category: "เบเกอรี", name: "มัฟฟินช็อกโกแลต", kind: "food", single: 55, image: "https://cdn.wongnai.com/p/256x256/2024/02/01/2b1db3c70bf24aeabebae2bb09f9526f.jpg" },
  { category: "เบเกอรี", name: "แมคคาเดเมียอบเกลือ", kind: "food", single: 59 },
  { category: "เบเกอรี", name: "คาราเมลวาฟเฟิล", kind: "food", single: 30 },
];

export const PUNTHAI_MENU: SeedMenu[] = [
  { category: "กาแฟ", name: "พันธุ์ไทยคอฟฟี่", kind: "drink", iced: 60, image: "https://www.ktc.co.th/upload/pub/media/Article/05/Punthai-coffee-cold-2-750x750.webp" },
  { category: "กาแฟ", name: "เอสเพรสโซ่", kind: "drink", hot: 45, iced: 60 },
  { category: "กาแฟ", name: "อเมริกาโน", kind: "drink", iced: 60, image: "https://www.ktc.co.th/upload/pub/media/Article/05/Americano-1-750x750.webp" },
  { category: "กาแฟ", name: "ไทยริกาโน่", kind: "drink", hot: 55, iced: 65 },
  { category: "กาแฟ", name: "สามสหาย", kind: "drink", iced: 65, image: "https://www.ktc.co.th/upload/pub/media/Article/05/Punthai-coffee-tree-friend-1-750x750.webp" },
  { category: "กาแฟ", name: "สามทหารเสือ", kind: "drink", iced: 65 },
  { category: "กาแฟ", name: "จี๊ดคอฟฟี่", kind: "drink", iced: 65 },
  { category: "กาแฟ", name: "คอฟฟี่โทน", kind: "drink", iced: 70 },
  { category: "กาแฟ", name: "กาแฟเฮเซลนัท", kind: "drink", hot: 55, iced: 65 },
  { category: "กาแฟ", name: "กาแฟคาราเมล", kind: "drink", hot: 55, iced: 65 },
  { category: "กาแฟ", name: "มอคค่า", kind: "drink", hot: 55, iced: 60, blended: 75 },
  { category: "กาแฟ", name: "คาปูชิโน", kind: "drink", hot: 55, iced: 60, image: "https://www.ktc.co.th/upload/pub/media/Article/05/cappuccino-1-750x750.webp" },
  { category: "กาแฟ", name: "พันธุ์ไทยชัยโย", kind: "drink", iced: 50 },
  { category: "กาแฟ", name: "กาแฟมะม่วงเฮเซลนัท", kind: "drink", iced: 75 },
  { category: "ชา", name: "ชาไทยดับเบิ้ล", kind: "drink", hot: 50, iced: 55, image: "https://www.ktc.co.th/upload/pub/media/Article/05/Punthai-thai-tea-1-750x750.webp" },
  { category: "ชา", name: "ชาดำ", kind: "drink", iced: 50 },
  { category: "ชา", name: "ชามะนาว", kind: "drink", hot: 50, iced: 50 },
  { category: "ชา", name: "กรีนทีลาเต้", kind: "drink", hot: 60, iced: 65 },
  { category: "ชา", name: "ฮันนี่ไลม์", kind: "drink", hot: 50, iced: 65 },
  { category: "ชา", name: "ชาอัสสัมมะนาว", kind: "drink", hot: 70, iced: 70 },
  { category: "มัทฉะ", name: "มัทฉะลาเต้", kind: "drink", hot: 65, iced: 65 },
  { category: "มัทฉะ", name: "มัทฉะแฟรปเป้", kind: "drink", blended: 75 },
  { category: "มัทฉะ", name: "ดับเบิ้ลมัทฉะ", kind: "drink", hot: 85, iced: 85 },
  { category: "นม/ช็อก", name: "ดับเบิ้ลช็อกโกแลต", kind: "drink", hot: 55, iced: 65 },
  { category: "นม/ช็อก", name: "นมสด", kind: "drink", hot: 55, iced: 60, blended: 70 },
  { category: "นม/ช็อก", name: "นมย่าง", kind: "drink", iced: 79 },
  { category: "ปั่น", name: "คุกกี้แอนด์ครีมปั่น", kind: "drink", blended: 75 },
  { category: "ปั่น", name: "มะม่วงปั่น", kind: "drink", blended: 89 },
  { category: "โซดา", name: "โซดาสตรอเบอร์รี่", kind: "drink", iced: 50 },
  { category: "เบเกอรี", name: "ครัวซองต์ไข่", kind: "food", single: 59 },
  { category: "เบเกอรี", name: "วาฟเฟิลออริจินอล", kind: "food", single: 50 },
];

/** preset กลุ่มตัวเลือกมาตรฐาน (research Grab/LINEMAN) */
export const OPTION_PRESETS = [
  { name: "หวาน", select: "เดี่ยว", required: "Y", visible: "ทุกแบบ", choices: "หวานปกติ:0 | หวานน้อย:0 | หวานน้อยมาก:0 | ไม่หวาน:0" },
  { name: "น้ำแข็ง", select: "เดี่ยว", required: "N", visible: "เย็น", choices: "น้ำแข็งปกติ:0 | น้ำแข็งน้อย:0 | น้ำแข็งเยอะ:0 | แยกน้ำแข็ง:10" },
  { name: "ท็อปปิ้ง", select: "หลาย", required: "N", visible: "ทุกแบบ", choices: "ไข่มุกบุก:20 | น้ำตาลโตนด:20 | ซอสคาราเมล:15 | วิปครีม:15" },
  { name: "ช็อต", select: "เดี่ยว", required: "N", visible: "ทุกแบบ", choices: "ไม่เพิ่ม:0 | เพิ่ม 1 ช็อต:10 | เพิ่ม 2 ช็อต:20" },
  { name: "นม", select: "เดี่ยว", required: "N", visible: "ทุกแบบ", choices: "นมปกติ:0 | นมโอ๊ต:20 | นมอัลมอนด์:25 | นมถั่วเหลือง:15" },
];
