import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";

const PatchSchema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest) {
  const session = await requireSession();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
      { status: 400 },
    );
  }

  const admin = adminClient();
  const { error } = await admin
    .from("users")
    .update({
      name: parsed.data.name,
      phone: parsed.data.phone,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await audit({
    orgId: session.user.org_id,
    userId: session.user.id,
    action: "UPDATE_USER",
    resourceType: "user",
    resourceId: session.user.id,
    diff: {
      old: { name: session.user.name, phone: session.user.phone },
      new: { name: parsed.data.name, phone: parsed.data.phone },
    },
  });

  return NextResponse.json({ success: true });
}
