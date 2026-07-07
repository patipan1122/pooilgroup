// Section templates — preset blocks HR can insert into FormBuilder to
// speed up creating common application forms.
//
// CEO 2026-05-23: เพิ่มตัวช่วยให้สร้างคำถามเร็วกว่านี้ · มี section preset
// สำหรับข้อมูลส่วนตัว · ไอคิว · คำถามจากรูป (ซ้าย/ขวา/หน้า/หลัง) · เอกสาร
//
// Each template is a self-contained FormSection. The form builder calls
// `cloneTemplate(template)` to insert a fresh copy (with new IDs).

import type { Field, FormSection } from "./types";

export interface SectionTemplate {
  id: string;
  /** Short label shown in chooser modal */
  name: string;
  /** Long description shown under name */
  description: string;
  /** Emoji icon for visual scan */
  icon: string;
  /** Color accent for the chooser card (Tailwind class shorthand) */
  accent: "brand" | "orange" | "purple" | "green" | "amber";
  /** The actual section content cloned on insert */
  section: FormSection;
}

const personalInfo: FormSection = {
  id: "tpl_personal",
  title: "ข้อมูลส่วนตัว",
  description: "ชื่อ-อายุ-เพศ-ที่อยู่ · ข้อมูลพื้นฐานสำหรับติดต่อกลับ",
  fields: [
    {
      id: "f_age",
      type: "number",
      label: "อายุ",
      required: true,
      min: 18,
      max: 65,
      unit: "ปี",
      helpText: "ตำแหน่งนี้รับอายุ 18-65 ปี",
    },
    {
      id: "f_gender",
      type: "radio",
      label: "เพศ",
      required: true,
      options: [
        { value: "male", label: "ชาย" },
        { value: "female", label: "หญิง" },
        { value: "other", label: "อื่น ๆ" },
      ],
    },
    {
      id: "f_province",
      type: "short_text",
      label: "จังหวัดที่อยู่ปัจจุบัน",
      required: true,
      helpText: "เราจะแนะนำสาขาที่ใกล้คุณ",
      maxLength: 80,
    },
    {
      id: "f_education",
      type: "dropdown",
      label: "การศึกษาสูงสุด",
      required: false,
      options: [
        { value: "below_mid", label: "ต่ำกว่า ม.6" },
        { value: "mid", label: "ม.6 / ปวช." },
        { value: "vocational", label: "ปวส. / อนุปริญญา" },
        { value: "bachelor", label: "ปริญญาตรี" },
        { value: "above_bachelor", label: "สูงกว่าปริญญาตรี" },
      ],
    },
  ],
};

const experience: FormSection = {
  id: "tpl_experience",
  title: "ประสบการณ์ทำงาน",
  description: "จำนวนปี + เล่าประสบการณ์ + ทักษะที่ถนัด",
  fields: [
    {
      id: "f_yrs",
      type: "radio",
      label: "ประสบการณ์ในตำแหน่งนี้กี่ปี",
      required: true,
      options: [
        { value: "none", label: "ยังไม่เคย" },
        { value: "lt1", label: "< 1 ปี" },
        { value: "1to2", label: "1-2 ปี" },
        { value: "3to5", label: "3-5 ปี" },
        { value: "gt5", label: "> 5 ปี" },
      ],
    },
    {
      id: "f_story",
      type: "long_text",
      label: "เล่างานที่เคยทำ (1-3 ประโยค)",
      required: false,
      maxLength: 500,
      placeholder: "เช่น เคยขับรถบรรทุก 6 ล้อ ส่งสินค้าใน กทม. 3 ปี",
    },
    {
      id: "f_skills",
      type: "checkbox",
      label: "ทักษะที่ถนัด (เลือกได้หลายข้อ)",
      required: false,
      options: [
        { value: "smile", label: "ยิ้มแย้มกับลูกค้า" },
        { value: "fast", label: "ทำงานเร็ว" },
        { value: "careful", label: "ละเอียดรอบคอบ" },
        { value: "line", label: "ใช้ LINE คล่อง" },
        { value: "english", label: "ภาษาอังกฤษเบื้องต้น" },
        { value: "money", label: "นับเงิน-ทอนเงินคล่อง" },
        { value: "lift", label: "ยก-เคลื่อนของหนักได้" },
      ],
    },
  ],
};

