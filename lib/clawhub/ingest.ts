// ClawHub (JOLLY PLAY) — inbound/outbound message ingestion for the LINE chat box.
//
// Mirrors lib/inbox/ingest.ts: one ClawhubConversation per (orgId, lineUserId),
// each message appended to ClawhubMessage. Idempotent on (conversationId,
// externalId) so LINE webhook retries don't dupe (catch P2002). Bumps
// lastMessageText/At + unreadCount on every inbound. logOutbound() persists the
// bot/staff reply (byBot flag) for the admin inbox to render.

import { prisma } from "@/lib/prisma";
import type {
  ClawhubMsgKind,
  ClawhubConversation,
} from "@/lib/generated/prisma/client";
import type { LineProfile } from "./line";

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002"
  );
}

export interface IngestInboundParams {
  orgId: string;
  lineUserId: string;
  /** LINE profile (may be null if the profile fetch failed). */
  profile?: LineProfile | null;
  /** LINE message id — idempotency key. */
  externalId?: string | null;
  kind: ClawhubMsgKind;
  text?: string | null;
  /** R2 object key for stored image content (IMAGE messages). */
  r2Key?: string | null;
  /** Link the conversation to a known member (best-effort). */
  memberId?: string | null;
}

export interface IngestInboundResult {
  conversationId: string;
  messageId: string;
  isNewConversation: boolean;
  /** True when LINE retried a message we already stored. */
  duplicate?: boolean;
  /** Whether the bot should auto-reply to this conversation. */
  botEnabled: boolean;
}

/** Short preview text for the conversation list (image/sticker have no body). */
function previewFor(kind: ClawhubMsgKind, text?: string | null): string {
  if (text && text.trim()) return text.trim().slice(0, 200);
  if (kind === "IMAGE") return "[รูปภาพ]";
  if (kind === "STICKER") return "[สติกเกอร์]";
  return "";
}

/**
 * Ingest one inbound LINE message. Upserts the conversation (by orgId+lineUserId),
 * appends the message idempotently, bumps unread + last-message fields.
 */
export async function ingestInboundMessage(
  p: IngestInboundParams,
): Promise<IngestInboundResult> {
  // Idempotency — LINE retries the same message id. Skip the dupe early.
  if (p.externalId) {
    const existing = await prisma.clawhubMessage.findFirst({
      where: {
        orgId: p.orgId,
        externalId: p.externalId,
        direction: "IN",
        conversation: { lineUserId: p.lineUserId },
      },
      select: { id: true, conversationId: true, conversation: { select: { botEnabled: true } } },
    });
    if (existing) {
      return {
        conversationId: existing.conversationId,
        messageId: existing.id,
        isNewConversation: false,
        duplicate: true,
        botEnabled: existing.conversation.botEnabled,
      };
    }
  }

  const now = new Date();
  const displayName = p.profile?.displayName?.trim() || null;
  const pictureUrl = p.profile?.pictureUrl || null;
  const preview = previewFor(p.kind, p.text);

  const findConvo = (): Promise<Pick<
    ClawhubConversation,
    "id" | "displayName" | "pictureUrl" | "status" | "botEnabled" | "memberId"
  > | null> =>
    prisma.clawhubConversation.findUnique({
      where: { orgId_lineUserId: { orgId: p.orgId, lineUserId: p.lineUserId } },
      select: {
        id: true,
        displayName: true,
        pictureUrl: true,
        status: true,
        botEnabled: true,
        memberId: true,
      },
    });

  let isNewConversation = false;
  let convo = await findConvo();

  if (!convo) {
    try {
      convo = await prisma.clawhubConversation.create({
        data: {
          orgId: p.orgId,
          lineUserId: p.lineUserId,
          memberId: p.memberId ?? null,
          displayName,
          pictureUrl,
          status: "OPEN",
          lastMessageText: preview || null,
          lastMessageAt: now,
          unreadCount: 1,
        },
        select: {
          id: true,
          displayName: true,
          pictureUrl: true,
          status: true,
          botEnabled: true,
          memberId: true,
        },
      });
      isNewConversation = true;
    } catch (e) {
      // Race: a concurrent first message won the insert → re-fetch + update.
      if (isUniqueViolation(e)) {
        convo = await findConvo();
        if (!convo) throw e;
      } else {
        throw e;
      }
    }
  }

  if (!isNewConversation && convo) {
    await prisma.clawhubConversation.update({
      where: { id: convo.id },
      data: {
        // Fill in profile fields if we learned them and didn't have them before.
        displayName: convo.displayName ?? displayName,
        pictureUrl: convo.pictureUrl ?? pictureUrl,
        memberId: convo.memberId ?? p.memberId ?? null,
        lastMessageText: preview || convo.displayName,
        lastMessageAt: now,
        unreadCount: { increment: 1 },
        // Re-open a previously closed thread when the customer writes again.
        status: convo.status === "CLOSED" ? "OPEN" : undefined,
      },
    });
  }

  const conversationId = convo!.id;

  try {
    const msg = await prisma.clawhubMessage.create({
      data: {
        orgId: p.orgId,
        conversationId,
        externalId: p.externalId ?? null,
        direction: "IN",
        kind: p.kind,
        text: p.text ?? null,
        r2Key: p.r2Key ?? null,
        byBot: false,
      },
      select: { id: true },
    });
    return {
      conversationId,
      messageId: msg.id,
      isNewConversation,
      botEnabled: convo!.botEnabled,
    };
  } catch (e) {
    // Concurrent retry inserted the same (conversationId, externalId) first.
    if (isUniqueViolation(e) && p.externalId) {
      const ex = await prisma.clawhubMessage.findFirst({
        where: { conversationId, externalId: p.externalId, direction: "IN" },
        select: { id: true },
      });
      if (ex) {
        return {
          conversationId,
          messageId: ex.id,
          isNewConversation: false,
          duplicate: true,
          botEnabled: convo!.botEnabled,
        };
      }
    }
    throw e;
  }
}

