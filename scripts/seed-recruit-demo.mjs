// Seed 4 demo recruit postings (CEO request 2026-05-21)
// Positions: ผู้จัดการโรงแรม · พนักงานปั๊ม · แม่บ้าน · พนักงาน 7-Eleven
// Each posting has: ข้อมูลส่วนตัว + ประสบการณ์ + ความสามารถพิเศษ + IQ test (5 ข้อ) + แนบไฟล์ผลงาน
//
// Run: node scripts/seed-recruit-demo.mjs
// Re-run safe: deletes existing demo slugs first then inserts fresh.

import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORG_ID = "00000000-0000-0000-0000-000000000001";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ============================================================
// Common section: ข้อมูลส่วนตัว (อายุ + เพศ)
// ชื่อ-สกุล / เบอร์ / อีเมล ถูก hardcoded ใน renderer top-level (ไม่ต้องใส่ที่นี่)
// ============================================================
const personalSection = {
  id: "personal",
  title: "ข้อมูลส่วนตัว",
  description: "ระบบจะถามชื่อ เบอร์โทร อีเมล อัตโนมัติด้านบน — ส่วนนี้คือข้อมูลเพิ่มเติม",
  fields: [
    {
      id: "age",
      type: "number",
      label: "อายุ",
      required: true,
      min: 15,
      max: 70,
      unit: "ปี",
      placeholder: "เช่น 28",
    },
    {
      id: "gender",
      type: "radio",
      label: "เพศ",
      required: true,
      options: [
        { value: "male", label: "ชาย" },
        { value: "female", label: "หญิง" },
        { value: "other", label: "อื่น ๆ / ไม่ระบุ" },
      ],
    },
  ],
};

function experienceSection({ yearsLabel = "จำนวนปีประสบการณ์ที่ทำงานในสายที่สมัคร" } = {}) {
  return {
    id: "experience",
    title: "ประสบการณ์ทำงาน",
    fields: [
      {
        id: "experience_years",
        type: "number",
        label: yearsLabel,
        required: true,
        min: 0,
        max: 50,
        unit: "ปี",
        placeholder: "0 = ไม่มีประสบการณ์",
      },
      {
        id: "experience_detail",
        type: "long_text",
        label: "เล่าประสบการณ์ทำงานที่ผ่านมา",
        required: true,
        maxLength: 1500,
        placeholder: "ทำที่ไหน · กี่ปี · หน้าที่อะไร · ทำไมออก",
        helpText: "เขียนแบบสั้น ๆ พอ ไม่ต้องยาวมาก",
      },
      {
        id: "special_skills",
        type: "long_text",
        label: "ความสามารถพิเศษ",
        required: false,
        maxLength: 500,
        placeholder: "เช่น ภาษาอังกฤษได้ · ขับรถได้ · ใช้คอมเก่ง",
      },
    ],
  };
}

const portfolioSection = {
  id: "portfolio",
  title: "แนบไฟล์ผลงาน / เอกสาร",
  description: "PDF / Word / รูปภาพ · ไม่เกิน 5 MB ต่อไฟล์ · แนบได้สูงสุด 3 ไฟล์",
  fields: [
    {
      id: "portfolio_files",
      type: "file",
      label: "ไฟล์ผลงาน (resume, ใบประกาศ, รูปงานที่เคยทำ)",
      required: false,
      maxFiles: 3,
      maxFileSize: 5 * 1024 * 1024,
      helpText: "ถ้าไม่มี ข้ามได้",
    },
  ],
};

// ============================================================
// IQ test sections — 5 ข้อต่อตำแหน่ง · ตัดสินใจตามความเหมาะกับงาน
// ใช้ hasCorrectAnswer + correctAnswer + correctPoints เพื่อให้ HR ดูคะแนนได้
// ============================================================