const iqGeneral: FormSection = {
  id: "tpl_iq",
  title: "ทดสอบไอคิวทั่วไป",
  description: "5 คำถาม · ผู้สมัครเลือกตอบ · มีเฉลย AI ช่วยคิดคะแนน",
  fields: [
    {
      id: "iq_q1",
      type: "radio",
      label: "ถ้าลูกค้าโวยวายว่าได้ของผิด คุณจะทำอย่างไร?",
      required: true,
      hasCorrectAnswer: true,
      correctAnswer: "apologize",
      correctPoints: 1,
      options: [
        { value: "argue", label: "โต้กลับว่าไม่ผิด" },
        { value: "ignore", label: "เพิกเฉย ให้เพื่อนจัดการ" },
        { value: "apologize", label: "ขอโทษและรีบหาทางแก้ปัญหา" },
        { value: "blame", label: "โทษเพื่อนร่วมงาน" },
      ],
    },
    {
      id: "iq_q2",
      type: "radio",
      label: "ถ้านับเงินขาด 50 บาทตอนปิดร้าน คุณจะ:",
      required: true,
      hasCorrectAnswer: true,
      correctAnswer: "report",
      correctPoints: 1,
      options: [
        { value: "ignore", label: "ลืม ๆ ไป เดี๋ยวก็ครบเอง" },
        { value: "selfpay", label: "ใส่เงินตัวเองชดเชย ไม่บอกใคร" },
        { value: "report", label: "แจ้งหัวหน้าทันทีและตรวจสอบใหม่" },
        { value: "blame", label: "โทษระบบ POS" },
      ],
    },
    {
      id: "iq_q3",
      type: "radio",
      label: "ถ้าพบเพื่อนร่วมงานขโมยของ คุณจะ:",
      required: true,
      hasCorrectAnswer: true,
      correctAnswer: "report",
      correctPoints: 1,
      options: [
        { value: "ignore", label: "ไม่ยุ่ง · ไม่ใช่เรื่องของฉัน" },
        { value: "report", label: "รายงานผู้จัดการอย่างเป็นทางการ" },
        { value: "warn", label: "เตือนเพื่อนเป็นการส่วนตัว" },
        { value: "join", label: "เอาด้วย ถ้าได้ส่วนแบ่ง" },
      ],
    },
    {
      id: "iq_q4",
      type: "radio",
      label: "10 + 10 × 10 = ?",
      required: true,
      hasCorrectAnswer: true,
      correctAnswer: "110",
      correctPoints: 1,
      options: [
        { value: "200", label: "200" },
        { value: "110", label: "110" },
        { value: "100", label: "100" },
        { value: "120", label: "120" },
      ],
    },
    {
      id: "iq_q5",
      type: "radio",
      label: "ถ้าลูกค้ารีบและคุณกำลังเช็คสต๊อก คุณจะ:",
      required: true,
      hasCorrectAnswer: true,
      correctAnswer: "serve_first",
      correctPoints: 1,
      options: [
        { value: "finish_first", label: "เช็คสต๊อกให้จบก่อน" },
        { value: "serve_first", label: "หยุดเช็ค รีบบริการลูกค้าก่อน" },
        { value: "ignore", label: "บอกลูกค้าให้รอ" },
        { value: "call", label: "เรียกเพื่อนมาแทน" },
      ],
    },
  ],
};

