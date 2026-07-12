// Recruit — helpers to turn a posting's form schema + an application's raw
// answers into human-readable table columns / values.
//
// ใช้ร่วมกันหลายที่: ตารางคำตอบ (table) · batch AI · bias-safe prompt builder
// - getAnswerColumns()   → คอลัมน์ "คำตอบโปรไฟล์" (ตัดข้อสอบ IQ + ไฟล์แนบออก)
// - formatAnswerValue()  → แปลงค่า (value → label ของตัวเลือก · yes/no ไทย ฯลฯ)
// - buildBiasSafeAnswerLines() → บรรทัด "label: value" สำหรับป้อน AI (ตัด อายุ/เพศ/รูป)

import type { Field, FormSchema } from "./types";

export interface AppFileMeta {
  key: string;
  name: string;
  size: number;
  mime: string;
  url?: string; // Google Drive share link (when stored on Drive)
  storage?: string; // "drive" | undefined (R2)
}

export interface AnswerColumn {
  id: string;
  label: string;
  long: boolean; // long_text → ให้ตารางตัดสั้น/กดขยาย
  field: Field; // เก็บไว้ format ค่าฝั่ง server (ไม่ส่งต่อไป client)
}

/** ตรวจว่า section นี้คือส่วน "ข้อสอบ IQ" หรือไม่ (ตรรกะเดียวกับ computeIqStats). */
function isIqSection(title: string, id: string): boolean {
  return (
    id === "iq_test" ||
    title.toLowerCase().includes("iq") ||
    title.includes("ไอคิว")
  );
}

/**
 * คอลัมน์คำตอบที่ควรกางในตาราง = ทุก field ที่ไม่ใช่ข้อสอบ IQ และไม่ใช่ไฟล์แนบ.
 * (ไฟล์แนบมีคอลัมน์ "ไฟล์" แยกอยู่แล้ว · ข้อสอบ IQ สรุปเป็นคอลัมน์ IQ x/y)
 */
export function getAnswerColumns(schema: FormSchema): AnswerColumn[] {
  const cols: AnswerColumn[] = [];
  for (const section of schema.sections) {
    if (isIqSection(section.title, section.id)) continue;
    for (const field of section.fields) {
      if (field.type === "file") continue;
      if (field.hasCorrectAnswer) continue; // เผื่อข้อสอบหลุดอยู่นอก section IQ
      cols.push({
        id: field.id,
        label: field.label,
        long: field.type === "long_text",
        field,
      });
    }
  }
  return cols;
}

/** แปลงค่า raw ของคำตอบ 1 ข้อ ให้เป็นข้อความอ่านง่าย (value→label, ใช่/ไม่ใช่ ฯลฯ). */
export function formatAnswerValue(field: Field, value: unknown): string {
  if (value == null || value === "") return "";

  switch (field.type) {
    case "yes_no":
      return value === "yes" ? "ใช่" : value === "no" ? "ไม่ใช่" : String(value);
    case "dropdown":
    case "radio": {
      const opt = field.options?.find((o) => o.value === value);
      return opt?.label ?? String(value);
    }
    case "checkbox": {
      const arr = Array.isArray(value) ? value : [value];
      return arr
        .map((v) => field.options?.find((o) => o.value === v)?.label ?? String(v))
        .join(", ");
    }
    case "range":
    case "number":
      return field.unit ? `${value} ${field.unit}` : String(value);
    default: {
      if (Array.isArray(value)) return value.join(", ");
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    }
  }
}

/**
 * บรรทัด "label: value" สำหรับป้อนให้ AI ประเมิน — ตัดฟิลด์ที่อาจทำให้เกิดอคติ
 * (อายุ / เพศ / รูป) และไฟล์แนบออก. ใช้ตรรกะเดียวกับ scoreCandidate/scoreResume.
 */
export function buildBiasSafeAnswerLines(
  schema: FormSchema,
  answers: Record<string, unknown>,
): string[] {
  const lines: string[] = [];
  for (const section of schema.sections) {
    for (const field of section.fields) {
      const lower = field.label.toLowerCase();
      if (
        lower.includes("อายุ") ||
        lower.includes("เพศ") ||
        lower.includes("รูป") ||
        field.type === "file"
      ) {
        continue;
      }
      const val = answers[field.id];
      if (val == null || val === "") continue;
      lines.push(`${field.label}: ${formatAnswerValue(field, val)}`);
    }
  }
  return lines;
}
