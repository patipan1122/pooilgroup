// Record a failed login attempt + audit FAILED_LOGIN.
// Called by login-form.tsx when Supabase signIn rejects.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { trackFailedLogin, getMetaFromRequest } from "@/lib/auth/login-tracker";

const Schema = z.object({
  email: z.string().email(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const status = await trackFailedLogin(parsed.data.email, getMetaFromRequest(req));
  return NextResponse.json(status);
}
