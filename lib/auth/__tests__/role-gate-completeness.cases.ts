// LedgerLine/CashHub/DC/Playland/etc — role-gate completeness scanner.
//
// WHY THIS EXISTS (2026-09-06):
//   `program_admin` (added 2026-06-01) gives a user full admin power but ONLY
//   within programs/modules they've been explicitly granted (via user_modules
//   grants). Every page hand-rolls its own role-check array/requireRole()
//   call, so when a role gets added there is no single source of truth
//   forcing completeness. Two manual grep audits (June, then 95 sites on
//   2026-08-17 commit c94c8c17) both missed sites — a fresh audit on
//   2026-09-06 still found 4 more (LedgerLine module pages, DC warehouse
//   access, Playland shifts). This scanner replaces "grep it by hand
//   occasionally" with "assert it every test run".
//
// SCOPE — this is intentionally NOT a whole-repo scan. It only looks inside
// the directories of modules that actually support a user_modules grant (the
// `ModuleSlug` union in lib/modules.ts: cashhub, ledger, dc, playland, ...).
// Org-wide platform admin — user management, branch/company CRUD, org
// settings, backup/security settings (app/(admin)/users, /branches,
// /companies, /settings, /audit, and their app/api/admin/* counterparts) is
// DELIBERATELY excluded: program_admin is a MODULE admin, not an org admin,
// and must never get org-wide user/branch/company management power just
// because it happens to be "missing" from a 2/3-role array there — adding it
// there would be a privilege-escalation bug, not a fix. (Confirmed by running
// an early, unscoped version of this scanner: it flagged ~150 sites under
// users/branches/companies/settings/api-admin that are correctly super_admin
// /org_admin/admin-only and must stay that way.)
//
// WHAT IT DOES: a pragmatic, regex/text-based static scan (NOT a TS AST pass)
// over each module's app/(admin)/<slug>, app/api/<slug>, app/liff/<slug>, and
// lib/<slug> directories, for two patterns:
//   A) `requireRole("role1", "role2", ...)` calls with 2+ role-string args.
//   B) Role-array literals that are either:
//      B1) assigned to a const/let whose name contains "ROLE" (case-
//          insensitive) — covers named lists like PLAYLAND_MANAGER_ROLES,
//          CF_ADMIN_ROLES, DC_ADMIN_ROLES.
//      B2) an inline array immediately chained to `.includes(` — covers the
//          Playland shifts bug pattern: `["a","b"].includes(session.user.role)`.
//   Both must be arrays made ENTIRELY of quoted, known role-name strings (2+).
//   This precision (vs. "any bracket with 2+ role strings") is what excludes
//   decorative/display data, e.g. recruit's read-only permission-matrix page
//   which lists role names purely for a UI table, not as an actual gate.
// A site is flagged only if it already contains 2+ admin-tier-ish role names
// (i.e. it looks like a deliberately-curated "who can do this" list) — a
// single-role gate like `requireRole("super_admin")` (credential/connection
// pages) is a DELIBERATE single-tier gate, not "most of the admin tier but
// missing one", so it is never even a candidate.
//
// We deliberately do NOT treat every `isAdminTier(` CALL site as a violation
// — that function is intentionally the strict 3-role tier and is correctly
// used in ~45+ places (module-entry gates, sensitive exports) that must NOT
// become program_admin-aware (role-guards.ts's own comments warn against
// this — the module-entitlement gate must stay strict or program_admin could
// enter programs it was never granted). We DO read its definition
// (ADMIN_TIER_ROLES) as the source of truth for "the strict tier", and
// separately assert that PROGRAM_ADMIN_TIER_ROLES = ADMIN_TIER_ROLES +
// program_admin still holds.
//
// Any real hit that's an intentional exclusion belongs in
// lib/auth/role-gate-known-exceptions.ts with a reason, not a code change here.

import fs from "node:fs";
import path from "node:path";
import { ROLE_GATE_KNOWN_EXCEPTIONS, type RoleGateException } from "../role-gate-known-exceptions";

// lib/auth/__tests__ -> repo root
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const SCHEMA_PATH = path.join(REPO_ROOT, "prisma", "schema.prisma");
const ROLE_GUARDS_PATH = path.join(REPO_ROOT, "lib", "auth", "role-guards.ts");
const MODULES_PATH = path.join(REPO_ROOT, "lib", "modules.ts");

/** Directories whose contents are not production role-gate sites — skip them. */
const SKIP_DIR_NAMES = new Set(["node_modules", "generated", "__tests__", ".next"]);

// ── 1. Parse the live `UserRole` enum straight out of schema.prisma ─────────
// (not hardcoded — the whole point is to stay correct when roles change).
// NOTE: the schema also has an unrelated `enum FuelUserRole { OWNER ... }`
// (FuelOS's own role system, @@map("UserRole") only maps the DB table name) —
// the regex below anchors on the literal `enum UserRole {` declaration so it
// is not confused with that.
export function parseUserRoleEnum(schemaSrc: string): string[] {
  const m = schemaSrc.match(/enum\s+UserRole\s*\{([^}]*)\}/);
  if (!m) {
    throw new Error(
      "role-gate-completeness: could not find `enum UserRole { ... }` in prisma/schema.prisma — did it get renamed?",
    );
  }
  return m[1]
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("@@"))
    .map((line) => line.split(/\s+/)[0]);
}

