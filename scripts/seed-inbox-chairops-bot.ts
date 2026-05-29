/**
 * Inbox bot — ChairOps starter brain (CEO SOP 2026-05-29)
 *
 * Pre-loads the massage-chair bot so it answers correctly from day 1:
 *  - bot settings: contact phone 084-198-1623, tone, daily summary
 *  - knowledge: prices, payment, machine-number location, how-to-start,
 *    strength adjustment, "machine not working" SOP
 *  - FAQ: price + machine-number quick answers
 *
 * CEO can edit everything later at /inbox/bot (no code).
 *
 * Idempotent: only removes the seed-managed rows (FAQ intent="seed",
 * knowledge by exact title) — keeps any rows the CEO adds by hand.
 *
 * Run AFTER applying migration 20260528100000_inbox_omnichannel.sql:
 *   npx tsx -r dotenv/config scripts/seed-inbox-chairops-bot.ts dotenv_config_path=.env.local
 */

import { prisma } from "@/lib/prisma";

const TAG = "chairops";
const CONTACT_PHONE = "084-198-1623";
const SEED_INTENT = "seed";

async function main() {
  console.log("\n=== Inbox ChairOps bot seed ===\n");

  const org = await prisma.organization.findFirst({ where: { isActive: true } });
  if (!org) throw new Error("no active organization");
  const admin = await prisma.user.findFirst({
    where: { orgId: org.id, role: "super_admin", isActive: true },
  });
  const createdById = admin?.id ?? null;
  console.log(`org=${org.name} · admin=${admin?.name ?? "(none)"}`);

  // 1. Settings (upsert)
  await prisma.inboxBotSettings.upsert({
    where: { orgId_businessTag: { orgId: org.id, businessTag: TAG } },
    create: {
      orgId: org.id,
      businessTag: TAG,
      botEnabled: true,
      tone: "สุภาพ สั้น เป็นกันเอง",
      botName: "นวดน้า",
      contactPhone: CONTACT_PHONE,
      fallbackText: "ขออภัยค่ะ เดี๋ยวทีมงานติดต่อกลับโดยเร็วที่สุดนะคะ 🙏",
      dailySummary: true,
    },
    update: { contactPhone: CONTACT_PHONE, botName: "นวดน้า" },
  });
  console.log("✅ settings (phone " + CONTACT_PHONE + ")");

  // 2. Knowledge (idempotent by title)
  const knowledge: { title: string; content: string }[] = [
    {
      title: "เบอร์ติดต่อทีมงาน",
      content: `โทร ${CONTACT_PHONE} (สำหรับเครื่องไม่ทำงาน/สแกนไม่ได้/แจ้งเครื่องเสีย)`,
    },
    {
      title: "เลขเครื่อง (Machine ID)",
      content:
        "เลขเครื่องอยู่มุมซ้ายบนของหน้าจอเครื่อง เช่น G0310416 — ให้ลูกค้าถ่ายรูปหน้าจอหรือพิมพ์เลขมาได้",
    },
    {
      title: "ราคา / แพ็กเกจ",
      content:
        "100 บาท = 50 นาที · 50 บาท = 30 นาที · 20 บาท = 10 นาที · 10 บาท = 5 นาที (กดเลือกที่ปุ่ม Select Package บนหน้าจอ)",
    },
    {
      title: "วิธีจ่ายเงิน",
      content:
        "จ่ายได้ 3 แบบ: หยอดเหรียญ · หยอดแบงค์ · สแกน QR จ่าย แล้วกดเลือกแพ็กเกจ",
    },
    {
      title: "วิธีเริ่มใช้งาน",
      content:
        "หลังจ่ายเงิน/สแกนจ่ายแล้ว ให้นั่งพิงเบาะ ลูกกลิ้งจะสแกนร่างกายภายใน 20 วินาที",
    },
    {
      title: "วิธีปรับความแรง",
      content:
        "ปรับความแรงได้ระดับ 1–6 (เริ่มต้นที่ระดับ 3) · ปุ่ม 'เอน Zero Gravity' กด 1 ครั้งเอนตัว กดอีกครั้งกลับท่าปกติ · ยกหมอนรองคอ/ยกแผ่นรองขึ้นเพื่อนวดหนักขึ้น",
    },
    {
      title: "SOP: เครื่องไม่ทำงานหลังจ่ายเงิน",
      content:
        "ถามก่อนว่ากินเหรียญหรือกินแบงค์ → ขอสาขา+จังหวัด+เลขเครื่อง (มุมซ้ายบนจอ) → ขอรูปช่องรับเหรียญ/แบงค์ถ้าได้ → ให้ลูกค้าโทร " +
        CONTACT_PHONE +
        " ทีมงานกดเปิดเครื่องออนไลน์ให้/ตามช่าง · บันทึกเป็นรายงานว่าเครื่องเลขอะไรเป็นอะไรเพื่อตามซ่อม",
    },
    {
      title: "SOP: คอมเพลนเครื่องเสีย",
      content:
        "ขอโทษลูกค้า → ถามว่าเรื่องอะไร → ขอสาขา ตามด้วยจังหวัด + เลขเครื่อง → บันทึกแจ้งช่าง",
    },
  ];

  await prisma.inboxBotKnowledge.deleteMany({
    where: { orgId: org.id, businessTag: TAG, title: { in: knowledge.map((k) => k.title) } },
  });
  await prisma.inboxBotKnowledge.createMany({
    data: knowledge.map((k) => ({
      orgId: org.id,
      businessTag: TAG,
      title: k.title,
      content: k.content,
      createdById,
    })),
  });
  console.log(`✅ knowledge (${knowledge.length})`);

  // 3. FAQ (idempotent by intent=seed)
  const faqs: { keywords: string; answer: string; priority: number }[] = [
    {
      keywords: "ราคา,กี่บาท,กี่นาที,แพ็กเกจ,เท่าไหร่,เท่าไร",
      answer:
        "💰 ราคาค่ะ:\n• 100 บาท = 50 นาที\n• 50 บาท = 30 นาที\n• 20 บาท = 10 นาที\n• 10 บาท = 5 นาที",
      priority: 10,
    },
    {
      keywords: "เลขเครื่อง,หมายเลขเครื่อง,ดูเลขเครื่อง,machine id,เครื่องเลขอะไร",
      answer:
        "เลขเครื่องอยู่มุมซ้ายบนของหน้าจอค่ะ เช่น G0310416 📷 ถ่ายรูปหน้าจอหรือพิมพ์เลขมาได้เลยนะคะ",
      priority: 10,
    },
    {
      keywords: "จ่ายยังไง,วิธีจ่าย,จ่ายเงินยังไง,สแกนจ่ายยังไง,จ่ายแบบไหน",
      answer:
        "จ่ายได้ 3 แบบค่ะ: หยอดเหรียญ · หยอดแบงค์ · สแกน QR จ่าย แล้วกดเลือกแพ็กเกจบนหน้าจอนะคะ",
      priority: 5,
    },
  ];

  await prisma.inboxBotFaq.deleteMany({
    where: { orgId: org.id, businessTag: TAG, intent: SEED_INTENT },
  });
  await prisma.inboxBotFaq.createMany({
    data: faqs.map((f) => ({
      orgId: org.id,
      businessTag: TAG,
      intent: SEED_INTENT,
      keywords: f.keywords,
      answer: f.answer,
      priority: f.priority,
      createdById,
    })),
  });
  console.log(`✅ faq (${faqs.length})`);

  console.log("\n=== done ===\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