// 1. ผู้จัดการโรงแรม — เน้นคำนวณ + ภาวะผู้นำ + การจัดการสถานการณ์
const iqHotelManager = {
  id: "iq_test",
  title: "ทดสอบไอคิวและการตัดสินใจ (5 ข้อ)",
  description: "ตอบตามที่คิดว่าถูก ไม่ใช่ข้อสอบ HR ใช้ดูแนวคิดเท่านั้น",
  fields: [
    {
      id: "iq_1",
      type: "number",
      label: "Q1 · โรงแรม 50 ห้อง วันนี้ขายได้ 40 ห้อง อัตราเข้าพัก (Occupancy) กี่ %",
      required: true,
      min: 0,
      max: 100,
      unit: "%",
      hasCorrectAnswer: true,
      correctAnswer: "80",
      correctPoints: 2,
    },
    {
      id: "iq_2",
      type: "number",
      label: "Q2 · รายได้ต่อห้อง 1,200 บาท ต้นทุน 800 บาท กำไรต่อห้องเท่าไหร่",
      required: true,
      min: 0,
      max: 100000,
      unit: "บาท",
      hasCorrectAnswer: true,
      correctAnswer: "400",
      correctPoints: 2,
    },
    {
      id: "iq_3",
      type: "radio",
      label: "Q3 · ลูกค้าจองห้อง twin แต่ห้องเต็มหมด เหลือแต่ king ราคาแพงกว่า · คุณจะทำอันดับแรก?",
      required: true,
      options: [
        { value: "a", label: "ก. ปฏิเสธลูกค้า บอกว่าจองผิด" },
        { value: "b", label: "ข. อัปเกรดห้อง king ให้ฟรี · ขอโทษและรับผิด" },
        { value: "c", label: "ค. บอกให้ลูกค้าจ่ายเพิ่มทันที" },
        { value: "d", label: "ง. โทรเช็คโรงแรมอื่นแทน" },
      ],
      hasCorrectAnswer: true,
      correctAnswer: "b",
      correctPoints: 2,
    },
    {
      id: "iq_4",
      type: "radio",
      label: "Q4 · ในทีม 10 คน มี 1 คนร้องเรียนว่าได้รับมอบหมายไม่ยุติธรรม · คุณทำอันดับแรก?",
      required: true,
      options: [
        { value: "a", label: "ก. เรียกเข้าพบ คุยตัวต่อตัว ฟังก่อนตัดสิน" },
        { value: "b", label: "ข. ประชุมทีม ให้พูดต่อหน้าทุกคน" },
        { value: "c", label: "ค. ไม่สนใจ · ถือว่าเป็นเรื่องส่วนตัว" },
        { value: "d", label: "ง. รีบเปลี่ยน schedule ทันที" },
      ],
      hasCorrectAnswer: true,
      correctAnswer: "a",
      correctPoints: 2,
    },
    {
      id: "iq_5",
      type: "yes_no",
      label: "Q5 · ถ้า ADR (ราคาเฉลี่ยต่อห้อง) เพิ่ม 10% และ Occupancy ลด 5% รายได้รวมเป็นบวกใช่หรือไม่?",
      required: true,
      helpText: "ลองคิด: 1.10 × 0.95 = 1.045 → +4.5%",
      hasCorrectAnswer: true,
      correctAnswer: "yes",
      correctPoints: 2,
    },
  ],
};