const iqImage: FormSection = {
  id: "tpl_iq_image",
  title: "ไอคิวจากรูป (ทิศทาง / มิติ)",
  description: "4 คำถาม · มีรูปประกอบ · HR ใส่ภาพหลังคลิกที่ field",
  fields: [
    {
      id: "iq_img_1",
      type: "radio",
      label: "ลูกศรในภาพชี้ไปทางไหน?",
      required: true,
      hasCorrectAnswer: true,
      correctAnswer: "right",
      correctPoints: 1,
      helpText: "HR: คลิก field นี้แล้วแนบรูปลูกศรในแผง properties",
      options: [
        { value: "left", label: "ซ้าย" },
        { value: "right", label: "ขวา" },
        { value: "up", label: "ขึ้น" },
        { value: "down", label: "ลง" },
      ],
    },
    {
      id: "iq_img_2",
      type: "radio",
      label: "ภาพนี้ถ่ายจากด้านใด?",
      required: true,
      hasCorrectAnswer: true,
      correctAnswer: "front",
      correctPoints: 1,
      helpText: "HR: แนบรูปวัตถุที่ถ่ายจากด้านหน้า · ด้านข้าง · หลัง",
      options: [
        { value: "front", label: "หน้า" },
        { value: "back", label: "หลัง" },
        { value: "side", label: "ข้าง" },
        { value: "top", label: "บน" },
      ],
    },
    {
      id: "iq_img_3",
      type: "radio",
      label: "ภาพต่อไปในชุดนี้คือ?",
      required: true,
      hasCorrectAnswer: true,
      correctAnswer: "c",
      correctPoints: 1,
      helpText: "HR: แนบภาพชุด pattern · ผู้สมัครเลือกภาพต่อไป",
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
        { value: "c", label: "C" },
        { value: "d", label: "D" },
      ],
    },
    {
      id: "iq_img_4",
      type: "radio",
      label: "วัตถุในภาพมีจำนวนกี่ชิ้น?",
      required: true,
      hasCorrectAnswer: true,
      correctAnswer: "7",
      correctPoints: 1,
      helpText: "HR: แนบภาพกลุ่มวัตถุที่นับยาก",
      options: [
        { value: "5", label: "5" },
        { value: "6", label: "6" },
        { value: "7", label: "7" },
        { value: "8", label: "8" },
      ],
    },
  ],
};

const documents: FormSection = {
  id: "tpl_documents",
  title: "เอกสารแนบ",
  description: "Resume + รูปถ่าย · 5 MB ต่อไฟล์",
  fields: [
    {
      id: "f_resume",
      type: "file",
      label: "Resume (PDF / Word)",
      required: false,
      accept: ["pdf", "doc", "docx"],
      maxFiles: 1,
      helpText: "ไฟล์ขนาดไม่เกิน 5 MB",
    },
    {
      id: "f_photo",
      type: "file",
      label: "รูปถ่าย",
      required: true,
      accept: ["jpg", "jpeg", "png"],
      maxFiles: 1,
      helpText: "รูปครึ่งตัว ชุดสุภาพ",
    },
  ],
};

// CEO 2026-07-05: ฟอร์มประวัติผู้สมัครแบบกรอกง่าย ๆ ครบในชุดเดียว
// (ชื่อจริง + เบอร์ = core fields · ฟอร์มสมัครเก็บให้อัตโนมัติทุกใบ · ไม่ใส่ซ้ำ)
const personalProfile: FormSection = {
  id: "tpl_personal_full",
  title: "ประวัติผู้สมัคร",
  description:
    "ชื่อเล่น · เพศ · อายุ · ประสบการณ์ · ความสามารถพิเศษ · แนบเรซูเม่ (ชื่อจริง + เบอร์ ระบบเก็บให้อัตโนมัติ)",
  fields: [
    {
      id: "pf_nickname",
      type: "short_text",
      label: "ชื่อเล่น",
      required: true,
      maxLength: 40,
    },
    {
      id: "pf_gender",
      type: "radio",
      label: "เพศ",
      required: true,
      options: [
        { value: "male", label: "ชาย" },
        { value: "female", label: "หญิง" },
        { value: "other", label: "อื่น ๆ" },
      ],
    },
    {
      id: "pf_age",
      type: "number",
      label: "อายุ",
      required: true,
      min: 15,
      max: 70,
      unit: "ปี",
    },
    {
      id: "pf_experience",
      type: "long_text",
      label: "ประสบการณ์ทำงานที่ผ่านมา",
      required: false,
      maxLength: 500,
      placeholder:
        "เช่น เคยเป็นแคชเชียร์ 7-11 · 2 ปี · ดูแลสต๊อกและปิดยอดรายวัน",
    },
    {
      id: "pf_skills",
      type: "short_text",
      label: "ความสามารถพิเศษ",
      required: false,
      maxLength: 150,
      helpText: "เช่น ขับรถยนต์/มอเตอร์ไซค์ · ใช้ Excel · ภาษาอังกฤษพอได้",
    },
    {
      id: "pf_about",
      type: "long_text",
      label: "แนะนำตัวเอง + สิ่งที่ภูมิใจ",
      required: false,
      maxLength: 600,
      placeholder:
        "เล่าสั้น ๆ ว่าคุณเป็นคนแบบไหน · จุดเด่น · ผลงานหรือสิ่งที่ภูมิใจ",
    },
    {
      id: "pf_resume",
      type: "file",
      label: "แนบเรซูเม่ / เอกสาร",
      required: false,
      accept: ["pdf", "jpg", "jpeg", "png", "doc", "docx"],
      maxFiles: 3,
      helpText: "แนะนำไฟล์ PDF (AI อ่านให้คะแนนได้) · ไม่เกิน 5 MB ต่อไฟล์",
    },
  ],
};

