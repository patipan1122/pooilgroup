// Pooilgroup ERP — Database Seed (via Supabase REST API)
// Bypasses Postgres connection (no IPv4 issue) — uses service_role over HTTPS
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

    // Use ignoreDuplicates so re-running doesn't create new ID for existing template
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
  const samples = [
    {
      code: "KKN-001",
      name: "ปั๊มน้ำมัน KKN-001",
      business_type: "fuel_station" as const,
      province: "ขอนแก่น",
      region: "อีสาน",
    },
    {
      code: "KKN-002",
      name: "ร้านก๊าซ KKN-002",
      business_type: "lpg_station" as const,
      province: "ขอนแก่น",
      region: "อีสาน",
    },
    {
      code: "KKN-003",
      name: "โรงบรรจุก๊าซ KKN-003",
      business_type: "bottling_plant" as const,
      province: "ขอนแก่น",
      region: "อีสาน",
    },
    {
      code: "KKN-HOT",
      name: "Hotel Pool KKN",
      business_type: "hotel" as const,
      province: "ขอนแก่น",
      region: "อีสาน",
    },
    {
      code: "KKN-CAFE",
      name: "Café Amazon KKN",
      business_type: "cafe" as const,
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