// ── 2. Parse the canonical STRICT admin tier straight out of role-guards.ts ──
// (ADMIN_TIER_ROLES = [super_admin, org_admin, admin] by design). We then
// require program_admin on top of it (role-guards.ts's own
// PROGRAM_ADMIN_TIER_ROLES = [...ADMIN_TIER_ROLES, "program_admin"] pattern),
// sanity-checked against the source text so this test breaks loudly (not
// silently) if that layering is ever removed.
export function parseAdminTierRoles(roleGuardsSrc: string): string[] {
  const m = roleGuardsSrc.match(/const\s+ADMIN_TIER_ROLES[^=]*=\s*\[([^\]]*)\]/);
  if (!m) {
    throw new Error(
      "role-gate-completeness: could not find `const ADMIN_TIER_ROLES: ... = [...]` in lib/auth/role-guards.ts.",
    );
  }
  const roles = [...m[1].matchAll(/"([a-zA-Z_]+)"/g)].map((x) => x[1]);
  if (roles.length === 0) {
    throw new Error("role-gate-completeness: parsed ADMIN_TIER_ROLES but found 0 role literals.");
  }
  const layersProgramAdmin =
    /PROGRAM_ADMIN_TIER_ROLES[\s\S]{0,80}=\s*\[[\s\S]{0,80}\.\.\.ADMIN_TIER_ROLES[\s\S]{0,80}"program_admin"/.test(
      roleGuardsSrc,
    );
  if (!layersProgramAdmin) {
    throw new Error(
      "role-gate-completeness: role-guards.ts no longer layers program_admin on top of ADMIN_TIER_ROLES via " +
        "PROGRAM_ADMIN_TIER_ROLES = [...ADMIN_TIER_ROLES, \"program_admin\"] — update this test's assumption " +
        "(and re-check whether isProgramAdminTier() still exists).",
    );
  }
  return roles;
}

// ── 3. Parse the live module registry (ModuleSlug union) from lib/modules.ts ─
// (not hardcoded — new modules should automatically get scanned).
export function parseModuleSlugs(modulesSrc: string): string[] {
  const m = modulesSrc.match(/export\s+type\s+ModuleSlug\s*=\s*([^;]+);/);
  if (!m) {
    throw new Error("role-gate-completeness: could not find `export type ModuleSlug = ...;` in lib/modules.ts.");
  }
  const slugs = [...m[1].matchAll(/"([a-zA-Z0-9_-]+)"/g)].map((x) => x[1]);
  if (slugs.length < 5) {
    throw new Error(`role-gate-completeness: parsed suspiciously few module slugs: ${JSON.stringify(slugs)}`);
  }
  return slugs;
}

/** For each module slug, the root dirs that are genuinely "that module"'s surface area. */
function moduleRootDirs(slug: string): { dir: string; exts: string[] }[] {
  const candidates = [
    { dir: path.join(REPO_ROOT, "app", "(admin)", slug), exts: [".ts", ".tsx"] },
    { dir: path.join(REPO_ROOT, "app", "api", slug), exts: [".ts", ".tsx"] },
    { dir: path.join(REPO_ROOT, "app", "liff", slug), exts: [".ts", ".tsx"] },
    { dir: path.join(REPO_ROOT, "lib", slug), exts: [".ts"] },
  ];
  return candidates.filter((c) => fs.existsSync(c.dir));
}

// ── 4. Walk directories collecting candidate source files ──────────────────
function walk(dir: string, exts: string[], out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, exts, out);
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

export type RoleGateSite = {
  file: string; // relative to repo root
  line: number;
  roles: string[];
  snippet: string;
};

/** true if every comma-separated token in `inner` is a quoted, known role-name string (2+ of them). */
function pureRoleArray(inner: string, knownRoles: string[]): string[] | null {
  const trimmed = inner.trim();
  if (!trimmed) return null;
  const tokens = trimmed
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length < 2) return null;
  const roleTokens = tokens.map((t) => t.match(/^"([a-zA-Z_]+)"$/)?.[1]).filter((r): r is string => Boolean(r));
  if (roleTokens.length !== tokens.length) return null; // mixed content — not a pure role array
  if (!roleTokens.every((r) => knownRoles.includes(r))) return null;
  return roleTokens;
}

