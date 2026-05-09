// Persona walkthrough: login each persona via Supabase REST + probe pages.
// Returns a matrix of HTTP responses to validate auth + permission boundaries.
//
// Run while dev server is up on http://localhost:3100

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const APP_URL = "http://localhost:3100";
const PASSWORD = "Pooil2026!";

const personas = [
  { name: "super_admin", email: "admin@pooilgroup.test" },
  { name: "org_admin", email: "orgadmin@pooilgroup.test" },
  { name: "branch_manager", email: "mgr@pooilgroup.test" },
  { name: "staff", email: "cashier@pooilgroup.test" },
  { name: "viewer", email: "viewer@pooilgroup.test" },
];

// Routes to probe: each row → [path, expectedStatus per role]
// Use 200 = OK, 307 = redirect (login or 403), 403 = forbidden, 404 = not found
const probes = [
  { path: "/dashboard", desc: "main dashboard" },
  { path: "/users", desc: "user list (admin only)" },
  { path: "/branches", desc: "branch mgmt (admin only)" },
  { path: "/audit", desc: "audit log (admin/viewer)" },
  { path: "/cashhub/dashboard", desc: "cashhub overview" },
  { path: "/cashhub/reports", desc: "cashhub reports" },
  { path: "/docuflow/documents", desc: "docuflow list" },
  { path: "/settings", desc: "org settings (admin only)" },
  { path: "/setup-wizard", desc: "setup wizard (super_admin)" },
  { path: "/profile", desc: "own profile" },
];

async function loginGetCookies(email) {
  // Step 1: hit Supabase auth REST to get tokens
  const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Supabase auth failed for ${email}: ${tokenRes.status} ${err.slice(0, 200)}`);
  }
  const tokens = await tokenRes.json();

  // Cookie format used by @supabase/ssr v0.10.x:
  //   sb-<projectref>-auth-token = base64-{base64URL(Session JSON)}
  // ⚠️ MUST be base64URL (-, _, no padding) — not regular base64 (+, /, =)
  // Decoder ใช้ stringFromBase64URL → จะ throw ถ้าเจอ + หรือ /
  const projectRef = new URL(SUPABASE_URL).host.split(".")[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  const b64url = Buffer.from(JSON.stringify(tokens))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  const cookieValue = `base64-${b64url}`;

  // Cookie may need chunking if > ~3kb. Most JWT sessions ≈ 1-2kb, no chunking needed.
  return { cookieName, cookieValue, accessToken: tokens.access_token, sessionSize: cookieValue.length };
}

async function probe(path, cookieName, cookieValue) {
  const res = await fetch(`${APP_URL}${path}`, {
    method: "GET",
    redirect: "manual",
    headers: { Cookie: `${cookieName}=${cookieValue}` },
  });
  const loc = res.headers.get("location") ?? "";
  return { status: res.status, location: loc };
}

async function main() {
  console.log("\n🔬 Persona Walkthrough\n");
  console.log("Status legend: 200=OK, 307=redirect, 403=forbidden, 4xx/5xx=error\n");

  // Header
  const headers = ["path", ...personas.map((p) => p.name.padEnd(15))];
  console.log(headers.join(" | "));
  console.log("-".repeat(headers.join(" | ").length));

  // Login each persona
  const sessions = {};
  for (const p of personas) {
    try {
      sessions[p.name] = await loginGetCookies(p.email);
    } catch (e) {
      console.error(`✗ ${p.name}: ${e.message}`);
      sessions[p.name] = null;
    }
  }

  // Probe each path × each persona
  for (const probeItem of probes) {
    const row = [probeItem.path.padEnd(28)];
    for (const p of personas) {
      const s = sessions[p.name];
      if (!s) {
        row.push("ERROR".padEnd(15));
        continue;
      }
      try {
        const r = await probe(probeItem.path, s.cookieName, s.cookieValue);
        const tag =
          r.status === 200
            ? `200 OK`
            : r.status === 307 && r.location.includes("/login")
              ? `307 → login`
              : r.status === 307 && r.location.includes("/403")
                ? `307 → 403`
                : r.status === 403
                  ? `403 forbidden`
                  : r.status === 404
                    ? `404`
                    : `${r.status}`;
        row.push(tag.padEnd(15));
      } catch {
        row.push(`ERR`.padEnd(15));
      }
    }
    console.log(row.join(" | "));
  }

  console.log(`\nDone.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
