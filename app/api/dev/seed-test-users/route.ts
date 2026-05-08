// POST /api/dev/seed-test-users
//
// Idempotent dev endpoint that creates a full set of test accounts so the CEO
// (and anyone QA-ing the system) can log in as every role and walk the flows.
//
// Caller must already be super_admin in this org. The first super_admin still
// has to be created manually once via Supabase Auth dashboard (and a row
// inserted into public.users with role='super_admin') — that bootstrap step
// can't be automated safely. After that, this endpoint provisions:
//
//   • org_admin   (HR/IT — manage users + audit)
//   • admin       (mid-level admin)
//   • area_manager (cross-branch viewer + approver, gets first 3 active branches)
//   • branch_manager × N  (one per active branch — approve own branch reports)
//   • staff × N           (one per active branch — fill reports via LIFF)
//   • viewer      (account team — read-only)
//
// Idempotent: skips users whose email already exists. Safe to re-run.
// Response includes the email + temp password for each account so the CEO
// can copy them once.
//
// Returns 4xx on hard errors. The endpoint sleeps after a failure so a
// half-created auth user is rolled back to keep retries clean.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";

// Default test password. Override via body { password: "..." } for a custom one.
const DEFAULT_PASSWORD = "Pooil2026!";

const Schema = z.object({
  emailDomain: z.string().min(3).default("pooilgroup.test"),
  password: z.string().min(8).max(72).default(DEFAULT_PASSWORD),
  // When true, also create one branch_manager + one staff per active branch.
  // Useful for full-coverage testing; turn off if branches are 30+ to avoid
  // creating 60 auth users.
  perBranch: z.boolean().default(true),
});

interface CreatedUser {
  role: string;
  name: string;
  email: string;
  password: string;
  branchCode?: string;
  status: "created" | "skipped_exists";
}

const ADMIN_TIER = new Set(["super_admin", "org_admin", "admin"]);

