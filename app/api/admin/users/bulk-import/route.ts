// Bulk import users from JSON array (parsed client-side from CSV).
// Each row creates a pending invite User — Admin sends invite links
// to each (or returns the array of links to bulk-distribute).
//
// Validation: rejects all if any row invalid (no partial commit).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { getRequestBaseUrl } from "@/lib/utils/base-url";

const RowSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(50).optional().or(z.literal("")),
  role: z
    .enum([
      "super_admin",
      "org_admin",
      "branch_manager",
      "staff",
      "driver",
      "viewer",
    ])
    .default("staff"),
  branchCodes: z.array(z.string()).optional().default([]),
});

const Schema = z.object({
  rows: z.array(RowSchema).min(1).max(200),
});

function makeToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function POST(req: NextRequest) {
  const session = await requireRole("super_admin", "org_admin");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
      { status: 400 },
    );
  }

  const admin = adminClient();
  const orgId = session.user.org_id;
  const baseUrl = getRequestBaseUrl(req);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  // Resolve branch codes → ids in one shot
  const allCodes = Array.from(
    new Set(parsed.data.rows.flatMap((r) => r.branchCodes ?? [])),
  ).map((c) => c.toUpperCase());

  let codeToId: Record<string, string> = {};
  if (allCodes.length > 0) {
    const { data: branches } = await admin
      .from("branches")
      .select("id, code")
      .eq("org_id", orgId)
      .in("code", allCodes);
    codeToId = Object.fromEntries(
      (branches ?? []).map((b) => [b.code.toUpperCase(), b.id]),
    );
  }

  // Process rows — collect results
  const results: {
    name: string;
    email?: string;
    phone?: string;
    role: string;
    inviteUrl?: string;
    error?: string;
  }[] = [];

  for (const row of parsed.data.rows) {
    const email = (row.email || "").trim() || null;

    // Skip duplicate email if already exists
    if (email) {
      const { data: existing } = await admin
        .from("users")
        .select("id")
        .eq("email", email)
        .maybeSingle();
      if (existing) {
        results.push({
          name: row.name,
          email: email,
          role: row.role,
          error: "อีเมลนี้มีในระบบแล้ว",
        });
        continue;
      }
    }

    const userId = crypto.randomUUID();
    const token = makeToken();

    const { error: insertErr } = await admin.from("users").insert({
      id: userId,
      org_id: orgId,
      email,
      name: row.name,
      phone: row.phone || null,
      role: row.role,
      must_change_password: true,
      is_active: false,
      invite_token: token,
      invite_expires_at: expiresAt,
      invited_by: session.user.id,
      updated_at: now,
    });

    if (insertErr) {
      results.push({
        name: row.name,
        email: email ?? undefined,
        role: row.role,
        error: insertErr.code === "23505" ? "อีเมลซ้ำ" : insertErr.message,
      });
      continue;
    }

    // Link branches
    const branchIds = (row.branchCodes ?? [])
      .map((c) => codeToId[c.toUpperCase()])
      .filter(Boolean);
    if (branchIds.length > 0) {
      await admin.from("user_branches").insert(
        branchIds.map((bid) => ({
          id: crypto.randomUUID(),
          org_id: orgId,
          user_id: userId,
          branch_id: bid,
          is_active: true,
        })),
      );
    }

    results.push({
      name: row.name,
      email: email ?? undefined,
      phone: row.phone || undefined,
      role: row.role,
      inviteUrl: `${baseUrl}/invite/${token}`,
    });
  }

  await audit({
    orgId,
    userId: session.user.id,
    action: "CREATE_USER",
    resourceType: "users_bulk_import",
    diff: {
      new: {
        total: parsed.data.rows.length,
        success: results.filter((r) => r.inviteUrl).length,
        failed: results.filter((r) => r.error).length,
      },
    },
  });

  return NextResponse.json({
    success: true,
    results,
    summary: {
      total: results.length,
      success: results.filter((r) => r.inviteUrl).length,
      failed: results.filter((r) => r.error).length,
    },
  });
}
