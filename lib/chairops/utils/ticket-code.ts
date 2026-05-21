// Damage ticket code generator
// Format: CH-YYYY-NNNN where YYYY is พ.ศ. (Buddhist year = ค.ศ. + 543)
// Pattern matches Pool's RP-2569-NNNN per memory [[repair-module-pooil-2026-05-20]]
//
// Approach: count existing tickets for the current พ.ศ. year prefix,
// generate next sequential number, retry on unique-violation (race-safe up to N=3).
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";

export function buddhistYear(date: Date = new Date()): number {
  return date.getUTCFullYear() + 543;
}

export function formatTicketCode(year: number, seq: number): string {
  return `CH-${year}-${String(seq).padStart(4, "0")}`;
}

/**
 * Find the next available ticket code for the current พ.ศ.
 * Race-safe: looks at the highest existing CH-{year}-NNNN and adds 1.
 * Callers should still wrap creation in a unique-violation retry loop
 * because two concurrent calls can pick the same number.
 */
export async function nextTicketCode(): Promise<string> {
  const year = buddhistYear();
  const prefix = `CH-${year}-`;

  const last = await prisma.chairopsDamageTicket.findFirst({
    where: { ticketCode: { startsWith: prefix } },
    orderBy: { ticketCode: "desc" },
    select: { ticketCode: true },
  });

  let seq = 1;
  if (last) {
    const tail = last.ticketCode.slice(prefix.length);
    const n = parseInt(tail, 10);
    if (!Number.isNaN(n)) seq = n + 1;
  }
  return formatTicketCode(year, seq);
}

/**
 * Create a DamageTicket with race-safe ticket code generation.
 * Retries up to 3 times on P2002 (unique constraint) by incrementing seq.
 */
export async function createTicketWithCode<T>(
  data: Omit<Prisma.ChairopsDamageTicketUncheckedCreateInput, "ticketCode">,
  select?: Prisma.ChairopsDamageTicketSelect
): Promise<T> {
  let code = await nextTicketCode();
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const result = await prisma.chairopsDamageTicket.create({
        data: { ...data, ticketCode: code },
        ...(select ? { select } : {}),
      });
      return result as T;
    } catch (e) {
      // P2002 = unique-constraint violation
      // Use duck-typing instead of instanceof to avoid Prisma runtime class import quirks
      const code2002 =
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        (e as { code: unknown }).code === "P2002";
      if (code2002 && attempt < 3) {
        const year = buddhistYear();
        const prefix = `CH-${year}-`;
        const tail = code.slice(prefix.length);
        const n = parseInt(tail, 10) + 1;
        code = formatTicketCode(year, n);
        continue;
      }
      throw e;
    }
  }
  throw new Error("ไม่สามารถสร้างรหัสตั๋วซ่อมได้ (race condition เกิน 4 ครั้ง)");
}