// 2. พนักงานปั๊ม — เน้นเงินทอน + ความซื่อสัตย์ + บริการ
const iqGasStation = {
  id: "iq_test",
  title: "ทดสอบไอคิวและสถานการณ์ (5 ข้อ)",
  description: "ตอบตามที่คิดว่าถูก ไม่ใช่ข้อสอบ HR ใช้ดูแนวคิดเท่านั้น",
  fields: [
    {
      id: "iq_1",
      type: "number",
      label: "Q1 · เติมน้ำมัน 837.50 บาท ลูกค้าให้แบงค์ 1,000 บาท ต้องทอนเท่าไหร่",
      required: true,
      min: 0,
      max: 10000,
      unit: "บาท",
      hasCorrectAnswer: true,
      correctAnswer: "162.50",
      correctPoints: 2,
    },
    {
      id: "iq_2",
      type: "number",
      label: "Q2 · น้ำมัน 95 ลิตรละ 38 บาท · เติม 5 ลิตร เป็นเงินกี่บาท",
      required: true,
      min: 0,
      max: 10000,
      unit: "บาท",
      hasCorrectAnswer: true,
      correctAnswer: "190",
      correctPoints: 2,
    },
    {
      id: "iq_3",
      type: "radio",
      label: "Q3 · เจอเงินตกหน้าตู้จ่ายเงิน · ไม่รู้ของใคร · คุณทำอันดับแรก?",
      required: true,
      options: [
        { value: "a", label: "ก. เก็บใส่กระเป๋าก่อน · ค่อยคืนถ้ามีคนถาม" },
        { value: "b", label: "ข. ส่งให้หัวหน้ากะทันที · บันทึกในสมุด" },
        { value: "c", label: "ค. ถามเพื่อนพนักงานก่อน" },
        { value: "d", label: "ง. ปล่อยไว้ตรงนั้น" },
      ],
      hasCorrectAnswer: true,
      correctAnswer: "b",
      correctPoints: 2,
    },
    {
      id: "iq_4",
      type: "radio",
      label: "Q4 · ลูกค้ายื่นแบงค์ 500 แล้วบอกว่า \"ฉันให้ 1,000\" คุณทำอันดับแรก?",
      required: true,
      options: [
        { value: "a", label: "ก. ทอนตามที่ลูกค้าบอก · กลัวลูกค้าโกรธ" },
        { value: "b", label: "ข. ขอให้ลูกค้ารอ · เรียกหัวหน้าหรือเปิดกล้องวงจรปิดดู" },
        { value: "c", label: "ค. ขอเงินคืน · ไม่เติมน้ำมัน" },
        { value: "d", label: "ง. ทอนเพิ่มครึ่งหนึ่ง" },
      ],
      hasCorrectAnswer: true,
      correctAnswer: "b",
      correctPoints: 2,
    },
    {
      id: "iq_5",
      type: "radio",
      label: "Q5 · ได้กลิ่นน้ำมันแรงผิดปกติที่ตู้จ่าย · ลูกค้ายังต่อคิวกันอยู่ · คุณทำอันดับแรก?",
      required: true,
      options: [
        { value: "a", label: "ก. ขายต่อ · เดี๋ยวกลิ่นจะหายเอง" },
        { value: "b", label: "ข. หยุดจ่ายตู้นั้นทันที · แจ้งหัวหน้า · กันลูกค้าไม่ให้เข้าใกล้" },
        { value: "c", label: "ค. โทรหาตำรวจก่อน" },
        { value: "d", label: "ง. ใช้น้ำราดดับกลิ่น" },
      ],
      hasCorrectAnswer: true,
      correctAnswer: "b",
      correctPoints: 2,
    },
  ],
};

