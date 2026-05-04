import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";

const Schema = z.object({
  password: z.string().min(8),
});

export async function POST(req: NextRequest) {
  const session = await requireSession();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "รหัสผ่านอย่างน้อย 8 ตัว" },
      { status: 400 },
    );
  }

  const admin = adminClient();
  const { error } = await admin.auth.admin.updateUserById(session.authUserId, {
    password: parsed.data.password,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Clear must_change_password flag if set
  await admin
    .from("users")
    .update({ must_change_password: false, updated_at: new Date().toISOString() })
    .eq("id", session.user.id);

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "UPDATE_USER",
    resourceType: "user",
    resourceId: session.user.id,
    diff: { new: { password_changed: true } },
  });

  return NextResponse.json({ success: true });
}
