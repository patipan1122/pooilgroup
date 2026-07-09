// Recruit — server-side IQ scoring helper
// คำนวณจำนวนข้อถูกในแบบทดสอบ IQ จาก posting.fieldSchema + application.answers
// Logic ต้องตรงกับ ApplicationTabs (isCorrect) เป๊ะ ไม่งั้นตัวเลขในตารางจะไม่ตรงกับหน้าประวัติ

import { FormSchemaSchema } from "./types";

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

  const iqSection = schema.sections.find(
    (s) =>
      s.id === "iq_test" ||
      s.title.toLowerCase().includes("iq") ||
      s.title.includes("ไอคิว"),
  );
  if (!iqSection) return null;

  const ans = (answers ?? {}) as Record<string, unknown>;
  let correct = 0;
  let total = 0;

  for (const f of iqSection.fields) {
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

  if (total === 0) return null;
  return { correct, total };
}