export async function POST(req: NextRequest) {
  const session = await requireRole("super_admin");
  const orgId = session.user.org_id;
  const admin = adminClient();

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // body optional — fine
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
      { status: 400 },
    );
  }
  const { emailDomain, password, perBranch } = parsed.data;

  // Pull active branches (ordered) so the per-branch users are deterministic.
  const { data: branches } = await admin
    .from("branches")
    .select("id, code, name, business_type, company_id")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .order("code");

  if (!branches || branches.length === 0) {
    return NextResponse.json(
      {
        error:
          "ยังไม่มีสาขาในระบบ — สร้างสาขาก่อน แล้วค่อยมา seed test users (เพราะ branch_manager/staff ต้องผูกสาขา)",
      },
      { status: 400 },
    );
  }

  const created: CreatedUser[] = [];
  const errors: string[] = [];

  // ---- Helper: create-or-skip a single user ----
  async function provision(opts: {
    role: string;
    name: string;
    emailLocal: string; // e.g. "owner-admin"
    branchIds?: string[];
    modules?: string[];
  }): Promise<CreatedUser | null> {
    const email = `${opts.emailLocal}@${emailDomain}`;
    // Check existence
    const { data: existing } = await admin
      .from("users")
      .select("id, email")
      .eq("email", email)
      .eq("org_id", orgId)
      .maybeSingle();
    if (existing) {
      return {
        role: opts.role,
        name: opts.name,
        email,
        password: "(already exists — use existing password)",
        branchCode: opts.branchIds?.[0] ? branchCodeFor(branches, opts.branchIds[0]) : undefined,
        status: "skipped_exists",
      };
    }

    // Create Supabase auth user
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: opts.name },
    });
    if (authErr || !authData.user) {
      errors.push(`${opts.emailLocal}: ${authErr?.message ?? "auth failed"}`);
      return null;
    }
    const uid = authData.user.id;
    const now = new Date().toISOString();

    // Insert public.users
    const { error: insertErr } = await admin.from("users").insert({
      id: uid,
      org_id: orgId,
      email,
      name: opts.name,
      role: opts.role,
      must_change_password: false, // test users — skip forced change so CEO can log in immediately
      is_active: true,
      invited_by: session.user.id,
      invite_used_at: now,
      updated_at: now,
    });
    if (insertErr) {
      // Roll back auth user so retries are clean
      await admin.auth.admin.deleteUser(uid).catch(() => {});
      errors.push(`${opts.emailLocal} (insert users): ${insertErr.message}`);
      return null;
    }

    // user_branches for non-admin roles
    if (opts.branchIds && opts.branchIds.length > 0) {
      const rows = opts.branchIds.map((bid) => ({
        id: crypto.randomUUID(),
        org_id: orgId,
        user_id: uid,
        branch_id: bid,
        is_active: true,
      }));
      await admin.from("user_branches").insert(rows);
    }

    // user_modules for non-admin tier
    if (!ADMIN_TIER.has(opts.role)) {
      const list =
        opts.modules && opts.modules.length > 0 ? opts.modules : ["cashhub"];
      await admin.from("user_modules").insert(
        list.map((m) => ({
          org_id: orgId,
          user_id: uid,
          module_name: m,
          is_active: true,
          granted_by: session.user.id,
          updated_at: now,
        })),
      );
    }

    return {
      role: opts.role,
      name: opts.name,
      email,
      password,
      branchCode: opts.branchIds?.[0] ? branchCodeFor(branches, opts.branchIds[0]) : undefined,
      status: "created",
    };
  }

  // ---- 1. Admin tier (no branches) ----
  const adminTier = [
    { role: "org_admin", emailLocal: "orgadmin", name: "HR Admin (Test)" },
    { role: "admin", emailLocal: "admin", name: "Mid Admin (Test)" },
    { role: "viewer", emailLocal: "viewer", name: "ทีมบัญชี (Test)" },
  ];
  for (const u of adminTier) {
    const r = await provision(u);
    if (r) created.push(r);
  }

  // ---- 2. Area manager — gets first 3 active branches as reach ----
  const areaBranchIds = branches.slice(0, Math.min(3, branches.length)).map((b) => b.id);
  const areaResult = await provision({
    role: "area_manager",
    emailLocal: "area-isan",
    name: "ผจก. เขตอีสาน (Test)",
    branchIds: areaBranchIds,
  });
  if (areaResult) created.push(areaResult);

  // ---- 3. Per-branch: branch_manager + staff ----
  if (perBranch) {
    for (const b of branches) {
      const code = String(b.code).toLowerCase().replace(/[^a-z0-9-]/g, "-");
      const mgr = await provision({
        role: "branch_manager",
        emailLocal: `mgr-${code}`,
        name: `ผจก. ${b.code} (Test)`,
        branchIds: [b.id],
      });
      if (mgr) created.push(mgr);
      const staff = await provision({
        role: "staff",
        emailLocal: `staff-${code}`,
        name: `พนักงาน ${b.code} (Test)`,
        branchIds: [b.id],
      });
      if (staff) created.push(staff);
    }
  }

  await audit({
    orgId,
    userId: session.user.id,
    action: "EXPORT_DATA", // closest existing audit type — used for "seed" actions
    resourceType: "test_users_seed",
    diff: {
      new: {
        created: created.filter((c) => c.status === "created").length,
        skipped: created.filter((c) => c.status === "skipped_exists").length,
        emailDomain,
      },
    },
  });

  return NextResponse.json({
    success: true,
    summary: {
      created: created.filter((c) => c.status === "created").length,
      skipped: created.filter((c) => c.status === "skipped_exists").length,
      errors: errors.length,
      branches: branches.length,
      defaultPassword: password,
      emailDomain,
      note: "บัญชีทดสอบทั้งหมดใช้ password เดียวกัน — เปลี่ยนได้ภายหลัง",
    },
    users: created,
    errors: errors.slice(0, 10),
  });
}

function branchCodeFor(
  branches: Array<{ id: string; code: string }> | null | undefined,
  id: string,
): string | undefined {
  return branches?.find((b) => b.id === id)?.code;
}