// CEO 2026-07-05: ชุดข้อสอบไอคิวแบบรูปภาพ (SVG วาดเอง · public/recruit-iq/)
// ผ่านการตรวจปรปักษ์ (ทีมอิสระลองแก้ทุกข้อ) — เก็บเฉพาะข้อที่มีคำตอบเดียวชัดเจน
// Part C: คำแนะนำ "ตำแหน่งไหนใช้ระดับไหน" ฝังใน description ของแต่ละชุด
function iqImg(
  tier: "easy" | "medium" | "hard",
  n: number,
  correct: string,
  label: string,
): Field {
  return {
    id: `iq_${tier}_${n}`,
    type: "radio",
    label,
    required: true,
    hasCorrectAnswer: true,
    correctAnswer: correct,
    correctPoints: 1,
    imageUrl: `/recruit-iq/${tier}-${n}.svg`,
    options: [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
      { value: "c", label: "C" },
      { value: "d", label: "D" },
    ],
  };
}

const iqEasy: FormSection = {
  id: "tpl_iq_easy",
  title: "ไอคิวจากรูป — ระดับง่าย",
  description:
    "8 ข้อ · เหมาะกับ หน้าร้าน/แคชเชียร์ · พนักงานทั่วไป/คลัง · มีรูป + เฉลย ให้คะแนนอัตโนมัติ",
  fields: [
    iqImg("easy", 1, "b", "รูปไหนควรอยู่ตรงเครื่องหมาย ?"),
    iqImg("easy", 2, "c", "ช่องถัดไปควรมีกี่จุด ?"),
    iqImg("easy", 3, "c", "รูปไหนที่แตกต่างจากรูปอื่น ?"),
    iqImg("easy", 4, "b", "รูปไหนควรอยู่ตรงเครื่องหมาย ?"),
    iqImg("easy", 5, "d", "รูปไหนควรอยู่ตรงเครื่องหมาย ?"),
    iqImg("easy", 6, "c", "รูปไหนควรอยู่ตรงเครื่องหมาย ?"),
    iqImg("easy", 7, "d", "ช่องถัดไปควรมีกี่แท่ง ?"),
    iqImg("easy", 8, "a", "รูปไหนควรอยู่ตรงเครื่องหมาย ?"),
  ],
};

const iqMedium: FormSection = {
  id: "tpl_iq_medium",
  title: "ไอคิวจากรูป — ระดับกลาง",
  description:
    "7 ข้อ · เหมาะกับ ช่างเทคนิค · ออฟฟิศ/บัญชี · โจทย์สองกฎซ้อน · มีเฉลย",
  fields: [
    iqImg("medium", 2, "c", "รูปไหนควรอยู่ตรงเครื่องหมาย ? (นับเพิ่มตามแนวนอน + รูปเปลี่ยนตามแนวตั้ง)"),
    iqImg("medium", 4, "a", "รูปไหนควรอยู่ตรงเครื่องหมาย ? (ครึ่งที่ทึบสลับไปอีกด้าน)"),
    iqImg("medium", 5, "c", "รูปไหนควรอยู่ตรงเครื่องหมาย ? (ช่องที่ 3 = ช่อง 1 ซ้อนช่อง 2)"),
    iqImg("medium", 6, "b", "รูปที่ 5 ควรเป็นแบบใด ? (สี่เหลี่ยมหมุน + จุดวิ่งรอบรูป)"),
    iqImg("medium", 7, "c", "รูปไหนควรอยู่ตรงเครื่องหมาย ? (สัญลักษณ์หมุนทีละขั้น)"),
    iqImg("medium", 8, "d", "รูปไหนควรอยู่ตรงเครื่องหมาย ? (รูปเปลี่ยนตามคอลัมน์ + ลายตามแถว)"),
    iqImg("medium", 9, "b", "ช่องไหนควรอยู่ตรงเครื่องหมาย ? (X เลื่อนขวา · O เลื่อนซ้าย)"),
  ],
};

