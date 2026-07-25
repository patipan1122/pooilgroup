// Webhook ของ OA RentSpace — chatbot ตอบลูกค้าอัตโนมัติ
// รับข้อความ → ระบุผู้เช่าจาก lineUserId → ตอบจากบิลจริง + AI (Gemini) · reply ฟรีไม่กินโควตา
// เปิดใช้: ตั้ง Webhook URL = https://pooilgroup.com/api/rentspace/line/webhook ในหน้า Messaging API
//          แล้วปิด "auto-reply" ของ OA (ให้บอทเราตอบแทน)
import { NextRequest, NextResponse } from "next/server";
import { verifyRentspaceLineSignature, rentspaceReplyText } from "@/lib/rentspace/line";
import { rentspaceBotReply } from "@/lib/rentspace/chatbot";

export const dynamic = "force-dynamic";

type LineEvent = {
  type?: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type?: string; text?: string };
};

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get("x-line-signature");
  if (!verifyRentspaceLineSignature(raw, sig)) {
    return new NextResponse("bad signature", { status: 401 });
  }

  let events: LineEvent[] = [];
  try {
    const body = JSON.parse(raw) as { events?: LineEvent[] };
    events = Array.isArray(body.events) ? body.events : [];
  } catch {
    return NextResponse.json({ ok: true });
  }

  // ตอบทุก event แบบ best-effort (event นึงพังไม่กระทบตัวอื่น) · ต้องคืน 200 เสมอ
  await Promise.allSettled(
    events.map(async (ev) => {
      const replyToken = ev.replyToken;
      const userId = ev.source?.userId;
      if (!replyToken) return;

      if (ev.type === "follow") {
        await rentspaceReplyText(
          replyToken,
          "ขอบคุณที่เพิ่มเพื่อนครับ 🙏\nที่นี่จะแจ้งเตือนเมื่อมีใบแจ้งหนี้ใหม่ และสอบถามเรื่องบิล/การชำระเงินได้ตลอดครับ",
        );
        return;
      }

      if (ev.type === "message" && ev.message?.type === "text" && userId) {
        const answer = await rentspaceBotReply(userId, String(ev.message.text ?? ""));
        await rentspaceReplyText(replyToken, answer);
      }
    }),
  );

  return NextResponse.json({ ok: true });
}

// LINE "Verify" ยิง GET มา → ตอบ 200
export async function GET() {
  return NextResponse.json({ ok: true });
}
