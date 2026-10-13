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
  getDocumentGroupNode,
  listDocumentsInGroup,
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
  const [children, breadcrumb, currentNode, currentDocuments] = await Promise.all([
    listDocumentGroupChildren(orgId, companyId, parentGroupId || null),
    parentGroupId
      ? getDocumentGroupBreadcrumb(orgId, parentGroupId)
      : Promise.resolve([]),
    // CEO Pinpoint item #12a (2026-10-13): the drill-down's empty state
    // said "ยังไม่มีโฟลเดอร์ในนี้" (no sub-folder here) even when the
    // current folder has documents placed directly in it — misleading,
    // reads as "this folder is empty" when it isn't. The company-root
    // "folder" (parentGroupId null) isn't a real DocumentGroup row — its
    // own direct documents are a different, pre-existing concept shown
    // elsewhere (tree-browser.tsx's "ของบริษัท" bucket) — so there's
    // nothing to fetch there; only a real folder node needs this.
    parentGroupId ? getDocumentGroupNode(orgId, parentGroupId) : Promise.resolve(null),
    // CEO Pinpoint item #12b (2026-10-13) — the actual documents placed
    // directly in the folder being viewed, not just their count. Same
    // "only a real folder node has this" scoping as currentNode above.
    parentGroupId ? listDocumentsInGroup(orgId, parentGroupId) : Promise.resolve([]),
  ]);

  return NextResponse.json({
    children,
    breadcrumb,
    currentDocumentCount: currentNode?.documentCount ?? 0,
    currentDocuments,
  });
}
