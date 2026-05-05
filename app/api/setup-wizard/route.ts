// Setup Wizard — bulk-create branches + invite admin from a single answer set.
// Super-admin only.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";

const Schema = z.object({
  companyId: z.string().uuid().optional(),
  branches: z
    .array(
      z.object({
        code: z.string().min(2).max(20),
        name: z.string().min(1).max(120),
        businessType: z.string().min(2),
        province: z.string().max(60).optional(),
        region: z.string().max(60).optional(),
        deadline: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        target: z.number().min(0).optional(),
      }),
    )
    .min(1)
    .max(50),
  managerInvites: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        phone: z.string().min(8).max(20),
        email: z.string().email().optional(),
        branchCode: z.string().min(2).max(20),
        role: z.enum(["branch_manager", "staff", "admin"]).default("branch_manager"),
      }),
    )
    .max(50)
    .optional()
    .default([]),
});

export async function POST(req: NextRequest) {
  const session = await requireRole("super_admin");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง", issues: parsed.error.issues }, { status: 400 });
  }
  const { companyId, branches, managerInvites } = parsed.data;
  const admin = adminClient();
  const now = new Date().toISOString();

  // Create branches
  let createdBranches = 0;
  let skippedBranches = 0;
  const codeToId = new Map<string, string>();
  for (const b of branches) {
    const id = crypto.randomUUID();
    const payload: Record<string, unknown> = {
      id,
      org_id: session.user.org_id,
      code: b.code,
      name: b.name,
      business_type: b.businessType,
      province: b.province ?? null,
      region: b.region ?? null,
      report_deadline: b.deadline ?? "21:00",
      is_active: true,
      updated_at: now,
    };
    if (companyId) payload.company_id = companyId;
    const { error } = await admin.from("branches").insert(payload);
    if (error) {
      if (error.code === "23505") {
        skippedBranches += 1;
        // Look up existing id
        const { data: existing } = await admin
          .from("branches")
          .select("id")
          .eq("org_id", session.user.org_id)
          .eq("code", b.code)
          .maybeSingle();
        if (existing) codeToId.set(b.code, existing.id as string);
      } else {
        return NextResponse.json(
          { error: error.message, where: `branch ${b.code}` },
          { status: 500 },
        );
      }
    } else {
      createdBranches += 1;
      codeToId.set(b.code, id);
    }
    // Optional target
    if (b.target && b.target > 0) {
      const now2 = new Date();
      const year = now2.getFullYear();
      const month = now2.getMonth() + 1;
      const branchId = codeToId.get(b.code);
      if (branchId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin.from as any)("branch_targets").upsert(
          {
            id: crypto.randomUUID(),
            org_id: session.user.org_id,
            branch_id: branchId,
            year,
            month,
            amount: b.target,
            source: "setup_wizard",
            updated_at: now,
          },
          { onConflict: "branch_id,year,month" },
        );
      }
    }
  }

  // Create invites
  let createdInvites = 0;
  for (const inv of managerInvites) {
    const branchId = codeToId.get(inv.branchCode);
    if (!branchId) continue;
    const token = crypto.randomUUID().replace(/-/g, "");
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const userId = crypto.randomUUID();
    const { error: userErr } = await admin.from("users").insert({
      id: userId,
      org_id: session.user.org_id,
      name: inv.name,
      phone: inv.phone,
      email: inv.email ?? null,
      role: inv.role,
      invite_token: token,
      invite_expires_at: expiresAt,
      must_change_password: true,
      is_active: true,
      updated_at: now,
    });
    if (userErr) continue;
    await admin.from("user_branches").insert({
      id: crypto.randomUUID(),
      org_id: session.user.org_id,
      user_id: userId,
      branch_id: branchId,
      is_active: true,
    });
    createdInvites += 1;
  }

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "EXPORT_DATA",
    resourceType: "setup_wizard_run",
    diff: {
      new: {
        createdBranches,
        skippedBranches,
        createdInvites,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    createdBranches,
    skippedBranches,
    createdInvites,
  });
}
