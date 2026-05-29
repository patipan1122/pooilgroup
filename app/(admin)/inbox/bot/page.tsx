// /inbox/bot — No-code bot training for the massage-chair business (chairops).
// The CEO trains the AI chatbot here: FAQ pairs, store knowledge, bot settings,
// and a queue of questions the bot couldn't answer (one-click "teach the bot").

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/module-access";
import {
  listFaqs,
  listKnowledge,
  getBotSettingsForm,
  listUnanswered,
} from "@/lib/inbox/bot/knowledge-actions";
import { Section } from "@/components/ui/section";
import { BotTrainer } from "./_components/bot-trainer";

export const dynamic = "force-dynamic";

const BUSINESS_TAG = "chairops";

export default async function InboxBotPage() {
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) redirect("/403");

  const [faqs, knowledge, settings, unanswered] = await Promise.all([
    listFaqs(BUSINESS_TAG),
    listKnowledge(BUSINESS_TAG),
    getBotSettingsForm(BUSINESS_TAG),
    listUnanswered(BUSINESS_TAG),
  ]);

  return (
    <div className="p-5 sm:p-8 max-w-[1600px] mx-auto">
      <Section
        number="IB.2"
        label="ฝึกบอทตอบลูกค้า"
        title="สอนบอทเก้าอี้นวด"
        description="ตั้งคำตอบสำเร็จรูป + ข้อมูลร้าน เพื่อให้บอทตอบลูกค้าแทนคุณได้ทันที · ไม่ต้องเขียนโค้ด"
      >
        <BotTrainer
          businessTag={BUSINESS_TAG}
          initialFaqs={faqs}
          initialKnowledge={knowledge}
          initialSettings={settings}
          initialUnanswered={unanswered.map((u) => ({
            id: u.id,
            question: u.question,
            createdAt: u.createdAt.toISOString(),
          }))}
        />
      </Section>
    </div>
  );
}
