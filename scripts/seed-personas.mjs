// Seed 4 test personas via Supabase Admin API.
// Lean version (4 users instead of per-branch ×2). Idempotent.
// Run: node scripts/seed-personas.mjs

import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORG_ID = "00000000-0000-0000-0000-000000000001";
const PASSWORD = "Pooil2026!";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("✗ env missing"); process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Pull first active branch (any business type — pick fuel station for branch_manager+staff)
async function pickBranch() {
  const { data } = await sb
    .from("branches")
    .select("id, code, name, business_type")
    .eq("org_id", ORG_ID)
    .eq("is_active", true)
    .eq("business_type", "fuel_station")
    .order("code")
    .limit(1)
    .maybeSingle();
  if (!data) { console.error("✗ no fuel_station branch"); process.exit(1); }
  return data;
}

async function provision({ role, email, name, branchIds = [], modules = [] }) {
  // exists?
  const { data: existing } = await sb
    .from("users")
    .select("id, email, role")
    .eq("email", email)
    .eq("org_id", ORG_ID)
    .maybeSingle();
  if (existing) {
    console.log(`✓ skip ${role.padEnd(15)} ${email}  (exists, role=${existing.role})`);
    return existing.id;
  }

  const { data: a, error: aErr } = await sb.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true, user_metadata: { name },
  });
  if (aErr || !a?.user) { console.error(`✗ auth ${email}: ${aErr?.message}`); return null; }
  const uid = a.user.id;
  const now = new Date().toISOString();

  const { error: uErr } = await sb.from("users").insert({
    id: uid, org_id: ORG_ID, email, name, role,
    must_change_password: false, is_active: true,
    invite_used_at: now, updated_at: now,
  });
  if (uErr) {
    await sb.auth.admin.deleteUser(uid).catch(() => {});
    console.error(`✗ users ${email}: ${uErr.message}`);
    return null;
  }

  if (branchIds.length) {
    await sb.from("user_branches").insert(
      branchIds.map((bid) => ({
        id: crypto.randomUUID(), org_id: ORG_ID, user_id: uid, branch_id: bid, is_active: true,
      })),
    );
  }
  if (modules.length) {
    await sb.from("user_modules").insert(
      modules.map((m) => ({
        org_id: ORG_ID, user_id: uid, module_name: m, is_active: true, updated_at: now,
      })),
    );
  }
  console.log(`✓ create ${role.padEnd(15)} ${email}`);
  return uid;
}

async function main() {
  console.log(`\n🌱 Seeding 4 lean test personas\n`);

  const branch = await pickBranch();
  console.log(`Using branch: ${branch.code} (${branch.name})\n`);

  // Persona 1: org_admin (HR/IT) — for cross-org admin tests
  await provision({
    role: "org_admin",
    email: "orgadmin@pooilgroup.test",
    name: "VP Ops (Test)",
  });

  // Persona 2: branch_manager — owns 1 branch
  await provision({
    role: "branch_manager",
    email: `mgr@pooilgroup.test`,
    name: `ผจก. ${branch.code} (Test)`,
    branchIds: [branch.id],
    modules: ["cashhub"],
  });

  // Persona 3: staff (cashier) — LIFF user
  await provision({
    role: "staff",
    email: `cashier@pooilgroup.test`,
    name: `พนักงาน ${branch.code} (Test)`,
    branchIds: [branch.id],
    modules: ["cashhub"],
  });

  // Persona 4: viewer (auditor) — read-only
  await provision({
    role: "viewer",
    email: "viewer@pooilgroup.test",
    name: "ผู้ตรวจสอบ (Test)",
    modules: ["cashhub", "docuflow"],
  });

  console.log(`\n✅ Done. All 4 personas use password: ${PASSWORD}\n`);
  console.log(`Login matrix:`);
  console.log(`  super_admin    admin@pooilgroup.test`);
  console.log(`  org_admin      orgadmin@pooilgroup.test`);
  console.log(`  branch_manager mgr@pooilgroup.test     → branch ${branch.code}`);
  console.log(`  staff          cashier@pooilgroup.test → branch ${branch.code}`);
  console.log(`  viewer         viewer@pooilgroup.test`);
}

main().catch((e) => { console.error(e); process.exit(1); });