// 3. แม่บ้าน — เน้นเวลา + ความละเอียด + จัดการสถานการณ์
const iqMaid = {
  id: "iq_test",
  title: "ทดสอบไอคิวและสถานการณ์ (5 ข้อ)",
  description: "ตอบตามที่คิดว่าถูก ไม่ใช่ข้อสอบ HR ใช้ดูแนวคิดเท่านั้น",
  fields: [
    {
      id: "iq_1",
      type: "number",
      label: "Q1 · ทำห้อง 5 ห้อง ห้องละ 30 นาที · ใช้เวลารวมกี่นาที",
      required: true,
      min: 0,
      max: 600,
      unit: "นาที",
      hasCorrectAnswer: true,
      correctAnswer: "150",
      correctPoints: 2,
    },
    {
      id: "iq_2",
      type: "radio",
      label: "Q2 · เจอแหวนเพชรของลูกค้าตกที่ห้อง · ลูกค้าเช็คเอ้าท์ไปแล้ว · คุณทำอันดับแรก?",
      required: true,
      options: [
        { value: "a", label: "ก. เก็บไว้ก่อน · ค่อยรอลูกค้ากลับมา" },
        { value: "b", label: "ข. แจ้งหัวหน้า + ส่งไปฝ่ายของหาย · บันทึกในสมุด" },
        { value: "c", label: "ค. ขายต่อ · ของไม่มีเจ้าของแล้ว" },
        { value: "d", label: "ง. เอาไปฝากเพื่อน" },
      ],
      hasCorrectAnswer: true,
      correctAnswer: "b",
      correctPoints: 2,
    },
    {
      id: "iq_3",
      type: "radio",
      label: "Q3 · แขกยังนอนอยู่ในห้องเลยเวลาเช็คเอ้าท์ · มีคิวรอเข้าห้องนี้ · คุณทำอันดับแรก?",
      required: true,
      options: [
        { value: "a", label: "ก. เคาะประตูปลุกแขกเอง" },
        { value: "b", label: "ข. แจ้ง front desk ให้โทรไปก่อน · ไม่เข้าเอง" },
        { value: "c", label: "ค. ปล่อยทิ้งไว้ · ค่อยรอ" },
        { value: "d", label: "ง. ใช้บัตร master เปิดเข้าไปดู" },
      ],
      hasCorrectAnswer: true,
      correctAnswer: "b",
      correctPoints: 2,
    },
    {
      id: "iq_4",
      type: "radio",
      label: "Q4 · ผ้าปูที่นอนเปื้อนคราบแปลก ๆ (อาจเป็นเลือด) · คุณทำอันดับแรก?",
      required: true,
      options: [
        { value: "a", label: "ก. ซักทันทีให้เสร็จก่อน" },
        { value: "b", label: "ข. ใส่ถุงแยก · ถ่ายรูป · แจ้งหัวหน้า" },
        { value: "c", label: "ค. ทิ้งเลย · ไม่อยากยุ่ง" },
        { value: "d", label: "ง. เอาไปคืนแขกห้องเดิม" },
      ],
      hasCorrectAnswer: true,
      correctAnswer: "b",
      correctPoints: 2,
    },
    {
      id: "iq_5",
      type: "radio",
      label: "Q5 · หัวหน้าสั่ง 3 อย่างพร้อมกัน: (1) ทำห้อง 305 ด่วน, (2) เก็บผ้าซักรีด, (3) เติมของในรถเข็น · คุณทำอันดับแรก?",
      required: true,
      options: [
        { value: "a", label: "ก. เติมของในรถเข็นก่อน · เพราะใช้กับงานทั้งวัน" },
        { value: "b", label: "ข. ทำห้อง 305 ก่อน · เพราะหัวหน้าบอก \"ด่วน\"" },
        { value: "c", label: "ค. เก็บผ้าซักรีดก่อน · เพราะใกล้สุด" },
        { value: "d", label: "ง. ถามหัวหน้าใหม่อีกรอบว่าจะให้ทำอันไหน" },
      ],
      hasCorrectAnswer: true,
      correctAnswer: "b",
      correctPoints: 2,
    },
  ],
};

