// Known business tags for grouping channels in the unified inbox.
// Only `chairops` is bot-capable for now (CEO 2026-05-28).

export interface InboxBusiness {
  tag: string;
  label: string;
  /** Whether the AI auto-reply bot can be turned on for this business. */
  botCapable: boolean;
}

// Add a new row when CEO onboards a new vertical — channels reference
// these tags at create time.  Only chairops is bot-capable for now;
// other verticals reply by humans until the CEO turns the bot on.
export const INBOX_BUSINESSES: InboxBusiness[] = [
  { tag: "chairops", label: "เก้าอี้นวด", botCapable: true },
  { tag: "pooil", label: "Pooil / น้ำมัน / แก๊ส", botCapable: false },
  { tag: "owl_cha", label: "Owl Cha / ชา / เครื่องดื่ม", botCapable: false },
  { tag: "fnb", label: "ร้านอาหาร / Café", botCapable: false },
  { tag: "hotel", label: "โรงแรม / ที่พัก", botCapable: false },
  { tag: "playland", label: "Playland / เกม / บันเทิง", botCapable: false },
  { tag: "personal", label: "ส่วนตัว / แฟนเพจ", botCapable: false },
  { tag: "other", label: "อื่นๆ", botCapable: false },
];

export function businessLabel(tag: string | null | undefined): string {
  if (!tag) return "ไม่ระบุ";
  return INBOX_BUSINESSES.find((b) => b.tag === tag)?.label ?? tag;
}

export function isBotCapable(tag: string | null | undefined): boolean {
  if (!tag) return false;
  return INBOX_BUSINESSES.find((b) => b.tag === tag)?.botCapable ?? false;
}

/** Topic tags the bot classifies a conversation into. */
export const INBOX_TOPICS: Record<string, string> = {
  scan_fail: "สแกนไม่ได้",
  money_lost: "เงินหาย/เครื่องไม่ทำงาน",
  strong: "นวดแรงไป",
  buy: "สนใจซื้อ",
  feedback: "แนะนำ/ติชม",
  other: "อื่นๆ",
};

export function topicLabel(tag: string | null | undefined): string {
  if (!tag) return "—";
  return INBOX_TOPICS[tag] ?? tag;
}
