// POST /api/cashhub/tea/match-rule — บันทึกกฎการแมตช์ (วันต้องตรงกัน + ยอดห่างกันได้กี่บาท) ต่อบัญชี (super_admin)
// อยู่ใต้ tea เพราะหน้าตั้งค่าเดียวที่แก้ตอนนี้คือของร้านชาไข่มุก แต่เขียนลง ledger_bank_match_rule
// (ตารางกลาง ผูกกับ ledger_bank_account) — มีผลเฉพาะบัญชีที่ร้านชาไข่มุกใช้จริงเท่านั้น
// body = { rules: [{ bankAccountId, conceptKey, dateWindowDays, tolBaht }] }
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { audit } from "@/lib/audit/log";
import { saveAccountMatchRules } from "@/lib/ledger/reconcile-match-rule";

export const runtime = "nodejs";

type InRule = { bankAccountId?: string; conceptKey?: string; dateWindowDays?: number | null; tolBaht?: number | null };

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  if (!isSuperAdmin(gate.session.user.role))
    return NextResponse.json({ error: "เฉพาะ super_admin ตั้งค่ากฎการแมตช์ได้" }, { status: 403 });

  let body: { rules?: InRule[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body ไม่ถูกต้อง" }, { status: 400 });
  }
  const rules = (body.rules ?? []).filter(
    (r): r is Required<Pick<InRule, "bankAccountId" | "conceptKey">> & InRule => !!r.bankAccountId && !!r.conceptKey,
  );
  if (rules.length === 0) return NextResponse.json({ ok: true });

  const orgId = gate.session.user.org_id;
  const byAccount = new Map<string, InRule[]>();
  for (const r of rules) {
    const list = byAccount.get(r.bankAccountId!) ?? [];
    list.push(r);
    byAccount.set(r.bankAccountId!, list);
  }
  for (const [accountId, list] of byAccount) {
    const res = await saveAccountMatchRules(
      orgId,
      accountId,
      gate.session.user.id,
      list.map((r) => ({
        conceptKey: r.conceptKey!,
        dateWindowDays: r.dateWindowDays ?? null,
        tolBaht: r.tolBaht ?? null,
      })),
    );
    if (!res.ok) return NextResponse.json({ error: res.error ?? "บันทึกไม่สำเร็จ" }, { status: 500 });
  }

  await audit({
    orgId,
    userId: gate.session.user.id,
    action: "SAVE_LEDGER_MATCH_RULE",
    resourceType: "ledger_bank_match_rule",
    diff: { new: { rules: rules.length, accounts: byAccount.size } },
  });
  return NextResponse.json({ ok: true });
}
