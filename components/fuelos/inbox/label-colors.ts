// ชุดสีป้าย/หมวดหมู่แชท — ใช้เฉพาะ token ที่มีจริงใน theme (กัน Tailwind v4 drop class เงียบ)
// brand/leaf = มี scale เต็ม · warning/danger/info/success = single token (ใช้ opacity) · zinc = มาตรฐาน
export const LABEL_COLORS = ["brand", "leaf", "warning", "danger", "info", "success", "zinc"] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

type Tone = { chip: string; dot: string; name: string };

export const LABEL_TONE: Record<string, Tone> = {
  brand:   { chip: "bg-brand-50 text-brand-700 border-brand-200", dot: "bg-brand-500", name: "ฟ้า" },
  leaf:    { chip: "bg-leaf-50 text-leaf-700 border-leaf-200", dot: "bg-leaf-500", name: "เขียว" },
  warning: { chip: "bg-warning/10 text-warning border-warning/30", dot: "bg-warning", name: "ส้ม" },
  danger:  { chip: "bg-danger/10 text-danger border-danger/30", dot: "bg-danger", name: "แดง" },
  info:    { chip: "bg-info/10 text-info border-info/30", dot: "bg-info", name: "น้ำเงิน" },
  success: { chip: "bg-success/10 text-success border-success/30", dot: "bg-success", name: "เขียวสด" },
  zinc:    { chip: "bg-zinc-100 text-zinc-600 border-zinc-300", dot: "bg-zinc-400", name: "เทา" },
};

export const labelTone = (c: string): Tone => LABEL_TONE[c] ?? LABEL_TONE.brand;
