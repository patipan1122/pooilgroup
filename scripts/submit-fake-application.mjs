// Submit 1 fake application per demo posting (CEO test 2026-05-21)
// Bypasses the server action (which requires Next.js context) by inserting
// directly via service role. This is for HR demo only — real submissions go
// through /apply/[slug] which validates + audit-logs properly.

import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORG_ID = "00000000-0000-0000-0000-000000000001";

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SLUGS = [
  "demo-hotel-manager-2026",
  "demo-gas-station-staff-2026",
  "demo-housekeeper-2026",
  "demo-convenience-staff-2026",
];

// Fake answers tailored to each posting's iq questions
const FAKE_ANSWERS = {
  "demo-hotel-manager-2026": {
    applicant: { fullName: "สมหวัง ใจดี", phone: "0812345001", email: "test+hotel@example.com" },
    answers: {
      age: 34, gender: "male",
      experience_years: 8,
      experience_detail: "ทำผู้ช่วยผู้จัดการโรงแรม 3 ดาว ที่ภูเก็ต 5 ปี · ก่อนหน้านี้เป็น front desk 3 ปี · เคยดูแลทีม 12 คน · ปิด KPI ได้ทุกไตรมาส",
      special_skills: "ภาษาอังกฤษระดับสื่อสาร · ใช้ Opera PMS ได้คล่อง",
      iq_1: 80, iq_2: 400, iq_3: "b", iq_4: "a", iq_5: "yes",
    },
  },
  "demo-gas-station-staff-2026": {
    applicant: { fullName: "ฉัตรชัย วงศ์ดี", phone: "0812345002", email: "test+gas@example.com" },
    answers: {
      age: 23, gender: "male",
      experience_years: 2,
      experience_detail: "เคยทำพนักงานปั๊ม ปตท. 2 ปี กะดึก · ลาออกเพราะอยากย้ายมาทำงานใกล้บ้าน",
      special_skills: "ขยัน · ตรงต่อเวลา · ขับมอเตอร์ไซค์ส่งของได้",
      iq_1: 162.50, iq_2: 190, iq_3: "b", iq_4: "b", iq_5: "b",
    },
  },
  "demo-housekeeper-2026": {
    applicant: { fullName: "ประไพ แก้วใส", phone: "0812345003", email: null },
    answers: {
      age: 42, gender: "female",
      experience_years: 12,
      experience_detail: "ทำแม่บ้านโรงแรม 4 ดาว 10 ปี · ทำห้องวันละ 14-16 ห้อง · ไม่เคยได้รับเรื่องร้องเรียน",
      special_skills: "รีดผ้าเก่ง · จัดดอกไม้ได้",
      iq_1: 150, iq_2: "b", iq_3: "b", iq_4: "b", iq_5: "b",
    },
  },
  "demo-convenience-staff-2026": {
    applicant: { fullName: "ปัทมา สุขเสริม", phone: "0812345004", email: "test+711@example.com" },
    answers: {
      age: 19, gender: "female",
      experience_years: 0,
      experience_detail: "เพิ่งจบ ปวช. · ไม่มีประสบการณ์ทำงานเต็มเวลา · เคยช่วยงานร้านขายของชำของครอบครัว",
      special_skills: "ยิ้มแย้มแจ่มใส · พิมพ์คอมเร็ว · ใช้ LINE / TikTok คล่อง",
      iq_1: 33, iq_2: 54, iq_3: "b", iq_4: "b", iq_5: "b",
    },
  },
};

function refId() {
  const r = Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
  return `APP-${new Date().getFullYear()}-${r}`;
}

async function run() {
  console.log("→ Looking up postings…");
  const { data: postings, error: pe } = await sb
    .from("recruit_job_postings")
    .select("id, slug, title, org_id")
    .in("slug", SLUGS);
  if (pe || !postings?.length) {
    console.error("✗", pe?.message ?? "no postings"); process.exit(1);
  }

  console.log(`  ↳ found ${postings.length} postings`);

  for (const posting of postings) {
    const payload = FAKE_ANSWERS[posting.slug];
    if (!payload) continue;
    const { fullName, phone, email } = payload.applicant;

    // dedup-aware applicant (upsert by phone)
    let { data: applicant } = await sb
      .from("recruit_applicants")
      .select("id")
      .eq("org_id", posting.org_id)
      .eq("phone", phone)
      .maybeSingle();
    if (!applicant) {
      const { data: inserted, error: ae } = await sb
        .from("recruit_applicants")
        .insert({
          id: randomUUID(),
          org_id: posting.org_id,
          full_name: fullName,
          phone,
          email,
          created_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (ae) { console.error(`✗ applicant ${fullName}:`, ae.message); continue; }
      applicant = inserted;
    }

    const now = new Date().toISOString();
    const { data: app, error: ie } = await sb
      .from("recruit_applications")
      .insert({
        id: randomUUID(),
        org_id: posting.org_id,
        posting_id: posting.id,
        applicant_id: applicant.id,
        ref_id: refId(),
        answers: payload.answers,
        files: [],
        status: "NEW",
        flagged_blacklist: false,
        draft: false,
        submitted_at: now,
        schema_version: 1,
        created_at: now,
        updated_at: now,
      })
      .select("ref_id, status, submitted_at")
      .single();

    if (ie) {
      console.error(`✗ application ${posting.title}:`, ie.message);
      continue;
    }
    console.log(`✓ ${posting.title.padEnd(35, " ")} → ${app.ref_id}`);
  }

  console.log("");
  console.log("HR ดูผลที่:  https://pooilgroup.vercel.app/recruit");
  console.log("(login เป็น super_admin ก่อน)");
}

run().catch((e) => { console.error("✗ fatal:", e); process.exit(1); });
