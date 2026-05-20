"use server";

import { requireSession } from "@/lib/auth/session";
import { requireRecruitAccess } from "@/lib/recruit/role-guard";
import { chatSupport } from "@/lib/recruit/ai";

export async function askChat(input: {
  message: string;
  context?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<string> {
  const session = await requireSession();
  requireRecruitAccess(session.user.role);
  return chatSupport(input);
}
