// Recruit — server-side IQ scoring helper
// คำนวณจำนวนข้อถูกในแบบทดสอบ IQ จาก posting.fieldSchema + application.answers
// Logic ต้องตรงกับ ApplicationTabs (isCorrect) เป๊ะ ไม่งั้นตัวเลขในตารางจะไม่ตรงกับหน้าประวัติ

import { FormSchemaSchema } from "./types";
import { partitionIqSections } from "./iq-sections";

export interface IqStats {
  correct: number;
  total: number;
}

/** Serialize a raw answer value the same way the detail tab does. */
function serializeRaw(val: unknown): string {
  if (val == null) return "";
  return typeof val === "string" ? val : JSON.stringify(val);
}

/**
 * Compute IQ correct/total for one application.
 * Returns null when the posting has no IQ section (so callers can show "—").
 */
export function computeIqStats(
  fieldSchema: unknown,
  answers: unknown,
): IqStats | null {
  let schema;
  try {
    schema = FormSchemaSchema.parse(fieldSchema);
  } catch {
    return null;
  }

  // นับ "ทุกหมวด IQ" ไม่ใช่หมวดแรกหมวดเดียว (ประกาศเดียวมี IQ ได้หลายหมวด เช่น ตัวหนังสือ + ไอคิวจากรูป)
  const { iqSections } = partitionIqSections(schema.sections);
  if (iqSections.length === 0) return null;

  const ans = (answers ?? {}) as Record<string, unknown>;
  let correct = 0;
  let total = 0;

  for (const section of iqSections) {
    for (const f of section.fields) {
      if (!f.hasCorrectAnswer || f.correctAnswer == null) continue;
      total++;
      const rawValue = serializeRaw(ans[f.id]);
      if (Array.isArray(f.correctAnswer)) {
        if (f.correctAnswer.includes(rawValue)) correct++;
      } else if (
        String(f.correctAnswer).trim().toLowerCase() ===
        String(rawValue).trim().toLowerCase()
      ) {
        correct++;
      }
    }
  }

  if (total === 0) return null;
  return { correct, total };
}
