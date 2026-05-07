import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";

// Pooilgroup org_id matches seed
const POOILGROUP_ORG_ID = "00000000-0000-0000-0000-000000000001";

const SignupSchema = z.object({
  email: z.string().email("อีเมลไม่ถูกต้อง"),
  password: z.string().min(8, "รหัสผ่านอย่างน้อย 8 ตัว"),
  name: z.string().min(1, "กรุณากรอกชื่อ").max(100),
  phone: z
    .string()
    .regex(/^[0-9-+\s]{9,20}$/, "เบอร์โทรไม่ถูกต้อง")
    .optional()
    .or(z.literal("")),
});

// Public signup is BOOTSTRAP-ONLY: it works ONLY when no super_admin exists
// in the Pooilgroup org yet. Once the first super_admin is provisioned,
// this endpoint refuses every subsequent request and points the caller at
// /join (admin-approved request) instead. This closes the previous hole
// where any visitor could create a `staff` account that was active immediately.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = SignupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
      { status: 400 },
    );
  }

  const { email, password, name } = parsed.data;
  const phone = parsed.data.phone || null;
  const admin = adminClient();

  // Check if any super_admin exists in Pooilgroup org
  const { count: superAdminCount } = await admin
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("org_id", POOILGROUP_ORG_ID)
    .eq("role", "super_admin")
    .eq("is_active", true);

  const isFirstUser = !superAdminCount || superAdminCount === 0;

  // CLOSED: signup blocked once bootstrap super_admin exists. Public users
  // must go through /join → admin approval → invite link instead. Per
  // feedback_user_creation_rules.md (hierarchical approval rule).
  if (!isFirstUser) {
    return NextResponse.json(
      {
        error:
          "ระบบปิดการสมัครสาธารณะ — กรุณาขอเข้าใช้งานที่ /join (ต้องผ่านอนุมัติ admin)",
        redirect: "/join",
      },
      { status: 403 },
    );
  }

  const role = "super_admin";

  // 1. Check email already exists in our users table
  const { data: existingUser } = await admin
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existingUser) {
    return NextResponse.json(
      { error: "อีเมลนี้ถูกใช้แล้ว — เข้าสู่ระบบหรือ Reset รหัสผ่าน" },
      { status: 409 },
    );
  }

  // 2. Create Supabase Auth user (auto-confirm to skip email verification)
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true,
    user_metadata: { name },
  });

  if (authError || !authData.user) {
    const msg = authError?.message ?? "สร้างบัญชีไม่ได้";
    if (msg.includes("already") || msg.includes("registered")) {
      return NextResponse.json(
        { error: "อีเมลนี้ถูกใช้แล้ว" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const authUserId = authData.user.id;

  // 3. Create matching public.users row (use SAME id as auth.users)
  const now = new Date().toISOString();
  const { error: dbError } = await admin.from("users").insert({
    id: authUserId,
    org_id: POOILGROUP_ORG_ID,
    email: email.trim(),
    name,
    phone,
    role,
    must_change_password: false,
    is_active: true,
    updated_at: now,
  });

  if (dbError) {
    // Rollback: delete the auth user we just created
    await admin.auth.admin.deleteUser(authUserId);
    console.error("[signup db]", dbError);
    return NextResponse.json(
      { error: "บันทึกข้อมูลไม่ได้: " + dbError.message },
      { status: 500 },
    );
  }

  // 4. Audit
  await audit({
    orgId: POOILGROUP_ORG_ID,
    userId: authUserId,
    action: "CREATE_USER",
    resourceType: "user",
    resourceId: authUserId,
    diff: { new: { role, isFirstUser } },
  });

  return NextResponse.json({
    success: true,
    isFirstUser,
    role,
  });
}
