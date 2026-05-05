// Usage knowledge base — feeds the AI Assistant so it can answer
// "how do I use X?" / "where do I do Y?" questions.
// Each entry: page path → human description + main features + tips.
//
// Keep concise — total payload should stay under ~1.5K tokens to leave
// room for live data context.

export interface PageGuide {
  /** Path prefix this guide applies to (longest match wins) */
  match: string;
  title: string;
  audience: string;
  whatYouCanDo: string[];
  /** Common questions this page should be able to answer */
  faqs?: Array<{ q: string; a: string }>;
}

export const PAGE_GUIDES: PageGuide[] = [
  // -------------------- Home --------------------
  {
    match: "/home",
    title: "หน้าหลัก (Home)",
    audience: "ทุก role — เปิด default ตามตำแหน่ง",
    whatYouCanDo: [
      "Owner/Admin: เห็น Module Launcher (CashHub/FuelOS/DocuFlow), Admin Actions, System Health",
      "Manager: เห็น pending approvals + สาขาในความดูแล + ปุ่มกรอกแทน (area_manager)",
      "Staff: ลิงก์ไปกรอกยอดของสาขาที่ assign",
    ],
  },

  // -------------------- CashHub: Dashboard --------------------
  {
    match: "/cashhub/dashboard",
    title: "ภาพรวม CashHub",
    audience: "Owner / Admin / Area Manager",
    whatYouCanDo: [
      "เห็น Executive Table — ยอดขายแยกตามประเภทธุรกิจ × เดือน (สลับรายเดือน/รายวันได้)",
      "กดแถวประเภทธุรกิจเพื่อขยายดูแต่ละสาขา",
      "เลื่อนซ้าย-ขวาดูเดือน/วันก่อนหน้า",
      "กดสาขาในตารางเพื่อ drill-down ไปหน้าสาขา",
    ],
    faqs: [
      {
        q: "อยากดูเฉพาะบริษัทเดียว",
        a: "เปลี่ยนตัวกรอง 'บริษัท' บนหัวเว็บข้างปุ่ม CashHub — เลือกบริษัทแล้วทุกหน้าจะกรองตามนั้น",
      },
      {
        q: "อยากดูยอดรายวัน",
        a: "กดปุ่ม 'รายวัน' บน Executive Table — จะสลับเป็น 30 วันล่าสุดแทน 12 เดือน",
      },
    ],
  },

  // -------------------- CashHub: Reports --------------------
  {
    match: "/cashhub/reports",
    title: "รายงานทั้งหมด",
    audience: "Owner / Admin / Manager",
    whatYouCanDo: [
      "ดูรายงานรายวันทุกสาขา + filter ประเภทธุรกิจ + ช่วงวัน",
      "อนุมัติแบบ batch — ติ๊ก checkbox หลายอันพร้อมกันแล้วกดอนุมัติ",
      "เห็นสถานะ: รออนุมัติ / อนุมัติแล้ว / ปฏิเสธ / ยังไม่ส่ง",
      "กดเข้าแต่ละรายงานเพื่อดูรายละเอียด + อนุมัติ/ปฏิเสธ",
    ],
  },

  // -------------------- CashHub: Branches --------------------
  {
    match: "/cashhub/branches/",
    title: "หน้าสาขา (Branch Detail)",
    audience: "ทุก role ที่เกี่ยวข้องกับสาขานี้",
    whatYouCanDo: [
      "ดูยอดเดือนนี้ + เทียบเดือนก่อน + คาดสิ้นเดือน",
      "Streak ปัจจุบัน + สูงสุด · กราฟ 7 วัน · Heatmap ปฏิทินเดือนนี้",
      "ประวัติ 10 รายการล่าสุด · ข้อมูลผู้จัดการ + เบอร์โทร + Deadline",
    ],
  },

  // -------------------- CashHub: Leaderboard / Heatmap / Compare --------------------
  {
    match: "/cashhub/leaderboard",
    title: "Leaderboard",
    audience: "Owner / Admin",
    whatYouCanDo: [
      "เห็นอันดับสาขาตามยอดเดือนนี้ + เทียบกับเดือนก่อน",
      "ดูได้ทั้งภาพรวม + แยกประเภทธุรกิจ",
    ],
  },
  {
    match: "/cashhub/heatmap",
    title: "Heatmap ปฏิทิน",
    audience: "Owner / Admin",
    whatYouCanDo: [
      "เห็น pattern ยอดขายตามวันในรอบเดือน — สีเข้ม = ขายดี",
      "ระบุวันที่ผิดปกติ (สูงเกิน/ต่ำเกิน)",
    ],
  },
  {
    match: "/cashhub/shortages",
    title: "เงินขาด",
    audience: "Owner / Admin / Manager",
    whatYouCanDo: [
      "ดูรายการเงินขาดทั้งหมด · ใครรับผิดชอบ · จำนวนเงิน",
      "Track ว่าใครเงินขาดบ่อย",
    ],
  },
  {
    match: "/cashhub/notes",
    title: "โน้ตจาก Staff",
    audience: "Owner / Admin / Manager",
    whatYouCanDo: [
      "ดูหมายเหตุที่พนักงานเขียนตอนกรอกรายงาน — เช่น เครื่องเสีย, ปัญหาช่วงวัน",
    ],
  },
  {
    match: "/cashhub/monthly-report",
    title: "รายงานเดือน (PDF)",
    audience: "Owner / Admin",
    whatYouCanDo: ["Generate รายงานสรุปประจำเดือนเป็น PDF เพื่อพิมพ์/ส่งให้สำนักงานใหญ่"],
  },

  // -------------------- CashHub: Settings & Forms --------------------
  {
    match: "/cashhub/settings/forms",
    title: "ฟอร์มกรอกยอด (จัดการ)",
    audience: "Super Admin / Org Admin เท่านั้น",
    whatYouCanDo: [
      "แก้ label / hint / placeholder ของแต่ละช่องในฟอร์มกรอกยอดของแต่ละประเภทธุรกิจ",
      "ซ่อน/แสดงช่องที่ไม่จำเป็นได้ (ยกเว้นช่องล็อก)",
      "เปิด/ปิด required ของช่อง (ยกเว้นช่องล็อก)",
      "ดู Live Preview เป็นกรอบมือถือเห็นทันทีว่าพนักงานจะเห็นแบบไหน",
    ],
    faqs: [
      {
        q: "ลบช่องสำคัญไม่ได้",
        a: "ช่องที่ล็อก (เช่น ยอดขาย, จำนวนลิตร/แก้ว) ตั้งใจห้ามซ่อนเพื่อกันรายงานพังทั้งระบบ",
      },
      {
        q: "ปุ่มย้อนกลับไม่ทำงาน",
        a: "ตอนนี้ทุกหน้าใช้ browser back — กดปุ่ม < ในเบราว์เซอร์หรือปุ่ม 'กลับ' จะไปหน้าก่อนหน้าจริง",
      },
    ],
  },
  {
    match: "/cashhub/settings",
    title: "ตั้งค่า CashHub",
    audience: "Super Admin / Org Admin เท่านั้น",
    whatYouCanDo: [
      "ตั้ง deadline ส่งรายงานเริ่มต้น (ค่ามาตรฐาน 21:00)",
      "เลือก Reconcile Mode: Binary (เคร่ง) หรือ Tolerance (ผ่อนปรน N%)",
      "Spike Multiplier — แจ้งเตือนเมื่อยอดสูงกว่าเฉลี่ย 30 วัน × ค่านี้",
      "Off-hours window — เตือนเมื่อกรอกผิดเวลา",
    ],
  },

  // -------------------- CashHub: Quick Fill (area_manager+) --------------------
  {
    match: "/cashhub/quick-fill",
    title: "กรอกแทน (ทุกสาขา)",
    audience: "Super Admin / Org Admin / Area Manager",
    whatYouCanDo: [
      "เลือกสาขาใดก็ได้ในบริษัท + กรอกยอดแทนพนักงาน",
      "Filter: บริษัท + ประเภทธุรกิจ + ค้นหาด้วยรหัส/ชื่อ",
    ],
  },

  // -------------------- LIFF (พนักงานกรอก) --------------------
  {
    match: "/liff/report",
    title: "ฟอร์มกรอกยอดของพนักงาน",
    audience: "Staff / Branch Manager / Area Manager+",
    whatYouCanDo: [
      "กรอกยอดขาย + ช่องทางรับเงิน · ระบบจะ Reconcile อัตโนมัติ (ถ้าตั้งไว้)",
      "ถ้ามีเงินขาด — ต้องระบุว่าใครรับผิดชอบ",
      "Draft จะ save อัตโนมัติทุก 0.5 วินาที — ปิดแอปแล้วเปิดมาต่อได้",
    ],
  },

  // -------------------- Admin: Users / Branches / Companies --------------------
  {
    match: "/users",
    title: "ทีม & สาขา",
    audience: "Admin",
    whatYouCanDo: [
      "ดูรายชื่อผู้ใช้ทั้งหมด + role + สาขาที่ผูกอยู่",
      "เพิ่มผู้ใช้ใหม่ (manual หรือ import CSV)",
      "Approve คำขอเข้าร่วม (join request)",
      "แก้ไข/ปิดการใช้งานผู้ใช้",
    ],
  },
  {
    match: "/companies",
    title: "บริษัท",
    audience: "Admin",
    whatYouCanDo: [
      "ดูรายชื่อนิติบุคคล (ปกติ Pooilgroup มี 2: Pooil Oil + JP Sync Group)",
      "ดูสาขาในแต่ละบริษัท + ผู้รับผิดชอบ",
    ],
  },
  {
    match: "/branches",
    title: "จัดการสาขา (Core)",
    audience: "Admin",
    whatYouCanDo: [
      "เพิ่ม/แก้ไข/ปิดสาขา · ตั้งบริษัท + ประเภทธุรกิจ",
      "Import สาขาจำนวนมากจาก CSV",
    ],
  },
  {
    match: "/audit",
    title: "Audit Log",
    audience: "Admin",
    whatYouCanDo: ["ดูประวัติทุกการกระทำสำคัญ — login, อนุมัติ, แก้ไขข้อมูล"],
  },
  {
    match: "/settings",
    title: "ตั้งค่าทั่วไป (Core)",
    audience: "Super Admin",
    whatYouCanDo: ["แก้ชื่อองค์กร, logo, timezone, currency, default settings"],
  },
];

export function findPageGuide(pathname: string): PageGuide | null {
  // longest prefix match
  let best: PageGuide | null = null;
  let bestLen = 0;
  for (const g of PAGE_GUIDES) {
    if (pathname.startsWith(g.match) && g.match.length > bestLen) {
      best = g;
      bestLen = g.match.length;
    }
  }
  return best;
}

export function pageGuideToText(g: PageGuide): string {
  const lines: string[] = [];
  lines.push(`หน้านี้: ${g.title}`);
  lines.push(`สำหรับ: ${g.audience}`);
  lines.push(`ทำได้:`);
  for (const x of g.whatYouCanDo) lines.push(`  - ${x}`);
  if (g.faqs?.length) {
    lines.push(`คำถามที่พบบ่อย:`);
    for (const f of g.faqs) lines.push(`  Q: ${f.q}\n  A: ${f.a}`);
  }
  return lines.join("\n");
}

/**
 * Compact list of all features — used when user asks "where can I do X?".
 * Stays small (~one line per page).
 */
export function allPagesIndex(): string {
  return PAGE_GUIDES.map(
    (g) =>
      `- ${g.match} → ${g.title} (${g.audience}): ${g.whatYouCanDo[0] ?? ""}`,
  ).join("\n");
}
