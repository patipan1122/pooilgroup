// GET /api/ledger/meta?companyId=<id>
//   → { branches: [...], categories: [...] } for the chosen company.
//
// Used by the LIFF capture app (and any client picker) to refresh branch +
// category options when the user switches company, without importing server
// code. Org-scoped + module-gated like the other ledger routes.

import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { userHasModuleAccess } from "@/lib/auth/module-access";
import { isAdminTier } from "@/lib/auth/role-guards";
import { listBranches, listCategories } from "@/lib/ledger/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isAdminTier(session.user.role)) {
    const ok = await userHasModuleAccess(session.user, "ledger");
    if (!ok) return NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
  }

  const companyId = req.nextUrl.searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "ต้องระบุ companyId" }, { status: 400 });
  }

  const orgId = session.user.org_id;
  try {
    const [branches, categoriesRaw] = await Promise.all([
      listBranches(orgId, companyId),
      listCategories(orgId, companyId),
    ]);
    const categories = categoriesRaw.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
    }));
    return NextResponse.json({ branches, categories });
  } catch (err) {
    console.error("[ledger:meta] failed", err);
    return NextResponse.json({ error: "โหลดข้อมูลไม่สำเร็จ" }, { status: 500 });
  }
}
