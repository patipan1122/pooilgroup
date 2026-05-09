// Diagnose why a user can't see DocuFlow.
// Usage: node scripts/diagnose-docuflow-access.mjs <email>
//   or: node scripts/diagnose-docuflow-access.mjs <email> --grant   (adds the row)

import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.argv[2];
const doGrant = process.argv.includes("--grant");

if (!email) {
  console.error("Usage: node scripts/diagnose-docuflow-access.mjs <email> [--grant]");
  process.exit(1);
}
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ADMIN_TIER = ["super_admin", "org_admin", "admin"];

const { data: user, error: uErr } = await sb
  .from("users")
  .select("id, email, name, role, org_id, is_active")
  .eq("email", email)
  .maybeSingle();

if (uErr) { console.error("query error:", uErr.message); process.exit(1); }
if (!user) { console.error(`No user with email=${email}`); process.exit(1); }

console.log("USER");
console.log(`  email:    ${user.email}`);
console.log(`  name:     ${user.name}`);
console.log(`  role:     ${user.role}`);
console.log(`  active:   ${user.is_active}`);
console.log(`  org_id:   ${user.org_id}`);

const { data: modules } = await sb
  .from("user_modules")
  .select("module_name, is_active, activated_at, deactivated_at")
  .eq("user_id", user.id);

console.log("\nUSER_MODULES rows:");
if (!modules?.length) console.log("  (none)");
else for (const m of modules) {
  console.log(`  ${m.module_name.padEnd(10)} active=${m.is_active}`);
}

const { data: orgMods } = await sb
  .from("org_modules")
  .select("module_name, is_active")
  .eq("org_id", user.org_id);

console.log("\nORG_MODULES rows:");
if (!orgMods?.length) console.log("  (none — org-level toggle not gating)");
else for (const m of orgMods) {
  console.log(`  ${m.module_name.padEnd(10)} active=${m.is_active}`);
}

const isAdmin = ADMIN_TIER.includes(user.role);
const hasDocuflow = modules?.some((m) => m.module_name === "docuflow" && m.is_active);

console.log("\nDIAGNOSIS:");
if (isAdmin) {
  console.log("  ✓ User is admin tier — bypasses user_modules check entirely.");
  console.log("  → DocuFlow SHOULD be visible. If not: check browser cache, hard reload (Cmd+Shift+R).");
  console.log("  → Or check if /docuflow returns 403/404 directly.");
} else if (hasDocuflow) {
  console.log("  ✓ Has active docuflow row — should be visible.");
  console.log("  → If still hidden: check org_modules above (might be org-level disable).");
} else {
  console.log("  ✗ NOT admin tier and NO active docuflow row in user_modules.");
  console.log("  → Fix: insert user_modules row OR upgrade role to admin tier.");
  if (doGrant) {
    console.log("\n  Granting docuflow access now (--grant)...");
    const { error: insErr } = await sb.from("user_modules").upsert({
      org_id: user.org_id,
      user_id: user.id,
      module_name: "docuflow",
      is_active: true,
      activated_at: new Date().toISOString(),
    }, { onConflict: "org_id,user_id,module_name" });
    if (insErr) {
      console.log(`  ✗ Insert failed: ${insErr.message}`);
      process.exit(1);
    }
    console.log("  ✓ Granted. Reload the app and DocuFlow should appear.");
  } else {
    console.log("  Re-run with --grant to insert the row automatically.");
  }
}