// 4. พนักงานร้านสะดวกซื้อ (7-Eleven) — เน้นเงินทอน + บริการลูกค้า + แก้ปัญหาหน้าร้าน
const iqConvenience = {
  id: "iq_test",
  title: "ทดสอบไอคิวและสถานการณ์ (5 ข้อ)",
  description: "ตอบตามที่คิดว่าถูก ไม่ใช่ข้อสอบ HR ใช้ดูแนวคิดเท่านั้น",
  fields: [
    {
      id: "iq_1",
      type: "number",
      label: "Q1 · ลูกค้าซื้อของรวม 67 บาท · ให้แบงค์ 100 · ทอนกี่บาท",
      required: true,
      min: 0,
      max: 1000,
      unit: "บาท",
      hasCorrectAnswer: true,
      correctAnswer: "33",
      correctPoints: 2,
    },
    {
      id: "iq_2",
      type: "number",
      label: "Q2 · นมขวดละ 15 บาท · ซื้อ 4 ขวด · ลด 10% รวมเป็นเงินกี่บาท",
      required: true,
      min: 0,
      max: 10000,
      unit: "บาท",
      hasCorrectAnswer: true,
      correctAnswer: "54",
      correctPoints: 2,
    },
    {
      id: "iq_3",
      type: "radio",
      label: "Q3 · ลูกค้ามาโวยวายว่าซื้อขนมไปกินแล้วหมดอายุ · ในใบเสร็จเขียนวันที่ถูกต้องว่าซื้อวันนี้ · คุณทำอันดับแรก?",
      required: true,
      options: [
        { value: "a", label: "ก. ปฏิเสธ · บอกว่าเป็นความผิดลูกค้า" },
        { value: "b", label: "ข. ขอโทษ · เปลี่ยนสินค้าใหม่ให้ · บันทึกเหตุการณ์แจ้งหัวหน้า" },
        { value: "c", label: "ค. โทรหาตำรวจ" },
        { value: "d", label: "ง. ให้เงินคืนทั้งหมดเลย · ไม่ต้องถาม" },
      ],
      hasCorrectAnswer: true,
      correctAnswer: "b",
      correctPoints: 2,
    },
    {
      id: "iq_4",
      type: "radio",
      label: "Q4 · หน้าร้านคิวยาว 8 คน · เพื่อนร่วมงานคิดเงินช้ามาก · คุณทำอันดับแรก?",
      required: true,
      options: [
        { value: "a", label: "ก. รอเฉย ๆ · ไม่ใช่งานของคุณ" },
        { value: "b", label: "ข. เปิดเครื่องคิดเงินอีกตัว · ช่วยรับลูกค้า · บอกเพื่อนทีหลัง" },
        { value: "c", label: "ค. ต่อว่าเพื่อนร่วมงานตรงนั้น" },
        { value: "d", label: "ง. โทรเรียกผู้จัดการมาทันที" },
      ],
      hasCorrectAnswer: true,
      correctAnswer: "b",
      correctPoints: 2,
    },
    {
      id: "iq_5",
      type: "radio",
      label: "Q5 · ลูกค้าขอใช้ห้องน้ำพนักงาน · ร้านมีนโยบายห้าม · คุณทำอันดับแรก?",
      required: true,
      options: [
        { value: "a", label: "ก. อนุญาตเลย · ไม่ใช่เรื่องใหญ่" },
        { value: "b", label: "ข. ขอโทษ · บอกว่ามีนโยบายไม่อนุญาต · แนะนำห้องน้ำใกล้ ๆ" },
        { value: "c", label: "ค. ปฏิเสธห้วน ๆ · ไม่บอกเหตุผล" },
        { value: "d", label: "ง. ให้ใช้แต่เก็บเงิน 20 บาท" },
      ],
      hasCorrectAnswer: true,
      correctAnswer: "b",
      correctPoints: 2,
    },
  ],
};

