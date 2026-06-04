// /api/ledger/expenses
//   GET  ?companyId=&status=&period=&branchId=&search=  → list (org+company scoped)
//   POST { companyId, ...draftFields }                  → create a DRAFT expense
//
// Both gated by session + module entitlement. POST delegates to the
// createDraftExpense server action (status=draft — never auto-post).

import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { userHasModuleAccess } from "@/lib/auth/module-access";
import { isAdminTier } from "@/lib/auth/role-guards";
import { listExpenses, type ExpenseListFilter } from "@/lib/ledger/queries";
import { createDraftExpense, type CreateDraftInput } from "@/lib/ledger/actions";
import type { ExpenseStatus } from "@/lib/ledger/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: ExpenseStatus[] = ["draft", "confirmed", "locked", "void"];

async function gate(req: NextRequest) {
  const session = await requireSession();
  if (!isAdminTier(session.user.role)) {
    const ok = await userHasModuleAccess(session.user, "ledger");
    if (!ok) return { session: null as never, error: NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 }) };
  }
  return { session, error: null };
}

export async function GET(req: NextRequest) {
  let g;
  try {
    g = await gate(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (g.error) return g.error;

  const sp = req.nextUrl.searchParams;
  const companyId = sp.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "ต้องระบุ companyId" }, { status: 400 });
  }

  const statusParam = sp.get("status");
  const status =
    statusParam && STATUSES.includes(statusParam as ExpenseStatus)
      ? (statusParam as ExpenseStatus)
      : undefined;

  const filter: ExpenseListFilter = {
    orgId: g.session.user.org_id,
    companyId,
    branchId: sp.get("branchId") ?? undefined,
    status,
    period: sp.get("period") ?? undefined,
    categoryId: sp.get("categoryId") ?? undefined,
    search: sp.get("search") ?? undefined,
    take: Math.min(Number(sp.get("take")) || 100, 300),
    skip: Number(sp.get("skip")) || 0,
  };

  try {
    const expenses = await listExpenses(filter);
    return NextResponse.json({ expenses });
  } catch (err) {
    console.error("[ledger:expenses:GET] failed", err);
    return NextResponse.json({ error: "โหลดรายการไม่สำเร็จ" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await gate(req); // throws on no session; gate handles 403
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: CreateDraftInput;
  try {
    body = (await req.json()) as CreateDraftInput;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.companyId) {
    return NextResponse.json({ error: "ต้องระบุ companyId" }, { status: 400 });
  }

  // SECURITY: never trust a client-supplied author. createdById is the system/
  // webhook-only override (server-to-server path uses createDraftExpenseSystem);
  // for this session route, force the author to the logged-in user (the action
  // defaults createdById → session.user.id when absent). Strip any forged value.
  body.createdById = undefined;

  const res = await createDraftExpense(body);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }
  return NextResponse.json(res.data, { status: res.data.duplicate ? 200 : 201 });
}
