// Big demo seed for Recruit v2 — fills every new feature with realistic data
// Run: node scripts/seed-recruit-full-demo.mjs
//
// Re-run safe: clears recruit_v2 tables before re-seeding.
// CEO will delete demo data later · this is just to make every feature visible.
//
// Creates:
// - 5 scheduled interviews (today + this week)
// - 8 messages (in/out across INAPP/EMAIL/LINE channels)
// - 4 screening rules (AI score / tag / blacklist)
// - 1 referral with full lifecycle
// - 1 erasure request (PENDING)
// - 1 blacklist entry
// - Adds aiScore + tags to existing applications

import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORG_ID = "00000000-0000-0000-0000-000000000001";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("✗ Missing env"); process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function uuid() { return randomUUID(); }

async function run() {
  console.log("→ Locating users + applications…");

  // Get the super_admin user (creator)
  const { data: creator, error: ce } = await sb
    .from("users")
    .select("id, email, name")
    .eq("org_id", ORG_ID)
    .in("role", ["super_admin", "admin"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (ce || !creator) { console.error("✗ no admin user"); process.exit(1); }
  console.log(`  ↳ creator = ${creator.email}`);

  // Get the 4 demo applications
  const { data: apps, error: ae } = await sb
    .from("recruit_applications")
    .select("id, applicant_id, posting_id, ref_id, status, answers")
    .eq("org_id", ORG_ID)
    .like("ref_id", "APP-2026-%")
    .order("created_at", { ascending: false })
    .limit(10);
  if (ae || !apps || apps.length < 1) { console.error("✗ no demo applications · run seed-recruit-demo + submit-fake-application first"); process.exit(1); }
  console.log(`  ↳ found ${apps.length} demo applications`);

  // Get the 4 postings
  const { data: postings } = await sb
    .from("recruit_job_postings")
    .select("id, slug, title")
    .eq("org_id", ORG_ID)
    .like("slug", "demo-%");
  if (!postings || postings.length < 1) { console.error("✗ no demo postings"); process.exit(1); }

  // ====================================================================
  // 1. CLEAR previous demo data (re-run safe)
  // ====================================================================
  console.log("→ Clearing prior demo data in v2 tables…");
  await sb.from("recruit_interviews").delete().eq("org_id", ORG_ID);
  await sb.from("recruit_messages").delete().eq("org_id", ORG_ID);
  await sb.from("recruit_screening_rules").delete().eq("org_id", ORG_ID);
  await sb.from("recruit_referrals").delete().eq("org_id", ORG_ID);
  await sb.from("recruit_erasure_requests").delete().eq("org_id", ORG_ID);

  // ====================================================================
  // 2. Add AI scores + tags + aiSummary to existing apps
  // ====================================================================
  console.log("→ Enriching existing applications (aiScore, tags, summaries)…");
  const aiData = [
    {
      // ผู้จัดการโรงแรม
      score: 87, summary: "ผู้สมัครมีประสบการณ์โรงแรม 5 ปี · ตอบ IQ ครบทุกข้อ · เข้าใจ Occupancy/ADR · เหมาะกับตำแหน่ง",
      strengths: ["ประสบการณ์ตรง 5 ปี", "เข้าใจตัวเลขโรงแรม (ADR/Occupancy)", "เคยดูแลทีม 12 คน"],
      risks: ["ภาษาอังกฤษระดับสื่อสาร อาจไม่พอสำหรับลูกค้าต่างชาติ"],
      tags: ["green:VIP", "blue:สัมภาษณ์รอบสุดท้าย"],
    },
    {
      // พนักงานปั๊ม
      score: 78, summary: "พนักงานปั๊มที่มีประสบการณ์ตรง · ตอบเรื่องเงินทอนถูกหมด · มีจริยธรรมการรับเงิน",
      strengths: ["เคยทำปั๊ม ปตท. 2 ปี", "ตอบเรื่องความซื่อสัตย์ถูกทุกข้อ", "ขับมอเตอร์ไซค์ได้"],
      risks: ["ทำกะดึก อาจเหนื่อย", "ไม่ได้พูดถึงเรื่องการบริการลูกค้า"],
      tags: ["green:ผ่านเกณฑ์", "amber:รอเอกสาร"],
    },
    {
      // แม่บ้าน
      score: 91, summary: "ประสบการณ์ 12 ปีในโรงแรม 4 ดาว · ตอบสถานการณ์ถูกทุกข้อ · ไม่มีร้องเรียน",
      strengths: ["ประสบการณ์ลึก 12 ปี", "ตอบสถานการณ์ ของหาย/ผ้าเปื้อนได้ตามมาตรฐาน", "ทำได้วันละ 14-16 ห้อง"],
      risks: ["อายุ 42 อาจช้าลงในระยะยาว"],
      tags: ["green:พิจารณาด่วน", "purple:VIP"],
    },
    {
      // 7-Eleven
      score: 68, summary: "เพิ่งจบ ปวช. ไม่มีประสบการณ์ · แต่ตอบ IQ ครบทุกข้อ · ทัศนคติดี",
      strengths: ["ตอบ IQ 5/5", "ทัศนคติดี ยิ้มแย้ม", "ใช้ technology คล่อง"],
      risks: ["ไม่มีประสบการณ์เลย", "อายุ 19 อาจต้องเรียนรู้นาน"],
      tags: ["amber:ยังไม่มีประสบการณ์", "blue:เด็กรุ่นใหม่"],
    },
  ];

  for (let i = 0; i < Math.min(apps.length, aiData.length); i++) {
    const a = apps[i];
    const d = aiData[i];
    await sb
      .from("recruit_applications")
      .update({
        ai_score: d.score,
        ai_summary: d.summary,
        ai_strengths: d.strengths,
        ai_risks: d.risks,
        ai_evaluated_at: new Date().toISOString(),
        tags: d.tags,
      })
      .eq("id", a.id);
    console.log(`  ↳ enriched ${a.ref_id} (AI=${d.score}, ${d.tags.length} tags)`);
  }

  // ====================================================================
  // 3. Seed 5 interviews
  // ====================================================================
  console.log("→ Seeding 5 interviews…");
  const today = new Date();
  const interviews = [];

  // Use first 4 apps
  const kinds = ["ONSITE", "PHONE", "VIDEO", "ONSITE", "PHONE"];
  const locations = ["สำนักงานใหญ่ ห้องประชุม 2", null, "https://meet.google.com/abc-defg-hij", "สาขาทองคำ ชั้น 2", null];
  const offsets = [0, 1, 2, 3, -3]; // days from today
  const hours = [14, 10, 15, 9, 11];
  const statuses = ["SCHEDULED", "CONFIRMED", "SCHEDULED", "SCHEDULED", "COMPLETED"];

  for (let i = 0; i < 5; i++) {
    const app = apps[i % apps.length];
    const scheduledAt = new Date(today);
    scheduledAt.setDate(today.getDate() + offsets[i]);
    scheduledAt.setHours(hours[i], 0, 0, 0);

    const id = uuid();
    const now = new Date().toISOString();
    const { error } = await sb.from("recruit_interviews").insert({
      id,
      org_id: ORG_ID,
      application_id: app.id,
      scheduled_at: scheduledAt.toISOString(),
      duration_min: 60,
      kind: kinds[i],
      location: locations[i],
      status: statuses[i],
      notes: i === 4 ? "ผ่านเกณฑ์ ขอเอกสารเพิ่ม" : null,
      scorecard: i === 4 ? { q1: 5, q2: 4, q3: 5, q4: 4, q5: 5, overall: 4.6 } : null,
      created_by_id: creator.id,
      created_at: now,
      updated_at: now,
    });
    if (error) console.warn(`  ✗ interview ${i}:`, error.message);
    else interviews.push({ id, kind: kinds[i] });
  }
  console.log(`  ↳ ${interviews.length} interviews created`);

  // ====================================================================
  // 4. Seed 8 messages (varied channels + directions)
  // ====================================================================
  console.log("→ Seeding 8 messages…");
  const messageData = [
    { app: 0, channel: "INAPP", direction: "OUT", body: "สวัสดีค่ะคุณสมหวัง · ขอบคุณที่สมัครเข้ามาค่ะ ทาง HR จะติดต่อกลับเร็วๆ นี้", status: "SENT" },
    { app: 0, channel: "LINE", direction: "OUT", body: "นัดสัมภาษณ์วันที่ 24 พ.ค. 14:00 ที่สำนักงานใหญ่ ห้องประชุม 2 ค่ะ · ยืนยันได้นะคะ", status: "QUEUED" },
    { app: 0, channel: "LINE", direction: "IN", body: "ยืนยันค่ะ · จะไปถึงก่อน 15 นาทีนะคะ", status: "SENT" },
    { app: 1, channel: "INAPP", direction: "OUT", body: "ฉัตรชัย คุณตอบ IQ ได้ดีมาก · อยากให้มาคุยเพิ่ม โทรพรุ่งนี้ได้ไหม?", status: "SENT" },
    { app: 1, channel: "SMS", direction: "OUT", body: "นัดโทรพรุ่งนี้ 10:00 · ใช้เบอร์นี้นะคะ", status: "QUEUED" },
    { app: 2, channel: "EMAIL", direction: "OUT", body: "เรียน คุณประไพ · ขอแสดงความยินดี · ผ่านการสัมภาษณ์รอบแรก · จะส่งรายละเอียดเอกสารทาง email ภายในวันนี้", status: "SENT" },
    { app: 3, channel: "INAPP", direction: "OUT", body: "ปัทมา ใบสมัครได้รับแล้วค่ะ · จะติดต่อกลับเมื่อมีตำแหน่งเหมาะกับคุณ", status: "SENT" },
    { app: 3, channel: "LINE", direction: "IN", body: "ขอบคุณค่ะ · รบกวนพิจารณาด้วย", status: "READ" },
  ];

  let msgCount = 0;
  for (const m of messageData) {
    if (m.app >= apps.length) continue;
    const sentAt = m.status === "QUEUED" ? null : new Date(Date.now() - Math.random() * 86400000 * 3).toISOString();
    const { error } = await sb.from("recruit_messages").insert({
      id: uuid(),
      org_id: ORG_ID,
      application_id: apps[m.app].id,
      channel: m.channel,
      direction: m.direction,
      body: m.body,
      status: m.status,
      created_by_id: m.direction === "OUT" ? creator.id : null,
      created_at: sentAt ?? new Date().toISOString(),
      sent_at: sentAt,
    });
    if (error) console.warn(`  ✗ msg:`, error.message);
    else msgCount++;
  }
  console.log(`  ↳ ${msgCount} messages created`);

  // ====================================================================
  // 5. Seed 4 screening rules
  // ====================================================================
  console.log("→ Seeding 4 auto-screen rules…");
  const rules = [
    {
      name: "AI score ≥ 85 → คัดผ่าน",
      enabled: true,
      condition: { field: "ai_score", op: ">=", value: 85 },
      action: { setStatus: "SCREENING", addTag: "green:auto-passed", comment: "AI คัดผ่านอัตโนมัติ (score ≥ 85)" },
    },
    {
      name: "AI score < 40 → ไม่ผ่าน",
      enabled: true,
      condition: { field: "ai_score", op: "<=", value: 40 },
      action: { setStatus: "REJECTED", addTag: "red:auto-rejected", comment: "AI score ต่ำกว่าเกณฑ์" },
    },
    {
      name: "ติด Blacklist → flag",
      enabled: true,
      condition: { field: "blacklist", op: "==", value: true },
      action: { addTag: "red:blacklist-match", comment: "ตรงกับรายการ Blacklist · ตรวจสอบก่อนตัดสิน" },
    },
    {
      name: "แท็ก VIP → ให้ดู priority",
      enabled: false,
      condition: { field: "tag", op: "contains", value: "VIP" },
      action: { addTag: "purple:priority", comment: "VIP applicant — ดูก่อนใบอื่น" },
    },
  ];

  let ruleCount = 0;
  for (const r of rules) {
    const now = new Date().toISOString();
    const { error } = await sb.from("recruit_screening_rules").insert({
      id: uuid(),
      org_id: ORG_ID,
      name: r.name,
      enabled: r.enabled,
      condition: r.condition,
      action: r.action,
      fires_count: r.enabled ? Math.floor(Math.random() * 8) : 0,
      last_fired_at: r.enabled ? new Date(Date.now() - Math.random() * 86400000 * 7).toISOString() : null,
      created_by_id: creator.id,
      created_at: now,
      updated_at: now,
    });
    if (error) console.warn(`  ✗ rule:`, error.message);
    else ruleCount++;
  }
  console.log(`  ↳ ${ruleCount} rules created`);

  // ====================================================================
  // 6. Seed referrals (1 master code + 1 used)
  // ====================================================================
  console.log("→ Seeding 3 referrals…");
  const refMasterCode = "PEET" + Math.random().toString(36).slice(2, 6).toUpperCase();
  const refUsedCode = "AOY" + Math.random().toString(36).slice(2, 5).toUpperCase();
  const refHiredCode = "JAY" + Math.random().toString(36).slice(2, 5).toUpperCase();

  await sb.from("recruit_referrals").insert([
    {
      id: uuid(),
      org_id: ORG_ID,
      referrer_id: creator.id,
      code: refMasterCode,
      status: "PENDING",
      created_at: new Date().toISOString(),
    },
    {
      id: uuid(),
      org_id: ORG_ID,
      referrer_id: creator.id,
      code: refUsedCode,
      applicant_id: apps[1]?.applicant_id ?? null,
      posting_id: postings[1]?.id ?? null,
      status: "APPLIED",
      clicked_at: new Date(Date.now() - 86400000 * 2).toISOString(),
      applied_at: new Date(Date.now() - 86400000 * 1).toISOString(),
      bounty_baht: 2500,
      created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    },
    {
      id: uuid(),
      org_id: ORG_ID,
      referrer_id: creator.id,
      code: refHiredCode,
      applicant_id: apps[2]?.applicant_id ?? null,
      posting_id: postings[2]?.id ?? null,
      status: "HIRED",
      clicked_at: new Date(Date.now() - 86400000 * 14).toISOString(),
      applied_at: new Date(Date.now() - 86400000 * 12).toISOString(),
      hired_at: new Date(Date.now() - 86400000 * 2).toISOString(),
      bounty_baht: 1500,
      created_at: new Date(Date.now() - 86400000 * 14).toISOString(),
    },
  ]);
  console.log(`  ↳ 3 referrals created (master=${refMasterCode}, applied=${refUsedCode}, hired=${refHiredCode})`);

  // ====================================================================
  // 7. Seed 1 erasure request
  // ====================================================================
  console.log("→ Seeding 1 erasure request (pending)…");
  const eraseApp = apps[3]; // last app
  if (eraseApp) {
    await sb.from("recruit_erasure_requests").insert({
      id: uuid(),
      org_id: ORG_ID,
      applicant_id: eraseApp.applicant_id,
      ref_id: eraseApp.ref_id,
      reason: "ขอลบข้อมูลค่ะ เพราะได้งานที่อื่นแล้ว ขอบคุณที่พิจารณาค่ะ",
      status: "PENDING",
      requested_at: new Date(Date.now() - 86400000 * 1).toISOString(),
    });
    console.log(`  ↳ erasure request for ${eraseApp.ref_id} (PENDING)`);
  }

  // ====================================================================
  // 8. Seed 1 blacklist entry (so blacklist page has data)
  // ====================================================================
  console.log("→ Seeding 1 blacklist entry…");
  await sb.from("recruit_blacklist").upsert(
    {
      id: uuid(),
      org_id: ORG_ID,
      phone: "0899999999",
      full_name: "ทดสอบ ไม่จ่ายเงิน (demo)",
      reason: "เคยทำงานที่สาขา ทอง 02 · ขโมยเงินทอนหลายครั้ง · มี CCTV เป็นหลักฐาน · ไล่ออกแบบไม่จ่ายชดเชย ปี 2024",
      company_scope: "BOTH",
      added_by_id: creator.id,
      added_at: new Date(Date.now() - 86400000 * 30).toISOString(),
      expires_at: new Date(Date.now() + 86400000 * 365 * 4).toISOString(), // 4 years from now
    },
    { onConflict: "id" },
  );

  // ====================================================================
  // 9. Seed a couple of typed timeline notes for the "Timeline" tab
  // ====================================================================
  console.log("→ Seeding 6 timeline notes (typed activity)…");
  const noteData = [
    { app: 0, type: "CALL", body: "โทรคุย · พูดดี ตอบฉะฉาน เหมาะกับงาน" },
    { app: 0, type: "INTERVIEW", body: "นัดสัมภาษณ์ 24 พ.ค. 14:00 · ที่สำนักงานใหญ่ ห้องประชุม 2" },
    { app: 1, type: "CALL_NO_ANSWER", body: "โทรเช้า ไม่รับ · ลองโทรอีกบ่ายๆ" },
    { app: 1, type: "MSG", body: "ส่ง LINE บอกให้กลับมา ติดต่อด่วน" },
    { app: 2, type: "EMAIL", body: "ส่ง offer letter เรียบร้อย · รอตอบรับภายใน 7 วัน" },
    { app: 3, type: "NOTE", body: "ยังไม่มีตำแหน่งเหมาะ · เก็บไว้ talent pool" },
  ];

  for (const n of noteData) {
    if (n.app >= apps.length) continue;
    await sb.from("recruit_application_notes").insert({
      id: uuid(),
      org_id: ORG_ID,
      application_id: apps[n.app].id,
      user_id: creator.id,
      body: `[${n.type}] ${n.body}`,
      rating: null,
      created_at: new Date(Date.now() - Math.random() * 86400000 * 5).toISOString(),
    });
  }
  console.log(`  ↳ 6 typed notes added`);

  console.log("");
  console.log("✅ Full demo seed complete!");
  console.log("");
  console.log("ตอนนี้ทุก feature มีข้อมูลตัวอย่าง · เปิดดูได้เลยที่:");
  console.log("  /recruit                       · 4 ใบสมัคร + ai score + tags");
  console.log("  /recruit/dashboard             · funnel + KPIs");
  console.log("  /recruit/calendar              · 5 นัดสัมภาษณ์");
  console.log("  /recruit/talent-pool           · คนเก่า (ถ้ามี)");
  console.log("  /recruit/messages              · 8 ข้อความข้าม channels");
  console.log("  /recruit/auto-rules            · 4 กฎ (3 enabled)");
  console.log("  /recruit/referrals             · 3 referrals (1 PENDING + 1 APPLIED + 1 HIRED)");
  console.log("  /recruit/blacklist             · 1 entry (Critical)");
  console.log("  /recruit/tasks                 · ดูใบที่ค้าง");
  console.log("  /recruit/triage                · swipe interface");
  console.log("  /recruit/settings              · hub");
  console.log("  /recruit/settings/pdpa         · compliance");
  console.log("  /recruit/settings/erasure-requests · 1 pending");
  console.log("  /recruit/settings/permissions  · matrix");
  console.log("");
  console.log("Public:");
  console.log(`  /my/${apps[0].ref_id}    · candidate tracking with timeline + erasure form`);
  console.log(`  /refer/${refMasterCode}  · referral landing`);
  console.log("  /jobs                          · public job list");
}

run().catch((e) => { console.error("✗ fatal:", e); process.exit(1); });
