// Recruit — helpers to turn a posting's form schema + an application's raw
// answers into human-readable table columns / values.
//
// ใช้ร่วมกันหลายที่: ตารางคำตอบ (table) · batch AI · bias-safe prompt builder
// - getAnswerColumns()   → คอลัมน์ "คำตอบโปรไฟล์" (ตัดข้อสอบ IQ + ไฟล์แนบออก)
// - formatAnswerValue()  → แปลงค่า (value → label ของตัวเลือก · yes/no ไทย ฯลฯ)
// - buildBiasSafeAnswerLines() → บรรทัด "label: value" สำหรับป้อน AI (ตัด อายุ/เพศ/รูป)

import type { Field, FormSchema } from "./types";
import { isIqSection } from "./iq-sections";

// =============================================================
// ข้อมูลตำแหน่งสำหรับ AI (เก็บใน RecruitJobPosting.settings.aiBrief)
// ให้ AI รู้จักงานจริง → ประเมินตรงตำแหน่ง/สาขา ไม่เดา · 0 migration (settings=Json)
// =============================================================
export interface PostingAiBrief {
  about?: string; // ตำแหน่งนี้ทำอะไร (หน้าที่หลัก)
  workplace?: string; // สาขา / สถานที่ทำงาน
  headcount?: string; // ดูแลลูกน้องกี่คน (เก็บเป็น string กันค่าว่าง)
  skills?: string; // ทักษะ/คุณสมบัติสำคัญ
}

/** parse ค่า aiBrief จาก settings JSON แบบปลอดภัย */
export function parsePostingAiBrief(settings: unknown): PostingAiBrief | null {
  if (!settings || typeof settings !== "object") return null;
  const b = (settings as Record<string, unknown>).aiBrief;
  if (!b || typeof b !== "object") return null;
  const rec = b as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const brief: PostingAiBrief = {
    about: str(rec.about),
    workplace: str(rec.workplace),
    headcount: str(rec.headcount),
    skills: str(rec.skills),
  };
  return brief;
}

/** ตำแหน่งนี้มีข้อมูลพอให้ AI ประเมินตรงหรือยัง (ต้องกรอก "ทำอะไร" อย่างน้อย) */
export function hasEnoughJobContext(
  description: string | null | undefined,
  brief: PostingAiBrief | null,
): boolean {
  return Boolean(brief?.about && brief.about.trim().length >= 5);
}

/** รวม JD + aiBrief เป็นข้อความบริบทงานสำหรับป้อน prompt */
export function buildJobContext(
  description: string | null | undefined,
  brief: PostingAiBrief | null,
): string {
  const parts: string[] = [];
  if (description && description.trim()) parts.push(description.trim());
  if (brief) {
    if (brief.about?.trim()) parts.push(`หน้าที่หลักของตำแหน่ง: ${brief.about.trim()}`);
    if (brief.workplace?.trim()) parts.push(`สาขา/สถานที่ทำงาน: ${brief.workplace.trim()}`);
    if (brief.headcount?.trim()) parts.push(`ดูแลลูกน้อง: ${brief.headcount.trim()} คน`);
    if (brief.skills?.trim()) parts.push(`ทักษะ/คุณสมบัติสำคัญ: ${brief.skills.trim()}`);
  }
  return parts.join("\n");
}

/** คำตัดสินสั้น ๆ จากคะแนน AI (0-100) — ให้ CEO อ่านปราดเดียวรู้ */
export function aiVerdict(
  score: number | null | undefined,
): { label: string; tone: "green" | "amber" | "red" } | null {
  if (score == null) return null;
  if (score >= 75) return { label: "เหมาะมาก", tone: "green" };
  if (score >= 50) return { label: "พอพิจารณา", tone: "amber" };
  return { label: "อาจไม่ตรง", tone: "red" };
}

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

/**
 * คอลัมน์คำตอบที่ควรกางในตาราง = ทุก field ที่ไม่ใช่ข้อสอบ IQ และไม่ใช่ไฟล์แนบ.
 * (ไฟล์แนบมีคอลัมน์ "ไฟล์" แยกอยู่แล้ว · ข้อสอบ IQ สรุปเป็นคอลัมน์ IQ x/y)
 * ตรวจ IQ ด้วย isIqSection กลาง (lib/recruit/iq-sections) — ตรงกับ computeIqStats + ApplicationTabs.
 */
export function getAnswerColumns(schema: FormSchema): AnswerColumn[] {
  const cols: AnswerColumn[] = [];
  for (const section of schema.sections) {
    if (isIqSection(section.id, section.title)) continue;
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