/** Scan one file's text for both patterns. `knownRoles` = live UserRole enum values. */
export function findSitesInText(text: string, relFile: string, knownRoles: string[]): RoleGateSite[] {
  const sites: RoleGateSite[] = [];

  // Pattern A: requireRole("a", "b", ...) — including multi-line calls.
  // Args are always plain string literals (no nested parens) in this codebase.
  for (const m of text.matchAll(/requireRole\(([^)]*)\)/g)) {
    const roles = [...m[1].matchAll(/"([a-zA-Z_]+)"/g)].map((x) => x[1]).filter((r) => knownRoles.includes(r));
    if (roles.length >= 2) {
      sites.push({ file: relFile, line: lineAt(text, m.index ?? 0), roles, snippet: m[0].replace(/\s+/g, " ").slice(0, 160) });
    }
  }

  // Pattern B1: const/let NAME_CONTAINING_ROLE = [ ...pure role strings... ]
  for (const m of text.matchAll(/(?:export\s+)?(?:const|let)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=\n]*)?=\s*\[([^[\]]*)\]/g)) {
    const [whole, name, inner] = m;
    if (!/role/i.test(name)) continue;
    const roles = pureRoleArray(inner, knownRoles);
    if (!roles) continue;
    const bracketOffset = whole.indexOf("[");
    const idx = (m.index ?? 0) + (bracketOffset >= 0 ? bracketOffset : 0);
    sites.push({ file: relFile, line: lineAt(text, idx), roles, snippet: whole.replace(/\s+/g, " ").slice(0, 160) });
  }

  // Pattern B2: [ ...pure role strings... ].includes( — inline gate (the Playland shifts bug shape).
  for (const m of text.matchAll(/\[([^[\]]*)\]\s*\.includes\(/g)) {
    const roles = pureRoleArray(m[1], knownRoles);
    if (!roles) continue;
    sites.push({ file: relFile, line: lineAt(text, m.index ?? 0), roles, snippet: m[0].replace(/\s+/g, " ").slice(0, 160) });
  }

  return sites;
}

function isExcepted(site: RoleGateSite, exceptions: RoleGateException[]): RoleGateException | undefined {
  return exceptions.find((ex) => ex.file === site.file && Math.abs(ex.line - site.line) <= 3);
}

export type CompletenessCase = { name: string; check: () => string | null };

export function buildCases(): CompletenessCase[] {
  const schemaSrc = fs.readFileSync(SCHEMA_PATH, "utf8");
  const roleGuardsSrc = fs.readFileSync(ROLE_GUARDS_PATH, "utf8");
  const modulesSrc = fs.readFileSync(MODULES_PATH, "utf8");

  const knownRoles = parseUserRoleEnum(schemaSrc);
  const adminTier = parseAdminTierRoles(roleGuardsSrc);
  const requiredRoles = Array.from(new Set([...adminTier, "program_admin"]));
  const moduleSlugs = parseModuleSlugs(modulesSrc);

  const cases: CompletenessCase[] = [];

  cases.push({
    name: "sanity: UserRole enum + admin tier + module registry parsed from live source (not hardcoded)",
    check: () => {
      if (knownRoles.length < 5) return `parsed suspiciously few roles from schema.prisma: ${JSON.stringify(knownRoles)}`;
      if (!knownRoles.includes("program_admin")) return `program_admin missing from parsed UserRole enum: ${JSON.stringify(knownRoles)}`;
      if (!requiredRoles.includes("super_admin") || !requiredRoles.includes("org_admin") || !requiredRoles.includes("admin") || !requiredRoles.includes("program_admin")) {
        return `derived admin-tier set is missing an expected role: ${JSON.stringify(requiredRoles)}`;
      }
      if (moduleSlugs.length < 5) return `parsed suspiciously few module slugs: ${JSON.stringify(moduleSlugs)}`;
      return null;
    },
  });

  const files = new Set<string>();
  for (const slug of moduleSlugs) {
    for (const { dir, exts } of moduleRootDirs(slug)) {
      for (const f of walk(dir, exts)) files.add(f);
    }
  }

  const allSites: RoleGateSite[] = [];
  for (const file of files) {
    const relFile = path.relative(REPO_ROOT, file);
    const text = fs.readFileSync(file, "utf8");
    allSites.push(...findSitesInText(text, relFile, knownRoles));
  }

  cases.push({
    name: "sanity: scan found a non-trivial number of module role-gate sites (scanner is actually running)",
    check: () => {
      if (allSites.length < 15) {
        return `only found ${allSites.length} candidate role-gate sites across ${moduleSlugs.length} module dirs — scanner may be broken (expected 15+).`;
      }
      return null;
    },
  });

  for (const site of allSites) {
    const except = isExcepted(site, ROLE_GATE_KNOWN_EXCEPTIONS);
    cases.push({
      name: `${site.file}:${site.line}`,
      check: () => {
        if (except) return null; // documented, reviewed exception
        const missing = requiredRoles.filter((r) => !site.roles.includes(r));
        if (missing.length === 0) return null;
        return (
          `${site.file}:${site.line} has roles [${site.roles.join(", ")}] but is missing admin-tier role(s) ` +
          `[${missing.join(", ")}].\n      Snippet: ${site.snippet}\n      Fix: add the missing role(s) to this ` +
          `gate, OR — if this is a deliberate exclusion — add a justified entry to lib/auth/role-gate-known-exceptions.ts.`
        );
      },
    });
  }

  return cases;
}

export const cases = buildCases();
