// LINE Messaging API helpers — รับ (verify) + ส่ง (push)
import { createHmac, timingSafeEqual } from "node:crypto";

// ตรวจลายเซ็น webhook: HMAC-SHA256(rawBody, channelSecret) base64 == x-line-signature
export function verifyLineSignature(
  channelSecret: string,
  rawBody: string,
  signature: string | null,
): boolean {
  if (!channelSecret || !signature) return false;
  const expected = createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ส่งข้อความเข้า LINE (push) — to = groupId หรือ userId
export async function pushLineMessage(
  accessToken: string,
  to: string,
  text: string,
): Promise<{ ok: boolean; status: number }> {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
  });
  return { ok: res.ok, status: res.status };
}

// ส่งสติกเกอร์เข้า LINE (push) — ใช้ได้เฉพาะสติกเกอร์ชุดมาตรฐานที่ LINE อนุญาต
export async function pushLineSticker(
  accessToken: string,
  to: string,
  packageId: string,
  stickerId: string,
): Promise<{ ok: boolean; status: number }> {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ to, messages: [{ type: "sticker", packageId, stickerId }] }),
  });
  return { ok: res.ok, status: res.status };
}

export type LineProfile = { displayName: string | null; pictureUrl: string | null };

// ดึงโปรไฟล์ (ชื่อ + รูป) แบบ 1:1 — best-effort
export async function fetchLineProfile(
  accessToken: string,
  userId: string,
): Promise<LineProfile | null> {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { displayName?: string; pictureUrl?: string };
    return { displayName: j.displayName ?? null, pictureUrl: j.pictureUrl ?? null };
  } catch {
    return null;
  }
}

// ดึงโปรไฟล์สมาชิกในกลุ่ม (ชื่อ + รูป) — best-effort
export async function fetchLineGroupMemberProfile(
  accessToken: string,
  groupId: string,
  userId: string,
): Promise<LineProfile | null> {
  try {
    const res = await fetch(
      `https://api.line.me/v2/bot/group/${groupId}/member/${userId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { displayName?: string; pictureUrl?: string };
    return { displayName: j.displayName ?? null, pictureUrl: j.pictureUrl ?? null };
  } catch {
    return null;
  }
}

export type LineGroupSummary = { groupName: string | null; pictureUrl: string | null };

// ดึงสรุปกลุ่ม (ชื่อกลุ่ม + รูปกลุ่ม) — best-effort
// ⚠️ ใช้ได้เฉพาะ group เท่านั้น · room (แชทหลายคนชั่วคราว) ไม่มี endpoint นี้ → คืน null
export async function fetchLineGroupSummary(
  accessToken: string,
  groupId: string,
): Promise<LineGroupSummary | null> {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/group/${groupId}/summary`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { groupName?: string; pictureUrl?: string };
    return { groupName: j.groupName ?? null, pictureUrl: j.pictureUrl ?? null };
  } catch {
    return null;
  }
}

// LINE emoji (Sticon) แบบพรีเมียม — ในข้อความ text จะมาเป็น "ตัวแทน" + ข้อมูลแยกใน emojis[]
export type LineEmoji = { index: number; length: number; productId: string; emojiId: string };

// รูปจริงของ LINE emoji — โหลดจาก CDN เดียวกับสติกเกอร์ (android variant ตามที่ repo ใช้อยู่)
export function lineEmojiImageUrl(productId: string, emojiId: string): string {
  return `https://stickershop.line-scdn.net/sticonshop/v1/sticon/${productId}/android/${emojiId}.png`;
}

// แนบชื่อพนักงานนำหน้าข้อความที่ส่งออก (ตัวเลือก A ของ CEO) — ลูกค้าจะเห็นว่าใครคุย
// เช่น "[นัท] ราคาวันนี้ดีเซล 37.35"
export function prefixStaffName(text: string, staffName: string | null | undefined): string {
  const n = (staffName ?? "").trim();
  if (!n) return text;
  return `[${n}] ${text}`;
}

// แปลง message event → ข้อความที่อ่านได้
export function lineMessageToText(m: {
  type: string;
  text?: string;
  stickerId?: string;
}): string {
  switch (m.type) {
    case "text":
      return m.text ?? "";
    case "image":
      return "[รูปภาพ]";
    case "sticker":
      return "[สติกเกอร์]";
    case "video":
      return "[วิดีโอ]";
    case "audio":
      return "[เสียง]";
    case "file":
      return "[ไฟล์]";
    case "location":
      return "[ตำแหน่ง]";
    default:
      return `[${m.type}]`;
  }
}

// metadata ของไฟล์แนบจาก LINE → เก็บลง Message.attachments (jsonb) เพื่อนำไปแสดงจริง
// type "text" = ข้อความที่มี LINE emoji พรีเมียม → เก็บ emojis[] ไว้ render เป็นรูปจริง
export type LineAttachment =
  | { type: "text"; emojis: LineEmoji[] }
  | { type: "image" | "video" | "audio"; messageId: string | null }
  | { type: "sticker"; stickerId: string | null; packageId: string | null }
  | { type: "file"; messageId: string | null; fileName: string | null; fileSize: number | null }
  | { type: "location"; lat: number | null; lng: number | null; title: string | null; address: string | null };

export function lineMessageAttachment(m: {
  type: string;
  id?: string;
  stickerId?: string;
  packageId?: string;
  fileName?: string;
  fileSize?: number;
  latitude?: number;
  longitude?: number;
  title?: string;
  address?: string;
  emojis?: LineEmoji[];
}): LineAttachment | null {
  switch (m.type) {
    case "text":
      // เก็บเฉพาะตอนมี LINE emoji พรีเมียม — ข้อความล้วนไม่ต้องมี attachment
      return m.emojis && m.emojis.length ? { type: "text", emojis: m.emojis } : null;
    case "image":
    case "video":
    case "audio":
      return { type: m.type, messageId: m.id ?? null };
    case "sticker":
      return { type: "sticker", stickerId: m.stickerId ?? null, packageId: m.packageId ?? null };
    case "file":
      return { type: "file", messageId: m.id ?? null, fileName: m.fileName ?? null, fileSize: m.fileSize ?? null };
    case "location":
      return { type: "location", lat: m.latitude ?? null, lng: m.longitude ?? null, title: m.title ?? null, address: m.address ?? null };
    default:
      return null;
  }
}

// ดึง binary content ของ image/video/audio/file จาก LINE (ต้องใช้ access token)
// หมายเหตุ: LINE เก็บ content ไว้ชั่วคราว → รูปเก่ามากอาจดึงไม่ได้ (404)
export async function fetchLineContent(
  accessToken: string,
  messageId: string,
): Promise<{ ok: boolean; status: number; contentType: string; body: ArrayBuffer }> {
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return { ok: false, status: res.status, contentType: "", body: new ArrayBuffer(0) };
  return {
    ok: true,
    status: 200,
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
    body: await res.arrayBuffer(),
  };
}