export interface LogOutboundParams {
  orgId: string;
  conversationId: string;
  text: string;
  /** True for bot auto-replies, false for human staff replies. */
  byBot: boolean;
  kind?: ClawhubMsgKind;
  externalId?: string | null;
  r2Key?: string | null;
}

/**
 * Persist an OUT message (bot or human) after it was sent to LINE. Updates the
 * conversation preview/timestamp. Never increments unread (outbound).
 */
export async function logOutbound(p: LogOutboundParams): Promise<string> {
  const msg = await prisma.clawhubMessage.create({
    data: {
      orgId: p.orgId,
      conversationId: p.conversationId,
      externalId: p.externalId ?? null,
      direction: "OUT",
      kind: p.kind ?? "TEXT",
      text: p.text,
      r2Key: p.r2Key ?? null,
      byBot: p.byBot,
    },
    select: { id: true },
  });
  await prisma.clawhubConversation.update({
    where: { id: p.conversationId },
    data: {
      lastMessageText: p.text.slice(0, 200),
      lastMessageAt: new Date(),
    },
  });
  return msg.id;
}

/**
 * บริบทข้อความล่าสุดที่บอทส่ง — ใช้กัน "ตอบวนซ้ำ ๆ" (CEO 2026-08-03).
 * - `escalations`: จำนวนการ์ด "ส่งต่อเจ้าหน้าที่/ครบยอด/เตือนโทร" ที่บอทส่งติด ๆ กัน
 *   ล่าสุด (นับจากท้ายจนเจอการ์ดปกติคั่น) · เกณฑ์ = OUT + byBot + ข้อความมี "เจ้าหน้าที่".
 *   route ใช้ตัดสิน: 0 → ส่งการ์ดเต็ม · 1 → เตือนโทรครั้งเดียว · ≥2 → เงียบ รอคนจริง.
 * - `lastText`: ข้อความล่าสุดที่บอทส่ง (ใช้กันตอบ "ขอบคุณสำหรับรูป" ซ้ำตอนส่งรูปรัว ๆ).
 */
export async function recentBotContext(
  conversationId: string,
): Promise<{ escalations: number; lastText: string; backupSent: boolean }> {
  const recent = await prisma.clawhubMessage.findMany({
    where: { conversationId, direction: "OUT", byBot: true },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { text: true },
  });
  let escalations = 0;
  for (const m of recent) {
    if ((m.text ?? "").includes("เจ้าหน้าที่")) escalations++;
    else break; // เจอการ์ดปกติคั่น = เริ่มนับใหม่ (ลูกค้าได้คำตอบจริงคั่นแล้ว)
  }
  // เคยส่ง "เบอร์สำรอง" ไปแล้วในบทสนทนานี้หรือยัง (กันส่งเบอร์สำรองซ้ำ ๆ).
  const backupSent = recent.some((m) => (m.text ?? "").includes("เบอร์สำรอง"));
  return { escalations, lastText: recent[0]?.text ?? "", backupSent };
}
