// Bootstrap super_admin user via Supabase Admin API
// One-shot script: creates auth user + inserts public.users row with role=super_admin
// Idempotent: skips if email already exists.
//
// Usage: node scripts/bootstrap-super-admin.mjs

import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORG_ID = "00000000-0000-0000-0000-000000000001";

const EMAIL = "admin@pooilgroup.test";
const PASSWORD = "Pooil2026!";
const NAME = "Super Admin (Test)";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("✗ NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  // 1. Check if user already exists in public.users
  const { data: existing } = await supabase
    .from("users")
    .select("id, email, role")
    .eq("email", EMAIL)
    .eq("org_id", ORG_ID)
    .maybeSingle();

  if (existing) {
    console.log(`✓ User already exists: ${existing.email} (role=${existing.role})`);
    console.log(`  id=${existing.id}`);
    console.log(`\n  Login: ${EMAIL} / ${PASSWORD}`);
    return;
  }

  // 2. Create auth user
  console.log(`Creating auth user ${EMAIL}...`);
  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name: NAME },
  });

  if (authErr || !authData?.user) {
    console.error(`✗ auth.admin.createUser failed:`, authErr?.message ?? "unknown");
    process.exit(1);
  }

  const uid = authData.user.id;
  const now = new Date().toISOString();

  // 3. Insert public.users row
  console.log(`Inserting public.users row...`);
  const { error: insertErr } = await supabase.from("users").insert({
    id: uid,
    org_id: ORG_ID,
    email: EMAIL,
    name: NAME,
    role: "super_admin",
    must_change_password: false,
    is_active: true,
    invite_used_at: now,
    updated_at: now,
  });

  if (insertErr) {
    console.error(`✗ users insert failed: ${insertErr.message}`);
    // Roll back auth user so retry is clean
    await supabase.auth.admin.deleteUser(uid).catch(() => {});
    process.exit(1);
  }

  console.log(`\n✅ Super admin created`);
  console.log(`   id    = ${uid}`);
  console.log(`   email = ${EMAIL}`);
  console.log(`   pw    = ${PASSWORD}`);
  console.log(`\n   Login at: http://localhost:3100/login`);
  console.log(`   Then POST /api/dev/seed-test-users to seed remaining personas`);
}

main().catch((err) => {
  console.error("✗ Bootstrap failed:", err);
  process.exit(1);
});
