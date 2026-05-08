// GET /api/docuflow/list
// ────────────────────────────────────────────────────────────────────
// Paginated list of documents (with ownership + tags + latest renewal).
// All filtering goes through the canonical loader at lib/docuflow/data.
//
// Query params:
//   level        — group | company | business_type | branch | person
//   branchId     — UUID
//   companyId    — UUID
//   businessType — string (e.g. fuel_station)
//   tag          — string
//   expiryStatus — expired | critical | urgent | watch | normal
//   isActive     — "true" | "false" (default true)
//   search       — free text (name + description)
//   limit        — 1..200 (default 50)
//   cursor       — last document id from previous page
// ────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { loadDocuments } from "@/lib/docuflow/data";

export const dynamic = "force-dynamic";

const EXPIRY_STATUSES = [
  "expired",
  "critical",
  "urgent",
  "watch",
  "normal",
] as const;

const QuerySchema = z.object({
  level: z
    .enum(["group", "company", "business_type", "branch", "person"])
    .optional(),
  branchId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  businessType: z.string().optional(),
  tag: z.string().optional(),
  expiryStatus: z.enum(EXPIRY_STATUSES).optional(),
  isActive: z.enum(["true", "false"]).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  const session = await requireSession();

  const sp = req.nextUrl.searchParams;
  const raw: Record<string, string> = {};
  for (const [k, v] of sp.entries()) {
    if (v !== "") raw[k] = v;
  }

  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "ข้อมูลไม่ถูกต้อง", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const q = parsed.data;
  const documents = await loadDocuments(session.user.org_id, {
    level: q.level,
    branchId: q.branchId,
    companyId: q.companyId,
    businessType: q.businessType,
    tag: q.tag,
    expiryStatus: q.expiryStatus,
    isActive: q.isActive ? q.isActive === "true" : true,
    search: q.search,
    limit: q.limit ?? 50,
    cursor: q.cursor,
  });

  const nextCursor =
    documents.length === (q.limit ?? 50)
      ? documents[documents.length - 1]?.id ?? null
      : null;

  return NextResponse.json({ documents, nextCursor });
}
