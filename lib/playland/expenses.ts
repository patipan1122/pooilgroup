"use server";

// Playland · ต้นทุน/ค่าใช้จ่าย (รายงานกำไร-ขาดทุนเจ้าของ) — กรอกเอง + AI ช่วยกรอก + ลบ
// สิทธิ์: ผู้จัดการขึ้นไป (ต้นทุน = ข้อมูลการเงิน) · ลบ = audit category money

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canPlaylandManage } from "./role-guard";
import { getPlaylandRole } from "./position-resolve";
import { verifyBranchOrg } from "./guards";
import Anthropic from "@anthropic-ai/sdk";

type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };
const err = (m: string) => ({ ok: false as const, error: m });

export const EXPENSE_KINDS = ["labor", "electricity", "rent", "water", "supplies", "marketing", "other"] as const;
type ExpenseKind = (typeof EXPENSE_KINDS)[number];
const isKind = (k: string): k is ExpenseKind => (EXPENSE_KINDS as readonly string[]).includes(k);

export interface ExpenseInput {
  branchId: string;
  expenseDate: string; // YYYY-MM-DD
  kind: string;
  label?: string;
  amountCents: number;
  staffCount?: number;
  period?: "once" | "monthly";
  note?: string;
}

// ── เพิ่มต้นทุน 1 รายการ (ผจก.+) ──
export async function addExpense(input: ExpenseInput): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  if (!canPlaylandManage(await getPlaylandRole(session.user.id, session.user.org_id, session.user.role))) return err("เฉพาะผู้จัดการขึ้นไปกรอกต้นทุนได้");
  if (!(await verifyBranchOrg(input.branchId, session.user.org_id))) return err("สาขาไม่อยู่ใน org");
  const kind = isKind(input.kind) ? input.kind : "other";
  const date = new Date(input.expenseDate);
  if (isNaN(date.getTime())) return err("วันที่ไม่ถูกต้อง");
  const amount = Math.round(input.amountCents);
  if (!Number.isFinite(amount) || amount < 0) return err("จำนวนเงินไม่ถูกต้อง");
  try {
    const row = await prisma.playlandDailyExpense.create({
      data: {
        orgId: session.user.org_id, branchId: input.branchId, expenseDate: date,
        kind, label: input.label?.trim() || null, amountCents: amount,
        staffCount: input.staffCount != null && input.staffCount > 0 ? Math.round(input.staffCount) : null,
        period: input.period === "monthly" ? "monthly" : "once",
        note: input.note?.trim() || null, createdByUserId: session.user.id,
      },
      select: { id: true },
    });
    revalidatePath("/playland/reports");
    return { ok: true, data: { id: row.id } };
  } catch (e) { return err(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ"); }
}

// ── ลบต้นทุน (ผจก.+ · audit category money) ──
export async function deleteExpense(id: string): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  if (!canPlaylandManage(await getPlaylandRole(session.user.id, session.user.org_id, session.user.role))) return err("เฉพาะผู้จัดการขึ้นไปลบได้");
  const rec = await prisma.playlandDailyExpense.findFirst({ where: { id, orgId: session.user.org_id } });
  if (!rec) return err("ไม่พบรายการ หรือไม่อยู่ใน org");
  try {
    await prisma.$transaction([
      prisma.playlandAuditLog.create({
        data: {
          orgId: session.user.org_id, branchId: rec.branchId, actorUserId: session.user.id, actorRole: session.user.role,
          action: "expense.delete", entityType: "PlaylandDailyExpense", entityId: rec.id,
          before: JSON.parse(JSON.stringify(rec)), category: "money",
        },
      }),
      prisma.playlandDailyExpense.delete({ where: { id } }),
    ]);
    revalidatePath("/playland/reports");
    return { ok: true, data: { id } };
  } catch (e) { return err(e instanceof Error ? e.message : "ลบไม่สำเร็จ"); }
}

// ── AI ช่วยกรอก: พิมพ์ภาษาคน → แยกเป็นรายการต้นทุน (preview · ยังไม่บันทึก) ──
export interface ParsedExpense { kind: string; label: string; amountCents: number; staffCount?: number; period: "once" | "monthly"; }

