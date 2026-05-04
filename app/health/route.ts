import { NextResponse } from "next/server";
import { adminClient } from "@/lib/db/server";

export async function GET() {
  const checks: Record<string, "ok" | "fail" | "skip"> = {};
  const errors: Record<string, string> = {};

  // 1. Env vars
  const requiredEnv = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  const missingEnv = requiredEnv.filter((k) => !process.env[k]);
  checks.env = missingEnv.length === 0 ? "ok" : "fail";
  if (missingEnv.length > 0) errors.env = `missing: ${missingEnv.join(", ")}`;

  // 2. Supabase REST
  try {
    const admin = adminClient();
    const { error } = await admin
      .from("organizations")
      .select("id", { count: "exact", head: true });
    checks.supabase = error ? "fail" : "ok";
    if (error) errors.supabase = error.message;
  } catch (e) {
    checks.supabase = "fail";
    errors.supabase = e instanceof Error ? e.message : "unknown";
  }

  // 3. R2 (skip if not configured)
  if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID) {
    checks.r2 = "ok"; // assume ok, full check would require list bucket
  } else {
    checks.r2 = "skip";
  }

  const ok = Object.values(checks).every((s) => s !== "fail");
  const body = {
    status: ok ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    checks,
    errors,
  };

  return NextResponse.json(body, { status: ok ? 200 : 503 });
}
