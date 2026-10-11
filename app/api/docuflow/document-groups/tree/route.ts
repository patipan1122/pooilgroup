// GET /api/docuflow/document-groups/tree?companyId=...&parentGroupId=...
// ────────────────────────────────────────────────────────────────────
// Read endpoint for the nested-folder drill-down UI (CEO feedback
// 2026-10-11) — one screen's worth of data per request: the current
// folder's children (or top-level folders under the company, when
// parentGroupId is omitted) plus the breadcrumb path to render above it.
// View-tier gate (same as the parent document-groups GET) — browsing the
// tree doesn't need admin; only create/delete does (document-group-tree-
// actions.ts server actions, already admin-gated there).
// ────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { userCanViewModule } from "@/lib/auth/module-access";
import { zUUID } from "@/lib/zod-helpers";
import {
  listDocumentGroupChildren,
  getDocumentGroupBreadcrumb,
} from "@/lib/docuflow/document-groups";

export const dynamic = "force-dynamic";

const UUID = zUUID();

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!(await userCanViewModule(session.user, "docuflow"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId") ?? "";
  const parentGroupId = searchParams.get("parentGroupId");

  if (!UUID.safeParse(companyId).success) {
    return NextResponse.json({ error: "Invalid companyId" }, { status: 400 });
  }
  if (parentGroupId && !UUID.safeParse(parentGroupId).success) {
    return NextResponse.json(
      { error: "Invalid parentGroupId" },
      { status: 400 },
    );
  }

  const orgId = session.user.org_id;
  const [children, breadcrumb] = await Promise.all([
    listDocumentGroupChildren(orgId, companyId, parentGroupId || null),
    parentGroupId
      ? getDocumentGroupBreadcrumb(orgId, parentGroupId)
      : Promise.resolve([]),
  ]);

  return NextResponse.json({ children, breadcrumb });
}