const iqHard: FormSection = {
  id: "tpl_iq_hard",
  title: "ไอคิวจากรูป — ระดับยาก",
  description:
    "4 ข้อ · เหมาะกับ หัวหน้า/ผู้จัดการ · ตำแหน่งที่ต้องคิดวิเคราะห์ · โจทย์หลายกฎ · มีเฉลย",
  fields: [
    iqImg("hard", 2, "c", "รูปถัดไป (ลำดับที่ 5) ควรเป็นรูปไหน ?"),
    iqImg("hard", 5, "b", "รูปถัดไปในลำดับ ควรเป็นรูปไหน ?"),
    iqImg("hard", 6, "b", "รูปไหนควรอยู่ตรงเครื่องหมาย ? (⊕ = ชิ้นที่อยู่ในภาพเดียวเท่านั้น)"),
    iqImg("hard", 7, "a", "รูปถัดไป (ลำดับที่ 5) ควรเป็นรูปไหน ? (X, O เดิน + ลูกศรหมุน)"),
  ],
};

export const SECTION_TEMPLATES: SectionTemplate[] = [
  {
    id: "personal_full",
    name: "ประวัติผู้สมัคร (ครบ)",
    description: "ชื่อเล่น · เพศ · อายุ · ประสบการณ์ · ความสามารถ · แนบเรซูเม่",
    icon: "🧑",
    accent: "brand",
    section: personalProfile,
  },
  {
    id: "personal",
    name: "ข้อมูลส่วนตัว",
    description: "อายุ · เพศ · จังหวัด · การศึกษา",
    icon: "👤",
    accent: "brand",
    section: personalInfo,
  },
  {
    id: "experience",
    name: "ประสบการณ์ทำงาน",
    description: "จำนวนปี · เล่าประสบการณ์ · ทักษะ",
    icon: "💼",
    accent: "orange",
    section: experience,
  },
  {
    id: "iq",
    name: "ทดสอบไอคิวทั่วไป",
    description: "5 คำถาม · มีเฉลย",
    icon: "🧠",
    accent: "purple",
    section: iqGeneral,
  },
  {
    id: "iq_image",
    name: "ไอคิวจากรูป (แนบรูปเอง)",
    description: "4 คำถาม · HR แนบรูปเอง",
    icon: "🖼",
    accent: "purple",
    section: iqImage,
  },
  {
    id: "iq_easy",
    name: "ไอคิวรูป — ระดับง่าย",
    description: "8 ข้อ · หน้าร้าน/แคชเชียร์/ทั่วไป · มีรูป+เฉลย",
    icon: "🟢",
    accent: "green",
    section: iqEasy,
  },
  {
    id: "iq_medium",
    name: "ไอคิวรูป — ระดับกลาง",
    description: "7 ข้อ · ช่าง/ออฟฟิศ/บัญชี · มีรูป+เฉลย",
    icon: "🟡",
    accent: "amber",
    section: iqMedium,
  },
  {
    id: "iq_hard",
    name: "ไอคิวรูป — ระดับยาก",
    description: "4 ข้อ · หัวหน้า/ผู้จัดการ · มีรูป+เฉลย",
    icon: "🔴",
    accent: "purple",
    section: iqHard,
  },
  {
    id: "documents",
    name: "เอกสารแนบ",
    description: "Resume + รูปถ่าย",
    icon: "📎",
    accent: "green",
    section: documents,
  },
];

/** Clone a template with fresh IDs so it can be inserted multiple times. */
export function cloneTemplate(template: SectionTemplate, uid: (prefix?: string) => string): FormSection {
  const newSectionId = uid("sec");
  const newFields: Field[] = template.section.fields.map((f) => ({
    ...f,
    id: uid("f"),
  }));
  return {
    id: newSectionId,
    title: template.section.title,
    description: template.section.description,
    fields: newFields,
  };
}