export async function aiParseExpenses(input: { branchId: string; text: string }): Promise<ActionResult<{ items: ParsedExpense[] }>> {
  const session = await requireSession();
  if (!canPlaylandManage(await getPlaylandRole(session.user.id, session.user.org_id, session.user.role))) return err("เฉพาะผู้จัดการขึ้นไป");
  if (!(await verifyBranchOrg(input.branchId, session.user.org_id))) return err("สาขาไม่อยู่ใน org");
  const text = input.text.trim();
  if (!text) return err("พิมพ์ข้อความก่อน");
  if (!process.env.ANTHROPIC_API_KEY) return err("ยังไม่ได้ตั้งค่า AI (ANTHROPIC_API_KEY)");

  // budget guard (กัน loop/ค่าใช้จ่ายบาน)
  try {
    const { checkAiBudget } = await import("@/lib/ai/cost-cap");
    const budget = await checkAiBudget({ userId: session.user.id, orgId: session.user.org_id, endpoint: "playland.expense-parse" });
    if (!budget.allowed) return err(budget.reason || "เกินโควต้า AI ชั่วคราว ลองใหม่ภายหลัง");
  } catch { /* metering ล่มไม่บล็อก */ }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const HAIKU = "claude-haiku-4-5";
  const sys = `คุณเป็นผู้ช่วยแยกรายการต้นทุน/ค่าใช้จ่ายของร้านเด็กเล่น จากข้อความภาษาไทย.
ตอบกลับเป็น JSON array เท่านั้น ห้ามมีคำอธิบายอื่น. แต่ละรายการ = {"kind","label","amountBaht","staffCount","period"}.
kind = หนึ่งใน: labor(ค่าแรง/พนักงาน) · electricity(ค่าไฟ) · rent(ค่าเช่า) · water(ค่าน้ำ) · supplies(วัสดุ/ของใช้) · marketing(โฆษณา) · other(อื่นๆ).
period = "monthly" สำหรับค่าเช่า/ค่าไฟ/ค่าน้ำ/ค่าเน็ต (จ่ายรายเดือน), "once" สำหรับค่าแรงรายวัน/ของใช้/อื่นๆ (เว้นแต่ระบุชัดว่ารายเดือน).
amountBaht = จำนวนเงินเป็นบาท (ตัวเลขล้วน). staffCount = จำนวนพนักงาน (ใส่เฉพาะ kind=labor ที่ระบุจำนวนคน ไม่งั้น null). label = ชื่อรายการสั้นๆ ภาษาไทย.`;

  let raw = "";
  try {
    const resp = await anthropic.messages.create({
      model: HAIKU, max_tokens: 1024, system: sys,
      messages: [{ role: "user", content: text }],
    });
    raw = resp.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    try {
      const { recordAiUsage } = await import("@/lib/ai/cost-cap");
      await recordAiUsage({ userId: session.user.id, orgId: session.user.org_id, endpoint: "playland.expense-parse", model: HAIKU, moduleName: "playland", inputTokens: resp.usage?.input_tokens ?? 0, outputTokens: resp.usage?.output_tokens ?? 0 });
    } catch { /* best-effort */ }
  } catch (e) {
    return err("AI ไม่ตอบ ลองใหม่: " + (e instanceof Error ? e.message : ""));
  }

  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return err("AI แยกรายการไม่ได้ · ลองพิมพ์ให้ชัดขึ้น เช่น 'ค่าไฟ 8000 ค่าเช่า 30000 พนักงาน 4 คน ค่าแรง 2000'");
  let arr: unknown;
  try { arr = JSON.parse(m[0]); } catch { return err("AI ตอบไม่เป็นรูปแบบ ลองใหม่"); }
  if (!Array.isArray(arr)) return err("AI แยกรายการไม่ได้");

  const items: ParsedExpense[] = [];
  for (const it of arr as Array<Record<string, unknown>>) {
    const kind = typeof it.kind === "string" && isKind(it.kind) ? it.kind : "other";
    const baht = Number(it.amountBaht);
    if (!Number.isFinite(baht) || baht <= 0) continue;
    const sc = Number(it.staffCount);
    items.push({
      kind,
      label: typeof it.label === "string" ? it.label.slice(0, 80) : "",
      amountCents: Math.round(baht * 100),
      staffCount: Number.isFinite(sc) && sc > 0 ? Math.round(sc) : undefined,
      period: it.period === "monthly" ? "monthly" : "once",
    });
  }
  if (items.length === 0) return err("ไม่พบรายการต้นทุนในข้อความ · ลองพิมพ์ เช่น 'ค่าไฟ 8000 ค่าเช่า 30000 พนักงาน 4 คน ค่าแรง 2000'");
  return { ok: true, data: { items } };
}