// ============================================================
// 4 demo postings
// ============================================================
const POSTINGS = [
  {
    slug: "demo-hotel-manager-2026",
    title: "ผู้จัดการโรงแรม",
    description:
      "รับสมัครผู้จัดการโรงแรม (Hotel Manager) สำหรับสาขาในเครือ Pooil · ดูแลทีม housekeeping + front desk + รายงานรายได้รายวัน · ทำงาน 6 วัน/สัปดาห์ · เงินเดือนเริ่ม 35,000-50,000 บาท",
    fieldSchema: {
      version: 1,
      sections: [
        personalSection,
        experienceSection({ yearsLabel: "ประสบการณ์ในธุรกิจโรงแรม / บริการ" }),
        iqHotelManager,
        portfolioSection,
      ],
    },
  },
  {
    slug: "demo-gas-station-staff-2026",
    title: "พนักงานปั๊มน้ำมัน",
    description:
      "รับสมัครพนักงานปั๊มน้ำมัน (Pump Attendant) ประจำสาขา Pooil · เติมน้ำมัน · รับเงิน · ทำความสะอาดพื้นที่ · เข้ากะเช้า/บ่าย/ดึก · เริ่มต้น 12,000-15,000 บาท + โอที",
    fieldSchema: {
      version: 1,
      sections: [
        personalSection,
        experienceSection({ yearsLabel: "ประสบการณ์ทำงานบริการ / ปั๊มน้ำมัน" }),
        iqGasStation,
        portfolioSection,
      ],
    },
  },
  {
    slug: "demo-housekeeper-2026",
    title: "แม่บ้าน (Housekeeper)",
    description:
      "รับสมัครแม่บ้านประจำโรงแรม/ออฟฟิศในเครือ Pooil · ทำความสะอาดห้องพัก · เปลี่ยนผ้า · เติมของในห้องน้ำ · ทำงาน 6 วัน/สัปดาห์ · เงินเดือน 11,000-14,000 บาท + ค่าที่พัก",
    fieldSchema: {
      version: 1,
      sections: [
        personalSection,
        experienceSection({ yearsLabel: "ประสบการณ์งานแม่บ้าน / ทำความสะอาด" }),
        iqMaid,
        portfolioSection,
      ],
    },
  },
  {
    slug: "demo-convenience-staff-2026",
    title: "พนักงานร้านสะดวกซื้อ (7-Eleven)",
    description:
      "รับสมัครพนักงานร้านสะดวกซื้อในเครือ Pooil · คิดเงิน · เติมสินค้า · ดูแลร้าน · เข้ากะ 8 ชม. · เงินเดือน 11,500-13,500 บาท + โบนัส KPI",
    fieldSchema: {
      version: 1,
      sections: [
        personalSection,
        experienceSection({ yearsLabel: "ประสบการณ์งานบริการ / ร้านสะดวกซื้อ" }),
        iqConvenience,
        portfolioSection,
      ],
    },
  },
];

// ============================================================
// Run
// ============================================================
async function run() {
  console.log("→ Looking up creator user (super_admin in org)…");
  const { data: creator, error: ce } = await sb
    .from("users")
    .select("id, email, role")
    .eq("org_id", ORG_ID)
    .in("role", ["super_admin", "admin"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (ce) {
    console.error("✗ user query failed:", ce.message);
    process.exit(1);
  }
  if (!creator) {
    console.error("✗ no super_admin or admin user found in org");
    process.exit(1);
  }
  console.log(`  ↳ creator = ${creator.email} (role=${creator.role})`);

  console.log("→ Deleting existing demo postings (if any)…");
  const slugs = POSTINGS.map((p) => p.slug);
  const { error: delErr } = await sb
    .from("recruit_job_postings")
    .delete()
    .in("slug", slugs);
  if (delErr) {
    console.warn("  ⚠ delete warning:", delErr.message);
  }

  console.log("→ Inserting 4 demo postings…");
  const now = new Date().toISOString();
  const rows = POSTINGS.map((p) => ({
    id: randomUUID(),
    org_id: ORG_ID,
    company_id: null,
    title: p.title,
    description: p.description,
    slug: p.slug,
    status: "OPEN",
    field_schema: p.fieldSchema,
    settings: {},
    opens_at: now,
    closes_at: null,
    created_by_id: creator.id,
    created_at: now,
    updated_at: now,
  }));

  const { data: inserted, error: insErr } = await sb
    .from("recruit_job_postings")
    .insert(rows)
    .select("id, slug, title, status");

  if (insErr) {
    console.error("✗ insert failed:", insErr.message);
    process.exit(1);
  }

  console.log("");
  console.log("✓ Seeded 4 postings:");
  for (const p of inserted ?? []) {
    console.log(`  · ${p.title}`);
    console.log(`    /apply/${p.slug}`);
  }
  console.log("");
  console.log("Public URLs (เปิด browser เพื่อทดสอบ):");
  console.log("  Local dev:  http://localhost:3000/apply/<slug>");
  console.log("  Production: https://pooilgroup.vercel.app/apply/<slug>");
  console.log("");
}

run().catch((e) => {
  console.error("✗ fatal:", e);
  process.exit(1);
});
