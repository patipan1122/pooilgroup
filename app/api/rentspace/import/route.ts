import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit/log";
import { toNum } from "@/lib/rentspace/format";

export const dynamic = "force-dynamic";

type Row = Record<string, string>;

type Diff = {
  row: number;
  unitCode: string;
  status: "new" | "updated" | "error";
  tenant: string;
  errors: string[];
};

// ── field helpers ──────────────────────────────────────────────────
function pick(row: Row, key: string): string {
  return (row[key] ?? "").trim();
}

/** "A1 SHABU ZEED" → { code: "A1", name: "SHABU ZEED" } */
function parseUnit(raw: string): { code: string; name: string } {
  const s = raw.trim();
  const sp = s.indexOf(" ");
  if (sp === -1) return { code: s, name: "" };
  return { code: s.slice(0, sp).trim(), name: s.slice(sp + 1).trim() };
}

/** building prefix from a unit code: "A2/1" → "A2", "A1" → "A1" */
function buildingOf(code: string): string {
  const beforeSlash = code.split("/")[0].trim();
  const m = beforeSlash.match(/^[A-Za-zก-๙]+\d*/);
  return (m ? m[0] : beforeSlash).toUpperCase();
}

/** Parse DD/MM/YYYY (Thai BE or CE) or YYYY-MM-DD → Date | null */
function parseDate(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  // YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const y = Number(m[1]);
    const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[3])));
    return isNaN(d.getTime()) ? null : d;
  }
  // DD/MM/YYYY or DD-MM-YYYY
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const day = Number(m[1]);
    const mon = Number(m[2]);
    let year = Number(m[3]);
    if (m[3].length <= 2) year += year < 70 ? 2000 : 1900;
    // Thai Buddhist year → Gregorian
    if (year > 2400) year -= 543;
    const d = new Date(Date.UTC(year, mon - 1, day));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parsePhones(raw: string): string[] {
  return raw
    .split(/[,/\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Split a person name "นาย สมชาย ใจดี" → {prefix?, firstName, lastName} */
function splitPersonName(raw: string): { prefix?: string; firstName?: string; lastName?: string } {
  const PREFIXES = ["นาย", "นาง", "นางสาว", "น.ส.", "ด.ช.", "ด.ญ.", "บริษัท", "หจก.", "ห้างหุ้นส่วน"];
  let s = raw.trim();
  let prefix: string | undefined;
  for (const p of PREFIXES) {
    if (s.startsWith(p)) {
      prefix = p;
      s = s.slice(p.length).trim();
      break;
    }
  }
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { prefix };
  if (parts.length === 1) return { prefix, firstName: parts[0] };
  return { prefix, firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/** Decide whether a name string is a business (shop) name or a person. */
function looksLikeBusiness(raw: string): boolean {
  return /ร้าน|บริษัท|หจก|ห้าง|shop|store|cafe|amazon|shabu|zeed/i.test(raw);
}

const DEFAULT_PROJECT = {
  name: "โครงการทะเลทาวน์",
  slug: "talaytown",
  electricRate: 7,
  waterRate: 18,
};

export async function POST(req: Request) {
  // ── guard ──
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!isAdminTier(session.user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const orgId = session.user.org_id;

  // ── body ──
  let body: { rows?: Row[]; commit?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const commit = body.commit === true;
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, counts: { total: 0, new: 0, updated: 0, error: 0 }, diffs: [] });
  }

  // ── resolve / ensure the primary project ──
  let project = await prisma.rentalProject.findFirst({
    where: { orgId, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (!project) {
    if (commit) {
      project = await prisma.rentalProject.create({
        data: {
          id: randomUUID(),
          orgId,
          name: DEFAULT_PROJECT.name,
          slug: DEFAULT_PROJECT.slug,
          electricRate: DEFAULT_PROJECT.electricRate,
          waterRate: DEFAULT_PROJECT.waterRate,
        },
      });
    }
    // dry-run with no project → everything is "new"
  }
  const projectId = project?.id ?? null;

  const diffs: Diff[] = [];
  let countNew = 0;
  let countUpdated = 0;
  let countError = 0;
  let newUnits = 0;
  let newContracts = 0;

  // cache existing contractNo seq within this batch for sequential allocation
  let contractSeq: number | null = null;
  async function nextContractNo(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `CT${year}-`;
    if (contractSeq == null) {
      const last = await prisma.rentalContract.findFirst({
        where: { orgId, contractNo: { startsWith: prefix } },
        orderBy: { contractNo: "desc" },
        select: { contractNo: true },
      });
      contractSeq = last ? Number(last.contractNo.slice(prefix.length)) || 0 : 0;
    }
    contractSeq += 1;
    return `${prefix}${String(contractSeq).padStart(4, "0")}`;
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNo = i + 1;
    const errors: string[] = [];

    const unitRaw = pick(row, "ชื่อห้อง");
    const nameRaw = pick(row, "ชื่อ-นามสกุล/ชื่อร้าน");
    const phoneRaw = pick(row, "เบอร์โทร");
    const idCardNo = pick(row, "เลขบัตรประชาชน").replace(/[\s-]/g, "");
    const nationality = pick(row, "สัญชาติ");
    const address = pick(row, "ที่อยู่");
    const email = pick(row, "อีเมล");
    const lineId = pick(row, "line id");
    const birthDate = parseDate(pick(row, "วันเกิด"));
    const startDate = parseDate(pick(row, "วันที่เข้าทำสัญญา"));
    const endDate = parseDate(pick(row, "วันสิ้นสุดสัญญา"));
    const phones = parsePhones(phoneRaw);

    const { code: unitCode, name: unitName } = parseUnit(unitRaw);
    const building = unitCode ? buildingOf(unitCode) : "";

    // tenant identity
    const isBiz = !!nameRaw && looksLikeBusiness(nameRaw);
    const person = isBiz ? {} : splitPersonName(nameRaw);
    const bizName = isBiz ? nameRaw.trim() : undefined;
    const tenantLabel = bizName || [person.prefix, person.firstName, person.lastName].filter(Boolean).join(" ") || nameRaw;

    if (!unitCode) errors.push("ไม่มีรหัสห้อง");
    if (!nameRaw) errors.push("ไม่มีชื่อผู้เช่า/ร้าน");

    if (errors.length) {
      countError++;
      diffs.push({ row: rowNo, unitCode, status: "error", tenant: tenantLabel, errors });
      continue;
    }

    // ── determine existing state (used by BOTH dry-run and commit) ──
    const existingUnit = projectId
      ? await prisma.rentalUnit.findUnique({ where: { projectId_code: { projectId, code: unitCode } } })
      : null;

    // match tenant: by เลขบัตรประชาชน เท่านั้น — ห้าม match ด้วยชื่อ+เบอร์
    // (ชื่อพ้องกัน เช่น "สมชาย ใจดี" คนละคน จะถูกรวมเป็นคนเดียว → ผูกห้อง/บิลผิดคน)
    // ไม่มีเลขบัตร = ถือเป็นผู้เช่าใหม่เสมอ
    let existingTenant = null as Awaited<ReturnType<typeof prisma.rentalTenant.findFirst>> | null;
    if (idCardNo) {
      existingTenant = await prisma.rentalTenant.findFirst({ where: { orgId, idCardNo } });
    }

    const isNewTenant = !existingTenant;
    const willCreateUnit = !existingUnit;
    const status: "new" | "updated" = isNewTenant ? "new" : "updated";

    try {
      if (!commit) {
        // DRY-RUN: do NOT write anything.
        if (isNewTenant) countNew++;
        else countUpdated++;
        if (willCreateUnit) newUnits++;
        if (startDate && willCreateUnit) newContracts++;
        else if (startDate && existingUnit) {
          const active = await prisma.rentalContract.count({
            where: { unitId: existingUnit.id, status: { in: ["active", "expiring"] } },
          });
          if (active === 0) newContracts++;
        }
        diffs.push({ row: rowNo, unitCode, status, tenant: tenantLabel, errors: [] });
        continue;
      }

      // ── COMMIT ──
      // 1) upsert unit
      const unit = existingUnit
        ? await prisma.rentalUnit.update({
            where: { id: existingUnit.id },
            data: { name: unitName || existingUnit.name, building: building || existingUnit.building },
          })
        : await prisma.rentalUnit.create({
            data: {
              id: randomUUID(),
              orgId,
              projectId: projectId!,
              code: unitCode,
              name: unitName || null,
              building: building || null,
            },
          });
      if (willCreateUnit) newUnits++;

      // 2) upsert tenant
      const tenantData = {
        prefix: person.prefix ?? null,
        firstName: person.firstName ?? null,
        lastName: person.lastName ?? null,
        bizName: bizName ?? null,
        phones,
        idCardNo: idCardNo || null,
        birthDate,
        nationality: nationality || null,
        address: address || null,
        email: email || null,
        lineId: lineId || null,
      };
      const tenant = existingTenant
        ? await prisma.rentalTenant.update({ where: { id: existingTenant.id }, data: tenantData })
        : await prisma.rentalTenant.create({
            data: { id: randomUUID(), orgId, ...tenantData },
          });

      if (isNewTenant) countNew++;
      else countUpdated++;

      // 3) create contract if a start date is present and no active contract on the unit.
      //    กันกดซ้ำ / เปิด 2 แท็บ พร้อมกัน แล้วได้ 2 สัญญาในห้องเดียว:
      //    ใช้ advisory lock ต่อห้อง (pg_advisory_xact_lock) ครอบ "เช็ค active → สร้างสัญญา"
      //    ให้เป็น atomic — ถ้าอีก request กำลังสร้างห้องเดียวกันจะรอจน lock ปล่อย แล้วเห็น active=1 จึงข้าม
      //    (auto-release ตอน transaction จบ ไม่ต้องมี migration / unique constraint)
      if (startDate) {
        const created = await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rentspace:contract:${unit.id}`}))`;
          const active = await tx.rentalContract.count({
            where: { unitId: unit.id, status: { in: ["active", "expiring"] } },
          });
          if (active > 0) return false;
          await tx.rentalContract.create({
            data: {
              id: randomUUID(),
              orgId,
              projectId: projectId!,
              unitId: unit.id,
              tenantId: tenant.id,
              contractNo: await nextContractNo(),
              startDate,
              endDate,
              rentAmountThb: toNum(unit.baseRentThb),
              status: "active",
              createdBy: session.user.id,
            },
          });
          await tx.rentalUnit.update({ where: { id: unit.id }, data: { status: "occupied" } });
          return true;
        });
        if (created) newContracts++;
      }

      diffs.push({ row: rowNo, unitCode, status, tenant: tenantLabel, errors: [] });
    } catch (e) {
      countError++;
      diffs.push({
        row: rowNo,
        unitCode,
        status: "error",
        tenant: tenantLabel,
        errors: [e instanceof Error ? e.message : "บันทึกแถวนี้ไม่สำเร็จ"],
      });
    }
  }

  const counts = {
    total: rows.length,
    new: countNew,
    updated: countUpdated,
    error: countError,
    newUnits,
    newContracts,
  };

  if (commit) {
    await audit({
      orgId,
      userId: session.user.id,
      action: "RENTSPACE_TENANTS_IMPORTED",
      resourceType: "rental_project",
      resourceId: projectId ?? undefined,
      diff: { new: { count: countNew + countUpdated, ...counts } },
    });
  }

  return NextResponse.json({ ok: true, counts, diffs });
}
