// Pooilgroup ERP — Database Seed (via Supabase REST API)
// 1 organization (Pooilgroup) → 2 companies (Pooil Oil + JP Sync) → sample of all 11 business types
// Idempotent: re-run = no duplicate (uses upsert).
// Run: npm run db:seed (after setup.sql has been applied via SQL Editor)

import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { BUSINESS_TYPE_LIST } from "../constants/business-types.js";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
  );
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const POOILGROUP_ORG_ID = "00000000-0000-0000-0000-000000000001";
const POOIL_OIL_COMPANY_ID = "00000000-0000-0000-0000-0000000000a1";
const JP_SYNC_COMPANY_ID = "00000000-0000-0000-0000-0000000000a2";

async function seedOrganization() {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("organizations")
    .upsert(
      {
        id: POOILGROUP_ORG_ID,
        name: "Pooilgroup",
        slug: "pooilgroup",
        settings: {
          timezone: "Asia/Bangkok",
          fiscalYearStart: 1,
          currency: "THB",
          reconcileMode: "binary",
          spikeAlertThreshold: 1.5,
        },
        is_active: true,
        updated_at: now,
      },
      { onConflict: "id" },
    )
    .select()
    .single();

  if (error) throw error;
  console.log(`✓ Organization: ${data.name} (${data.id})`);
  return data;
}

async function seedCompanies(orgId: string) {
  const now = new Date().toISOString();
  const companies = [
    {
      id: POOIL_OIL_COMPANY_ID,
      org_id: orgId,
      code: "POOIL",
      name: "Pooil Oil",
      tax_id: null,
      is_active: true,
      updated_at: now,
    },
    {
      id: JP_SYNC_COMPANY_ID,
      org_id: orgId,
      code: "JPSYNC",
      name: "JP Sync Group",
      tax_id: null,
      is_active: true,
      updated_at: now,
    },
  ];

  for (const c of companies) {
    const { error } = await supabase
      .from("companies")
      .upsert(c, { onConflict: "id" });
    if (error) {
      console.error(`✗ Company ${c.code}:`, error.message);
      throw error;
    }
    console.log(`✓ Company: ${c.name} (${c.code})`);
  }
}

async function seedReportTemplates(orgId: string) {
  const now = new Date().toISOString();
  for (const config of BUSINESS_TYPE_LIST) {
    const payload = {
      id: crypto.randomUUID(),
      org_id: orgId,
      business_type: config.type,
      has_shifts: config.hasShifts,
      shifts: config.shifts,
      has_reconcile: config.hasReconcile,
      fields: JSON.parse(JSON.stringify(config.fields)),
      reconcile_formula: config.reconcileFormula || null,
      updated_at: now,
    };

    const { error } = await supabase
      .from("report_templates")
      .upsert(payload, {
        onConflict: "business_type",
        ignoreDuplicates: false,
      });

    if (error) {
      console.error(`✗ Template ${config.type}:`, error.message);
      throw error;
    }
    console.log(`✓ Template: ${config.emoji} ${config.label}`);
  }
}

async function seedSampleBranches(orgId: string) {
  // 1 sample สาขา ของแต่ละประเภทธุรกิจ ใน Pooil Oil + ตัวอย่างจาก JP Sync
  const samples = [
    // Pooil Oil — 8 ประเภทธุรกิจ
    {
      code: "PO-FUEL-001",
      name: "ปั๊มน้ำมัน ขอนแก่น 01",
      business_type: "fuel_station" as const,
      company_id: POOIL_OIL_COMPANY_ID,
      province: "ขอนแก่น",
      region: "อีสาน",
    },
    {
      code: "PO-LPG-001",
      name: "ปั๊มแก๊ส ขอนแก่น 01",
      business_type: "lpg_station" as const,
      company_id: POOIL_OIL_COMPANY_ID,
      province: "ขอนแก่น",
      region: "อีสาน",
    },
    {
      code: "PO-LPGR-001",
      name: "ร้านค้าแก๊ส ขอนแก่น 01",
      business_type: "lpg_retail" as const,
      company_id: POOIL_OIL_COMPANY_ID,
      province: "ขอนแก่น",
      region: "อีสาน",
    },
    {
      code: "PO-BOT-001",
      name: "โรงบรรจุก๊าซ ขอนแก่น",
      business_type: "bottling_plant" as const,
      company_id: POOIL_OIL_COMPANY_ID,
      province: "ขอนแก่น",
      region: "อีสาน",
    },
    {
      code: "PO-CVS-001",
      name: "7-Eleven ขอนแก่น 01 (ในปั๊ม PO-FUEL-001)",
      business_type: "convenience_store" as const,
      company_id: POOIL_OIL_COMPANY_ID,
      province: "ขอนแก่น",
      region: "อีสาน",
    },
    {
      code: "PO-CAFE-001",
      name: "Café Amazon ขอนแก่น 01",
      business_type: "cafe" as const,
      company_id: POOIL_OIL_COMPANY_ID,
      province: "ขอนแก่น",
      region: "อีสาน",
    },
    {
      code: "PO-EV-001",
      name: "EV Station ขอนแก่น 01",
      business_type: "ev_station" as const,
      company_id: POOIL_OIL_COMPANY_ID,
      province: "ขอนแก่น",
      region: "อีสาน",
    },
    {
      code: "PO-TRAIN",
      name: "ศูนย์ฝึกอบรม Pooilgroup",
      business_type: "training_center" as const,
      company_id: POOIL_OIL_COMPANY_ID,
      province: "ขอนแก่น",
      region: "อีสาน",
    },
    // JP Sync Group — 4 ประเภทธุรกิจ
    {
      code: "JP-PUNT-001",
      name: "พันธุ์ไทย ขอนแก่น 01",
      business_type: "cafe_punthai" as const,
      company_id: JP_SYNC_COMPANY_ID,
      province: "ขอนแก่น",
      region: "อีสาน",
    },
    {
      code: "JP-MASS-001",
      name: "เก้าอี้นวด ขอนแก่นมอลล์",
      business_type: "massage_chair" as const,
      company_id: JP_SYNC_COMPANY_ID,
      province: "ขอนแก่น",
      region: "อีสาน",
    },
    {
      code: "JP-CLAW-001",
      name: "ตู้คีบ ขอนแก่นมอลล์",
      business_type: "claw_machine" as const,
      company_id: JP_SYNC_COMPANY_ID,
      province: "ขอนแก่น",
      region: "อีสาน",
    },
    {
      code: "JP-FUEL-001",
      name: "ปั๊มน้ำมัน JP",
      business_type: "fuel_station" as const,
      company_id: JP_SYNC_COMPANY_ID,
      province: "ขอนแก่น",
      region: "อีสาน",
    },
  ];

  const now = new Date().toISOString();
  for (const branch of samples) {
    const { error } = await supabase
      .from("branches")
      .upsert(
        {
          id: crypto.randomUUID(),
          ...branch,
          org_id: orgId,
          is_active: true,
          updated_at: now,
        },
        { onConflict: "org_id,code" },
      );
    if (error) {
      console.error(`✗ Branch ${branch.code}:`, error.message);
      throw error;
    }
    console.log(`✓ Branch: ${branch.code} ${branch.name}`);
  }
}

async function main() {
  console.log("🌱 Seeding Pooilgroup database via Supabase REST...\n");
  const org = await seedOrganization();
  await seedCompanies(org.id);
  await seedReportTemplates(org.id);
  await seedSampleBranches(org.id);
  console.log("\n✅ Seed complete.");
  console.log(
    "   Next: Owner registers via Supabase Auth → set role=super_admin manually",
  );
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
