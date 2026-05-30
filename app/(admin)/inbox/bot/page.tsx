// /inbox/bot — No-code bot training, per business.  Pick the vertical
// via ?biz= (chairops · pooil · owl_cha · fnb · hotel · playland · other).
// Each business has its own FAQ list, knowledge entries, bot settings,
// and unanswered-question queue (org × businessTag scoped).

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/module-access";
import {
  listFaqs,
  listKnowledge,
  getBotSettingsForm,
  listUnanswered,
} from "@/lib/inbox/bot/knowledge-actions";
import { INBOX_BUSINESSES, businessLabel } from "@/lib/inbox/business";
import { Section } from "@/components/ui/section";
import { BotTrainer } from "./_components/bot-trainer";
import { BusinessSelector } from "./_components/business-selector";

export const dynamic = "force-dynamic";

const BOT_CAPABLE_TAGS = INBOX_BUSINESSES.filter((b) => b.botCapable).map(
  (b) => b.tag,
);

export default async function InboxBotPage({
  searchParams,
}: {
  searchParams: Promise<{ biz?: string }>;
}) {
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) redirect("/403");

  const params = await searchParams;
  const businessTag = BOT_CAPABLE_TAGS.includes(params.biz ?? "")
    ? params.biz!
    : "chairops";

  const [faqs, knowledge, settings, unanswered] = await Promise.all([
    listFaqs(businessTag),
    listKnowledge(businessTag),
    getBotSettingsForm(businessTag),
    listUnanswered(businessTag),
  ]);

  // flowImages lives on the same row as the rest of settings but the form
  // component only knows about the text fields — split here.
  const { flowImages, ...settingsForm } = settings;
  return (
    <div className="p-5 sm:p-8 max-w-[1600px] mx-auto">
      <Section
        number="IB.2"
        label="ฝึกบอทตอบลูกค้า"
        title={`สอนบอท ${businessLabel(businessTag)}`}
        description="ตั้งคำตอบสำเร็จรูป + ข้อมูลร้าน เพื่อให้บอทตอบลูกค้าแทนคุณได้ทันที · ไม่ต้องเขียนโค้ด · เลือกธุรกิจที่จะฝึกได้จากด้านบน"
        action={<BusinessSelector active={businessTag} />}
      >
        <BotTrainer
          key={businessTag}
          businessTag={businessTag}
          initialFaqs={faqs}
          initialKnowledge={knowledge}
          initialSettings={settingsForm}
          initialFlowImages={flowImages}
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
