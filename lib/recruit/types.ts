// Recruit module — field schema types + zod validators
// Form schema is stored as JSON in `recruit_job_postings.field_schema`
// Versioned: bump `version` when shape changes incompatibly.

import { z } from "zod";

export const FIELD_TYPES = [
  "short_text",
  "long_text",
  "yes_no",
  "dropdown",
  "radio",
  "checkbox",
  "range",
  "number",
  "date",
  "file",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  short_text: "ปลายเปิด สั้น",
  long_text: "ปลายเปิด ยาว",
  yes_no: "ปลายปิด (ใช่/ไม่ใช่)",
  dropdown: "เลือก 1 จากรายการ",
  radio: "เลือก 1 (ปุ่มกลม)",
  checkbox: "เลือกหลาย (ติ๊ก)",
  range: "ช่วง (slider)",
  number: "ตัวเลข",
  date: "วันที่",
  file: "อัปโหลดไฟล์ / รูป",
};

export const FIELD_TYPE_ICONS: Record<FieldType, string> = {
  short_text: "📝",
  long_text: "📄",
  yes_no: "🔘",
  dropdown: "🔽",
  radio: "⚪",
  checkbox: "☑",
  range: "📏",
  number: "🔢",
  date: "📅",
  file: "📎",
};

export const FieldOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
});
export type FieldOption = z.infer<typeof FieldOptionSchema>;

export const FieldSchema = z.object({
  id: z.string().min(1),
  type: z.enum(FIELD_TYPES),
  label: z.string().min(1).max(200),
  required: z.boolean().default(false),
  helpText: z.string().max(500).optional(),
  placeholder: z.string().max(200).optional(),
  // short_text
  format: z.enum(["phone", "email", "thai_id", "url"]).optional(),
  maxLength: z.number().int().positive().optional(),
  minLength: z.number().int().nonnegative().optional(),
  // number, range
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
  unit: z.string().max(20).optional(),
  // dropdown, radio, checkbox
  options: z.array(FieldOptionSchema).optional(),
  // checkbox
  minSelections: z.number().int().nonnegative().optional(),
  maxSelections: z.number().int().positive().optional(),
  // file
  accept: z.array(z.string()).optional(),
  maxFileSize: z.number().int().positive().optional(), // bytes
  maxFiles: z.number().int().positive().optional(),
  // IQ mode (any field type with a correct answer)
  hasCorrectAnswer: z.boolean().optional(),
  correctAnswer: z.union([z.string(), z.array(z.string())]).optional(),
  correctPoints: z.number().int().positive().optional(),
});
export type Field = z.infer<typeof FieldSchema>;

export const FormSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  fields: z.array(FieldSchema),
});
export type FormSection = z.infer<typeof FormSectionSchema>;

export const FormSchemaSchema = z.object({
  version: z.literal(1),
  sections: z.array(FormSectionSchema),
});
export type FormSchema = z.infer<typeof FormSchemaSchema>;

export const EMPTY_FORM_SCHEMA: FormSchema = {
  version: 1,
  sections: [
    {
      id: "default",
      title: "ข้อมูลผู้สมัคร",
      fields: [],
    },
  ],
};

// Status helpers
export const APPLICATION_STATUSES = [
  "NEW",
  "SCREENING",
  "INTERVIEW",
  "OFFERED",
  "HIRED",
  "REJECTED",
  "WITHDRAWN",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  NEW: "ใหม่",
  SCREENING: "คัดกรอง",
  INTERVIEW: "สัมภาษณ์",
  OFFERED: "เสนอ",
  HIRED: "รับเข้า",
  REJECTED: "ไม่รับ",
  WITHDRAWN: "ถอน",
};

export const STATUS_TONE: Record<
  ApplicationStatus,
  "neutral" | "brand" | "warning" | "success" | "danger" | "info"
> = {
  NEW: "brand",
  SCREENING: "info",
  INTERVIEW: "warning",
  OFFERED: "warning",
  HIRED: "success",
  REJECTED: "danger",
  WITHDRAWN: "neutral",
};

// Status that requires follow-up action from HR
export const FOLLOWUP_STATUSES: ApplicationStatus[] = [
  "SCREENING",
  "INTERVIEW",
  "OFFERED",
];

// Posting status
export const POSTING_STATUSES = ["DRAFT", "OPEN", "CLOSED", "ARCHIVED"] as const;
export type PostingStatus = (typeof POSTING_STATUSES)[number];

export const POSTING_STATUS_LABELS: Record<PostingStatus, string> = {
  DRAFT: "ฉบับร่าง",
  OPEN: "เปิดรับ",
  CLOSED: "ปิดรับ",
  ARCHIVED: "เก็บถาวร",
};

// Helper: get all fields flat (across sections)
export function getAllFields(schema: FormSchema): Field[] {
  return schema.sections.flatMap((s) => s.fields);
}

// Helper: build runtime validator from form schema
export function buildAnswerValidator(schema: FormSchema) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const section of schema.sections) {
    for (const field of section.fields) {
      let validator: z.ZodTypeAny = z.unknown();

      switch (field.type) {
        case "short_text":
        case "long_text":
          validator = z.string().max(field.maxLength ?? 5000);
          if (field.format === "phone") {
            validator = z
              .string()
              .regex(/^0\d{8,9}$/, "กรอกเบอร์โทร 9-10 หลัก ขึ้นต้นด้วย 0");
          } else if (field.format === "email") {
            validator = z.string().email("รูปแบบอีเมลไม่ถูกต้อง");
          } else if (field.format === "thai_id") {
            validator = z.string().regex(/^\d{13}$/, "กรอกเลขบัตร 13 หลัก");
          }
          break;
        case "yes_no":
          validator = z.enum(["yes", "no"]);
          break;
        case "dropdown":
        case "radio":
          validator = z.string();
          break;
        case "checkbox":
          validator = z.array(z.string());
          if (field.minSelections != null) {
            validator = (validator as z.ZodArray<z.ZodString>).min(
              field.minSelections,
              `เลือกอย่างน้อย ${field.minSelections} ข้อ`,
            );
          }
          if (field.maxSelections != null) {
            validator = (validator as z.ZodArray<z.ZodString>).max(
              field.maxSelections,
              `เลือกได้ไม่เกิน ${field.maxSelections} ข้อ`,
            );
          }
          break;
        case "range":
        case "number":
          validator = z.coerce.number();
          if (field.min != null) {
            validator = (validator as z.ZodNumber).min(field.min);
          }
          if (field.max != null) {
            validator = (validator as z.ZodNumber).max(field.max);
          }
          break;
        case "date":
          validator = z.string(); // ISO date string
          break;
        case "file":
          // Files are validated separately (R2 upload metadata)
          validator = z.array(
            z.object({
              key: z.string(),
              name: z.string(),
              size: z.number(),
              mime: z.string(),
            }),
          );
          break;
      }

      if (!field.required) {
        validator = validator.optional().nullable();
      }
      shape[field.id] = validator;
    }
  }
  return z.object(shape);
}

// Allowed MIME types for file uploads (CEO Q2: PDF + Word + image)
export const ALLOWED_FILE_MIMES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const ALLOWED_FILE_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "jpg",
  "jpeg",
  "png",
  "webp",
] as const;

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB per file
export const MAX_FILES_PER_APPLICATION = 3;
