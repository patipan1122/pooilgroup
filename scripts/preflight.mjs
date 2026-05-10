// Master preflight — single command to verify deploy readiness.
// Runs all checks in sequence and stops on first failure.
//
// Usage:
//   node scripts/preflight.mjs            (assumes dev server is up)
//   node scripts/preflight.mjs --boot     (boots dev server itself)
//   node scripts/preflight.mjs --prod     (skips dev-server tests, audits as prod)

import { spawn } from "node:child_process";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const args = new Set(process.argv.slice(2));
const wantBoot = args.has("--boot");
const isProdMode = args.has("--prod");

const C = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

function exec(cmd, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, [], {
      shell: true,
      stdio: opts.silent ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (opts.silent) {
      child.stdout?.on("data", (d) => (stdout += d.toString()));
      child.stderr?.on("data", (d) => (stderr += d.toString()));
    }
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

const steps = [];

function addStep(name, fn) {
  steps.push({ name, fn });
}

// ────────────────────────────────────────────────
// 1. Static checks (no dev server needed)
// ────────────────────────────────────────────────
addStep("Production env audit", async () => {
  const flag = isProdMode ? "--prod" : "";
  const r = await exec(`node scripts/check-prod-env.mjs ${flag}`, { silent: true });
  return { ok: r.code === 0, detail: r.stdout.split("\n").slice(-6).join("\n") };
});

addStep("Type check (tsc --noEmit)", async () => {
  const r = await exec("npx --no-install tsc --noEmit", { silent: true });
  return { ok: r.code === 0, detail: r.code === 0 ? "Clean" : r.stdout + r.stderr };
});

addStep("ESLint", async () => {
  const r = await exec("npm run lint 2>&1", { silent: true });
  const last = r.stdout.split("\n").filter((l) => l.includes("problems")).join("");
  return { ok: !last.includes("error"), detail: last || "Clean" };
});

addStep("Production build", async () => {
  const r = await exec("npm run build 2>&1", { silent: true });
  const ok = r.stdout.includes("Compiled successfully");
  const lines = r.stdout.split("\n").filter((l) => l.includes("Compiled") || l.includes("Generating"));
  return { ok, detail: lines.join(" / ") || (r.stderr ? r.stderr.slice(-300) : "build failed") };
});

addStep("Migration verify", async () => {
  const r = await exec("node scripts/verify-migrations.mjs", { silent: true });
  return {
    ok: r.code === 0,
    detail: r.stdout
      .split("\n")
      .filter((l) => l.includes("✓") || l.includes("✗") || l.includes("verified"))
      .slice(-3)
      .join(" / "),
  };
});

// ────────────────────────────────────────────────
// 2. Runtime checks (require dev server)
// ────────────────────────────────────────────────
if (!isProdMode) {
  addStep("Persona walkthrough (50 probes)", async () => {
    const r = await exec("node scripts/persona-walkthrough.mjs", { silent: true });
    const okCount = (r.stdout.match(/200 OK/g) || []).length;
    const denyCount = (r.stdout.match(/307/g) || []).length;
    return { ok: r.code === 0 && okCount + denyCount >= 40, detail: `${okCount} OK, ${denyCount} denied` };
  });

  addStep("Functional E2E (12 tests)", async () => {
    const r = await exec("node scripts/functional-test.mjs", { silent: true });
    const m = r.stdout.match(/Tests passed:\s*\x1b\[\d+m(\d+)/);
    const passed = m ? Number(m[1]) : 0;
    return { ok: r.code === 0, detail: `${passed} passed` };
  });

  addStep("Security regression (9 tests)", async () => {
    const r = await exec("node scripts/security-test.mjs", { silent: true });
    const m = r.stdout.match(/Passed:\s*\x1b\[\d+m(\d+)/);
    const passed = m ? Number(m[1]) : 0;
    return { ok: r.code === 0, detail: `${passed} passed` };
  });

  addStep("DocuFlow E2E (4 tests)", async () => {
    const r = await exec("node scripts/docuflow-test.mjs", { silent: true });
    const m = r.stdout.match(/Passed:\s*\x1b\[\d+m(\d+)/);
    const passed = m ? Number(m[1]) : 0;
    return { ok: r.code === 0, detail: `${passed} passed` };
  });

  addStep("Cron auth + idempotency (11 tests)", async () => {
    const r = await exec("node scripts/cron-test.mjs", { silent: true });
    const m = r.stdout.match(/Passed:\s*\x1b\[\d+m(\d+)/);
    const passed = m ? Number(m[1]) : 0;
    return { ok: r.code === 0, detail: `${passed} passed` };
  });

  addStep("Edge cases + setup wizard (14 tests)", async () => {
    const r = await exec("node scripts/edge-case-test.mjs", { silent: true });
    const m = r.stdout.match(/Passed:\s*\x1b\[\d+m(\d+)/);
    const passed = m ? Number(m[1]) : 0;
    return { ok: r.code === 0, detail: `${passed} passed` };
  });

  addStep("Integration: TG callback + PDF + deep health (11)", async () => {
    const r = await exec("node scripts/integration-test.mjs", { silent: true });
    const m = r.stdout.match(/Passed:\s*\x1b\[\d+m(\d+)/);
    const passed = m ? Number(m[1]) : 0;
    return { ok: r.code === 0, detail: `${passed} passed` };
  });
}

// ────────────────────────────────────────────────
// Run sequentially
// ────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}🛫 Pool Group — Pre-Flight Check${C.reset}`);
  console.log(`${C.dim}Mode: ${isProdMode ? "PROD (skip runtime tests)" : "DEV"}${C.reset}\n`);

  let bootedServer = null;
  if (wantBoot) {
    console.log(`${C.cyan}Booting dev server...${C.reset}`);
    bootedServer = spawn("npm", ["run", "dev"], { stdio: ["ignore", "pipe", "pipe"] });
    // Wait for "Ready in"
    await new Promise((resolve) => {
      bootedServer.stdout?.on("data", (d) => {
        if (d.toString().includes("Ready in")) resolve();
      });
      setTimeout(resolve, 10000); // safety timeout
    });
    console.log(`${C.green}✓ Dev server ready${C.reset}\n`);
  }

  const results = [];
  let blockerHit = false;

  for (const step of steps) {
    process.stdout.write(`${C.cyan}▶${C.reset} ${step.name.padEnd(40)} `);
    const t0 = Date.now();
    const result = await step.fn();
    const ms = Date.now() - t0;
    if (result.ok) {
      process.stdout.write(`${C.green}✓ PASS${C.reset} ${C.dim}(${ms}ms) ${result.detail}${C.reset}\n`);
    } else {
      process.stdout.write(`${C.red}✗ FAIL${C.reset} ${C.dim}(${ms}ms)${C.reset}\n`);
      console.log(`  ${C.red}${result.detail}${C.reset}\n`);
      blockerHit = true;
      break;
    }
    results.push({ name: step.name, ms, ...result });
  }

  if (bootedServer) {
    bootedServer.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log(`\n${"─".repeat(60)}`);
  if (blockerHit) {
    console.log(`${C.red}${C.bold}✗ NOT READY${C.reset} — blocker found`);
    console.log(`${C.dim}Fix the failing step above before proceeding.${C.reset}`);
    process.exit(1);
  } else {
    const totalMs = results.reduce((s, r) => s + r.ms, 0);
    console.log(`${C.green}${C.bold}✓ READY TO DEPLOY${C.reset}`);
    console.log(`${C.dim}${results.length} checks passed in ${(totalMs / 1000).toFixed(1)}s${C.reset}`);
    console.log(`\n${C.bold}Next:${C.reset}`);
    console.log(`  1. ${C.cyan}node scripts/generate-secrets.mjs${C.reset} — generate fresh secrets`);
    console.log(`  2. Add secrets to Vercel Production env vars`);
    console.log(`  3. Apply migrations to prod Supabase (init + setup + 002-005)`);
    console.log(`  4. Vercel deploy`);
    console.log(`  5. ${C.cyan}node scripts/preflight.mjs --prod${C.reset} — final check\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
