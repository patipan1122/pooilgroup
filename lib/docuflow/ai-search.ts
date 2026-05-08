// AI Search ("ภาษาคน") · Capability G — DocuFlow
// ────────────────────────────────────────────────────────────────────
// Tool-use / function-calling entry point. Claude Haiku reads the user's
// natural-language question, picks the right tool(s) (DB query shapes),
// our code runs them via canonical loaders, then Claude summarises in Thai.
//
// Hard rules:
//   - Multi-tenant: every tool function takes orgId, returns org-scoped only.
//   - Single source: tools call canonical loaders (loadDocuments, loadRenewals,
//     loadVehicles, loadVehicleDocuments) — NEVER prisma directly except for
//     person_documents (no canonical loader yet).
//   - Cache: SHA-256(normalized query) → AiSearchCache · TTL 1h.
//   - Cost guard: each tool clamps results to ≤ 50 rows.
//   - Model: claude-haiku-4-5-20251001 (cheap + fast for search).
// ────────────────────────────────────────────────────────────────────

import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import {
  loadDocuments,
  loadRenewals,
  type CanonicalDocument,
} from "@/lib/docuflow/data";
import {
  loadVehicles,
  loadVehicleDocuments,
  VEHICLE_DOC_TYPES,
} from "@/lib/vehicles/data";
import { BUSINESS_TYPES } from "@/constants/business-types";
import {
  getExpiryStatus,
  daysUntilExpiry,
  type ExpiryStatus,
} from "@/lib/docuflow/expiry";
import {
  getCanonicalDocsForBizType,
  type CanonicalDocSpec,
} from "@/lib/docuflow/canonical-docs";

/* ============================================================
   PUBLIC TYPES
   ============================================================ */

export type Citation =
  | { type: "document"; id: string; label: string }
  | { type: "vehicle"; id: string; label: string }
  | { type: "person"; id: string; label: string }
  | { type: "branch"; id: string; label: string };

export interface AiSearchResult {
  answer: string;
  citations: Citation[];
  cached: boolean;
  /** How many tool-call rounds Claude needed (debug) */
  toolRounds?: number;
  /** Total result rows fed back to Claude (for audit) */
  resultCount: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_TOOL_ROUNDS = 4; // hard cap to avoid runaway loops
const MAX_RESULTS_PER_TOOL = 50;
const MODEL = "claude-haiku-4-5-20251001";

/* ============================================================
   TOOL DEFINITIONS — sent to Claude
   ============================================================ */

export const AI_SEARCH_TOOLS: Anthropic.Tool[] = [
  {
    name: "searchDocuments",
    description:
      "ค้นหาเอกสารทั่วไป (ใบอนุญาต/ใบรับรอง/สัญญา) ตาม ระดับ (group/company/business_type/branch/person), tag, ประเภทธุรกิจ, สาขา, หรือ free-text. ใช้ตอบคำถามเช่น 'ใบอนุญาตของสาขา KKN', 'เอกสาร tag วัตถุอันตราย', 'ใบ ขส. ของปั๊มน้ำมัน'.",
    input_schema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description: "free-text ค้นในชื่อ + คำอธิบาย (case-insensitive)",
        },
        level: {
          type: "string",
          enum: ["group", "company", "business_type", "branch", "person"],
          description: "ระดับ ownership (group/company/business_type/branch/person)",
        },
        businessType: {
          type: "string",
          description:
            "ประเภทธุรกิจ เช่น fuel_station, lpg_station, bottling_plant, hotel, convenience_store, ev_station, cafe, cafe_punthai, lpg_retail, massage_chair, claw_machine, training_center",
        },
        branchCode: {
          type: "string",
          description:
            "รหัสสาขา เช่น KKN, BKK01 (regex contains, case-insensitive). ใช้แทน branchId เมื่อรู้แค่รหัส",
        },
        tag: {
          type: "string",
          description: "ค้นโดย tag เช่น 'ต่ออายุทุกปี' หรือ 'วัตถุอันตราย'",
        },
        expiryStatus: {
          type: "string",
          enum: ["expired", "critical", "urgent", "watch", "normal"],
          description:
            "สถานะวันหมดอายุ — expired=หมดแล้ว · critical=≤7วัน · urgent=≤30วัน · watch=≤90วัน · normal=>90วัน",
        },
      },
    },
  },
  {
    name: "searchVehicleDocs",
    description:
      "ค้นหาเอกสารของรถ — ทะเบียน, พ.ร.บ., ตรวจสภาพ, ใบรับรองถัง. ระบุทะเบียนรถ (เช่น 'กข-1234'), หรือสถานะหมดอายุ. ใช้ตอบ 'รถคันไหนทะเบียนหมดเดือนนี้', 'รถบรรทุกน้ำมันคันไหน พ.ร.บ. ใกล้หมด'.",
    input_schema: {
      type: "object",
      properties: {
        licensePlate: {
          type: "string",
          description: "substring match บนทะเบียนรถ (case-insensitive)",
        },
        vehicleType: {
          type: "string",
          enum: ["fuel_truck", "gas_truck", "service", "personal", "other"],
          description: "ประเภทรถ",
        },
        docType: {
          type: "string",
          enum: [
            "registration",
            "insurance_compulsory",
            "insurance_voluntary",
            "inspection",
            "tank_cert",
          ],
          description:
            "ประเภทเอกสาร — registration=ทะเบียน · insurance_compulsory=พ.ร.บ. · inspection=ตรวจสภาพ · tank_cert=รับรองถัง",
        },
        expiryStatus: {
          type: "string",
          enum: ["expired", "critical", "urgent", "watch", "normal"],
          description:
            "สถานะหมดอายุ — expired=หมดแล้ว · critical=≤7วัน · urgent=≤30วัน · watch=≤90วัน · normal=>90วัน",
        },
      },
    },
  },
  {
    name: "searchPersonDocs",
    description:
      "ค้นหาเอกสารของคนขับ/พนักงาน — ใบขับขี่, ใบรับรองอบรม, ใบรับรองสุขภาพ, บัตรประชาชน. ใช้ตอบ 'ใบขับขี่คนขับที่หมดแล้วมีใครบ้าง'.",
    input_schema: {
      type: "object",
      properties: {
        docType: {
          type: "string",
          enum: ["license", "training", "health", "id_card"],
          description:
            "ประเภทเอกสารบุคคล — license=ใบขับขี่ · training=ใบรับรองอบรม · health=ใบรับรองแพทย์ · id_card=บัตรประชาชน",
        },
        expiryStatus: {
          type: "string",
          enum: ["expired", "critical", "urgent", "watch"],
          description: "สถานะหมดอายุ (ไม่รวม normal เพราะส่วนใหญ่ถามเพื่อแจ้งเตือน)",
        },
        userNameSearch: {
          type: "string",
          description: "ค้นชื่อพนักงาน (case-insensitive substring)",
        },
      },
    },
  },
  {
    name: "searchExpiringDocs",
    description:
      "หาเอกสารทั้งหมด (ทั่วไป + รถ + บุคคล) ที่จะหมดอายุภายใน N วัน. ใช้ตอบ 'อะไรหมดเดือนนี้', 'ใบอนุญาตที่ใกล้หมด 30 วัน'.",
    input_schema: {
      type: "object",
      properties: {
        withinDays: {
          type: "number",
          description: "หาเอกสารที่จะหมดใน N วัน (1-365)",
        },
        docKind: {
          type: "string",
          enum: ["all", "general", "vehicle", "person"],
          description:
            "ประเภทเอกสาร — all=ทั้งหมด · general=เอกสารทั่วไป · vehicle=รถ · person=บุคคล",
        },
      },
      required: ["withinDays"],
    },
  },
  {
    name: "getBusinessTypeDocsList",
    description:
      "ตอบทั้งเอกสารที่ org อัปโหลดแล้ว และเอกสารที่กฎหมายกำหนดให้ต้องมี — ใช้เมื่อผู้ใช้ถาม 'ต้องมีใบอนุญาตอะไรบ้าง' หรือ 'มีเอกสารอะไรบ้าง'. คืน 3 ชุด: uploaded (ที่อัปโหลดแล้ว) · canonical (กฎหมายกำหนด) · missing (ยังไม่มี). ตอบได้แม้ org ยังไม่ได้อัปโหลดเอกสารใดๆ.",
    input_schema: {
      type: "object",
      properties: {
        businessType: {
          type: "string",
          description:
            "ประเภทธุรกิจ เช่น fuel_station, lpg_station, bottling_plant, hotel, convenience_store, ev_station, cafe, cafe_punthai, lpg_retail, training_center, massage_chair, claw_machine, transport, gas_fleet",
        },
      },
      required: ["businessType"],
    },
  },
];

/* ============================================================
   TOOL EXECUTORS — run against canonical loaders
   ============================================================ */

interface ExecuteResult {
  /** Plain summary fed back to Claude as tool_result content */
  summary: string;
  /** Citations to surface in the API response */
  citations: Citation[];
  /** Total rows considered (post-clamp) */
  rowCount: number;
}

async function execSearchDocuments(
  orgId: string,
  input: Record<string, unknown>,
): Promise<ExecuteResult> {
  // Resolve branchCode → branchId (single-source via Prisma branches table)
  let branchId: string | undefined;
  if (typeof input.branchCode === "string" && input.branchCode.trim()) {
    const code = input.branchCode.trim();
    const b = await prisma.branch.findFirst({
      where: {
        orgId,
        OR: [
          { code: { equals: code, mode: "insensitive" } },
          { code: { contains: code, mode: "insensitive" } },
          { name: { contains: code, mode: "insensitive" } },
        ],
        isActive: true,
      },
      select: { id: true, code: true, name: true },
    });
    if (b) branchId = b.id;
  }

  const docs = await loadDocuments(orgId, {
    search: typeof input.search === "string" ? input.search : undefined,
    level: typeof input.level === "string" ? input.level : undefined,
    businessType:
      typeof input.businessType === "string" ? input.businessType : undefined,
    branchId,
    tag: typeof input.tag === "string" ? input.tag : undefined,
    expiryStatus:
      typeof input.expiryStatus === "string"
        ? (input.expiryStatus as
            | "expired"
            | "critical"
            | "urgent"
            | "watch"
            | "normal")
        : undefined,
    limit: MAX_RESULTS_PER_TOOL,
  });

  return summarizeDocs(docs);
}

async function execSearchVehicleDocs(
  orgId: string,
  input: Record<string, unknown>,
): Promise<ExecuteResult> {
  // Filter vehicles first (license plate / type), then their documents
  const vehicles = await loadVehicles(orgId, {
    licensePlateSearch:
      typeof input.licensePlate === "string" ? input.licensePlate : undefined,
    vehicleType:
      typeof input.vehicleType === "string" ? input.vehicleType : undefined,
  });

  if (vehicles.length === 0) {
    return { summary: "ไม่พบรถตามเงื่อนไข", citations: [], rowCount: 0 };
  }

  const vehicleIds = vehicles.slice(0, MAX_RESULTS_PER_TOOL).map((v) => v.id);

  // The vehicle loader still uses its older internal expiry type (uses "ok"
  // for >90d). The canonical (user-facing) status is "normal" — map across
  // the boundary so the tool stays consistent with /docuflow/expiry while
  // we wait for a separate harmonization pass on lib/vehicles/data.ts.
  const expiryFilter =
    typeof input.expiryStatus === "string"
      ? (input.expiryStatus === "normal"
          ? "ok"
          : (input.expiryStatus as
              | "expired"
              | "critical"
              | "urgent"
              | "watch"))
      : undefined;

  const vDocs = await loadVehicleDocuments(orgId, {
    vehicleIds,
    docType: typeof input.docType === "string" ? input.docType : undefined,
    expiryStatus: expiryFilter,
  });

  const clamped = vDocs.slice(0, MAX_RESULTS_PER_TOOL);
  const vById = new Map(vehicles.map((v) => [v.id, v]));

  if (clamped.length === 0) {
    return {
      summary: `พบรถ ${vehicles.length} คัน แต่ไม่พบเอกสารตามเงื่อนไข`,
      citations: vehicles.slice(0, 10).map((v) => ({
        type: "vehicle" as const,
        id: v.id,
        label: v.license_plate,
      })),
      rowCount: 0,
    };
  }

  const lines = clamped.map((d) => {
    const v = vById.get(d.vehicle_id);
    const plate = v?.license_plate ?? "?";
    const typeLabel =
      VEHICLE_DOC_TYPES[d.doc_type]?.short ?? d.doc_type;
    const exp = d.expiry_date ?? "—";
    const status = d.expiry_status;
    const days = d.days_to_expiry !== null ? `${d.days_to_expiry}วัน` : "ไม่กำหนด";
    return `- ${plate} · ${typeLabel} · หมดอายุ ${exp} (${status}/${days}) [vehicle:${d.vehicle_id}]`;
  });

  const citations: Citation[] = [];
  const seenV = new Set<string>();
  for (const d of clamped) {
    if (!seenV.has(d.vehicle_id)) {
      seenV.add(d.vehicle_id);
      const v = vById.get(d.vehicle_id);
      citations.push({
        type: "vehicle",
        id: d.vehicle_id,
        label: v?.license_plate ?? d.vehicle_id,
      });
    }
  }

  return {
    summary: `พบเอกสารรถ ${clamped.length} รายการ:\n${lines.join("\n")}`,
    citations,
    rowCount: clamped.length,
  };
}

async function execSearchPersonDocs(
  orgId: string,
  input: Record<string, unknown>,
): Promise<ExecuteResult> {
  const docType =
    typeof input.docType === "string" ? input.docType : undefined;
  const userNameSearch =
    typeof input.userNameSearch === "string"
      ? input.userNameSearch.trim()
      : undefined;
  const expiryStatusFilter =
    typeof input.expiryStatus === "string" ? input.expiryStatus : undefined;

  // No canonical loader for person_documents yet. Direct prisma is acceptable
  // here per docuflow data layer convention — we still respect orgId scope.
  const rows = await prisma.personDocument.findMany({
    where: {
      orgId,
      ...(docType ? { docType } : {}),
      ...(userNameSearch
        ? { user: { name: { contains: userNameSearch, mode: "insensitive" } } }
        : {}),
      document: { isActive: true },
    },
    include: {
      user: { select: { id: true, name: true, role: true } },
      document: { select: { id: true, name: true } },
    },
    orderBy: [{ expiryDate: "asc" }],
    take: MAX_RESULTS_PER_TOOL,
  });

  // Use the canonical expiry helpers so bucket boundaries stay consistent
  // with /docuflow/expiry, telegram alerts, and the rest of the system.
  const enriched = rows.map((r) => {
    let status: ExpiryStatus | "no_expiry" = "no_expiry";
    let days: number | null = null;
    if (r.expiryDate) {
      status = getExpiryStatus(r.expiryDate);
      days = daysUntilExpiry(r.expiryDate);
    }
    return { row: r, status, days };
  });

  const filtered = expiryStatusFilter
    ? enriched.filter((e) => e.status === expiryStatusFilter)
    : enriched;

  if (filtered.length === 0) {
    return {
      summary: "ไม่พบเอกสารบุคคลตามเงื่อนไข",
      citations: [],
      rowCount: 0,
    };
  }

  const docTypeLabel: Record<string, string> = {
    license: "ใบขับขี่",
    training: "อบรม",
    health: "ใบรับรองแพทย์",
    id_card: "บัตรประชาชน",
  };

  const lines = filtered.map((e) => {
    const r = e.row;
    const exp = r.expiryDate
      ? r.expiryDate.toISOString().slice(0, 10)
      : "ไม่กำหนด";
    const dLabel = e.days !== null ? `${e.days}วัน` : "—";
    const tLabel = docTypeLabel[r.docType] ?? r.docType;
    return `- ${r.user.name} (${r.user.role}) · ${tLabel} · หมดอายุ ${exp} (${e.status}/${dLabel}) [person:${r.userId}]`;
  });

  const citations: Citation[] = [];
  const seenU = new Set<string>();
  for (const e of filtered) {
    if (!seenU.has(e.row.userId)) {
      seenU.add(e.row.userId);
      citations.push({
        type: "person",
        id: e.row.userId,
        label: e.row.user.name,
      });
    }
  }

  return {
    summary: `พบเอกสารบุคคล ${filtered.length} รายการ:\n${lines.join("\n")}`,
    citations,
    rowCount: filtered.length,
  };
}

async function execSearchExpiringDocs(
  orgId: string,
  input: Record<string, unknown>,
): Promise<ExecuteResult> {
  const within =
    typeof input.withinDays === "number" && input.withinDays > 0
      ? Math.min(Math.max(Math.floor(input.withinDays), 1), 365)
      : 30;
  const kind =
    typeof input.docKind === "string" ? input.docKind : "all";

  const sections: string[] = [];
  const allCitations: Citation[] = [];
  let total = 0;

  if (kind === "all" || kind === "general") {
    const renewals = await loadRenewals(orgId, { withinDays: within });
    const clamped = renewals.slice(0, MAX_RESULTS_PER_TOOL);
    if (clamped.length > 0) {
      const lines = clamped.map(
        (r) =>
          `- ${r.document.name} · หมดอายุ ${r.expiryDate.toISOString().slice(0, 10)} (${r.expiryStatus}/${r.daysUntilExpiry}วัน) [document:${r.documentId}]`,
      );
      sections.push(`เอกสารทั่วไป (${clamped.length}):\n${lines.join("\n")}`);
      total += clamped.length;
      for (const r of clamped) {
        allCitations.push({
          type: "document",
          id: r.documentId,
          label: r.document.name,
        });
      }
    }
  }

  if (kind === "all" || kind === "vehicle") {
    const vDocs = await loadVehicleDocuments(orgId, {
      expiryStatus: ["expired", "critical", "urgent", "watch"],
    });
    const filtered = vDocs.filter(
      (d) =>
        d.days_to_expiry !== null &&
        d.days_to_expiry <= within,
    );
    const clamped = filtered.slice(0, MAX_RESULTS_PER_TOOL);
    if (clamped.length > 0) {
      const vehicleIds = Array.from(new Set(clamped.map((d) => d.vehicle_id)));
      const vehicles = await loadVehicles(orgId, { ids: vehicleIds });
      const vMap = new Map(vehicles.map((v) => [v.id, v]));
      const lines = clamped.map((d) => {
        const v = vMap.get(d.vehicle_id);
        const plate = v?.license_plate ?? "?";
        const typeLabel =
          VEHICLE_DOC_TYPES[d.doc_type]?.short ?? d.doc_type;
        return `- ${plate} · ${typeLabel} · หมด ${d.expiry_date} (${d.expiry_status}/${d.days_to_expiry}วัน) [vehicle:${d.vehicle_id}]`;
      });
      sections.push(`เอกสารรถ (${clamped.length}):\n${lines.join("\n")}`);
      total += clamped.length;
      for (const d of clamped) {
        const v = vMap.get(d.vehicle_id);
        allCitations.push({
          type: "vehicle",
          id: d.vehicle_id,
          label: v?.license_plate ?? d.vehicle_id,
        });
      }
    }
  }

  if (kind === "all" || kind === "person") {
    const horizon = new Date();
    horizon.setHours(0, 0, 0, 0);
    horizon.setDate(horizon.getDate() + within);

    const rows = await prisma.personDocument.findMany({
      where: {
        orgId,
        expiryDate: { lte: horizon, not: null },
        document: { isActive: true },
      },
      include: {
        user: { select: { id: true, name: true, role: true } },
      },
      orderBy: [{ expiryDate: "asc" }],
      take: MAX_RESULTS_PER_TOOL,
    });

    const docTypeLabel: Record<string, string> = {
      license: "ใบขับขี่",
      training: "อบรม",
      health: "ใบรับรองแพทย์",
      id_card: "บัตรประชาชน",
    };

    if (rows.length > 0) {
      const lines = rows.map((r) => {
        // Use canonical helper so bucket boundaries match the rest of the
        // system (UTC calendar-day resolution, no TZ drift).
        const days = r.expiryDate ? daysUntilExpiry(r.expiryDate) : null;
        const exp = r.expiryDate
          ? r.expiryDate.toISOString().slice(0, 10)
          : "—";
        const tLabel = docTypeLabel[r.docType] ?? r.docType;
        return `- ${r.user.name} · ${tLabel} · หมด ${exp} (${days}วัน) [person:${r.userId}]`;
      });
      sections.push(`เอกสารบุคคล (${rows.length}):\n${lines.join("\n")}`);
      total += rows.length;
      const seen = new Set<string>();
      for (const r of rows) {
        if (!seen.has(r.userId)) {
          seen.add(r.userId);
          allCitations.push({
            type: "person",
            id: r.userId,
            label: r.user.name,
          });
        }
      }
    }
  }

  if (sections.length === 0) {
    return {
      summary: `ไม่พบเอกสารใกล้หมดใน ${within} วัน`,
      citations: [],
      rowCount: 0,
    };
  }

  return {
    summary: `ใกล้หมดอายุใน ${within} วัน (รวม ${total} รายการ):\n\n${sections.join("\n\n")}`,
    citations: allCitations,
    rowCount: total,
  };
}

async function execGetBusinessTypeDocsList(
  orgId: string,
  input: Record<string, unknown>,
): Promise<ExecuteResult> {
  const bt =
    typeof input.businessType === "string" ? input.businessType.trim() : "";
  if (!bt) {
    return {
      summary: "ต้องระบุประเภทธุรกิจ",
      citations: [],
      rowCount: 0,
    };
  }

  // 1) Canonical (spec) list — static, ไม่ขึ้นกับ orgId
  const canonical: CanonicalDocSpec[] = getCanonicalDocsForBizType(bt);

  // 2) Uploaded — ที่ org นี้อัปโหลดผูกกับ biztype แล้วจริงๆ
  const docs = await loadDocuments(orgId, {
    businessType: bt,
    limit: MAX_RESULTS_PER_TOOL,
  });

  // Group uploaded by name (distinct doc kinds)
  const uploadedByName = new Map<string, { count: number; tags: Set<string>; ids: string[] }>();
  for (const d of docs) {
    const slot =
      uploadedByName.get(d.name) ??
      { count: 0, tags: new Set<string>(), ids: [] };
    slot.count += 1;
    slot.ids.push(d.id);
    for (const t of d.tags) slot.tags.add(t);
    uploadedByName.set(d.name, slot);
  }

  const btLabel = BUSINESS_TYPES[bt]?.label ?? bt;

  // 3) Missing — canonical name ที่ไม่มีใน uploaded
  // Match แบบ fuzzy: canonical name ต้องเป็น substring ของ uploaded name หรือกลับกัน
  // (เผื่อชื่อเอกสารจริงในระบบเขียนยาวกว่า/สั้นกว่าชื่อมาตรฐาน)
  const uploadedNames = Array.from(uploadedByName.keys());
  const missing = canonical.filter((c) => {
    const cName = c.name.toLowerCase();
    return !uploadedNames.some((u) => {
      const uName = u.toLowerCase();
      return uName.includes(cName) || cName.includes(uName);
    });
  });

  // Build summary — show all 3 sections so Claude can compose the answer
  const sections: string[] = [];

  sections.push(
    `📋 เอกสารที่กฎหมายกำหนดให้ ${btLabel} ต้องมี (canonical · ${canonical.length} รายการ):`,
  );
  if (canonical.length === 0) {
    sections.push("(ไม่มีในฐานความรู้ — กรุณาตรวจ business type)");
  } else {
    for (const c of canonical) {
      const reg = c.regulator ? ` · ${c.regulator}` : "";
      sections.push(`- ${c.name} · ${c.frequency}${reg} · ${c.dangerLevel}`);
    }
  }

  sections.push(
    `\n✅ เอกสารที่อัปโหลดแล้ว (uploaded · ${uploadedByName.size} ชนิด · ${docs.length} ฉบับ):`,
  );
  if (uploadedByName.size === 0) {
    sections.push("(ยังไม่มีเอกสารใดๆ ใน DocuFlow)");
  } else {
    for (const [name, info] of uploadedByName.entries()) {
      const tagSuffix =
        info.tags.size > 0 ? ` · tag: ${Array.from(info.tags).join(", ")}` : "";
      sections.push(`- ${name} · ${info.count} ฉบับ${tagSuffix}`);
    }
  }

  sections.push(
    `\n❌ ยังขาด/ยังไม่มีอัปโหลด (missing · ${missing.length} รายการ):`,
  );
  if (missing.length === 0) {
    sections.push("(ครบทุกรายการตามที่กฎหมายกำหนด)");
  } else {
    for (const m of missing) {
      const reg = m.regulator ? ` · ${m.regulator}` : "";
      sections.push(`- ${m.name} · ${m.frequency}${reg} · ${m.dangerLevel}`);
    }
  }

  return {
    summary: sections.join("\n"),
    citations: docs.slice(0, 10).map((d) => ({
      type: "document" as const,
      id: d.id,
      label: d.name,
    })),
    rowCount: docs.length + canonical.length,
  };
}

/* ============================================================
   Helpers
   ============================================================ */

function summarizeDocs(docs: CanonicalDocument[]): ExecuteResult {
  if (docs.length === 0) {
    return { summary: "ไม่พบเอกสารตามเงื่อนไข", citations: [], rowCount: 0 };
  }
  const lines = docs.map((d) => {
    const exp = d.renewal
      ? `หมด ${d.renewal.expiryDate.toISOString().slice(0, 10)} (${d.renewal.expiryStatus}/${d.renewal.daysUntilExpiry}วัน)`
      : "ไม่มีวันหมดอายุ";
    const tags = d.tags.length > 0 ? ` · tag: ${d.tags.join(", ")}` : "";
    return `- ${d.name} · ${exp}${tags} [document:${d.id}]`;
  });
  return {
    summary: `พบเอกสาร ${docs.length} ฉบับ:\n${lines.join("\n")}`,
    citations: docs.slice(0, 10).map((d) => ({
      type: "document" as const,
      id: d.id,
      label: d.name,
    })),
    rowCount: docs.length,
  };
}

async function runTool(
  name: string,
  orgId: string,
  input: Record<string, unknown>,
): Promise<ExecuteResult> {
  switch (name) {
    case "searchDocuments":
      return execSearchDocuments(orgId, input);
    case "searchVehicleDocs":
      return execSearchVehicleDocs(orgId, input);
    case "searchPersonDocs":
      return execSearchPersonDocs(orgId, input);
    case "searchExpiringDocs":
      return execSearchExpiringDocs(orgId, input);
    case "getBusinessTypeDocsList":
      return execGetBusinessTypeDocsList(orgId, input);
    default:
      return {
        summary: `ไม่รู้จัก tool: ${name}`,
        citations: [],
        rowCount: 0,
      };
  }
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

function hashQuery(q: string): string {
  return crypto
    .createHash("sha256")
    .update(normalizeQuery(q), "utf8")
    .digest("hex");
}

/* ============================================================
   Cache layer (AiSearchCache · 1h TTL)
   ============================================================ */

async function readCache(
  orgId: string,
  hash: string,
): Promise<AiSearchResult | null> {
  const row = await prisma.aiSearchCache.findUnique({
    where: { orgId_queryHash: { orgId, queryHash: hash } },
  });
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;

  // Bump hit count (best-effort, fire-and-forget tolerant)
  await prisma.aiSearchCache
    .update({
      where: { id: row.id },
      data: { hitCount: { increment: 1 } },
    })
    .catch(() => {});

  const cached = row.resultJson as unknown as AiSearchResult;
  return { ...cached, cached: true };
}

async function writeCache(
  orgId: string,
  hash: string,
  query: string,
  result: AiSearchResult,
): Promise<void> {
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
  await prisma.aiSearchCache
    .upsert({
      where: { orgId_queryHash: { orgId, queryHash: hash } },
      create: {
        orgId,
        queryHash: hash,
        query,
        resultJson: result as unknown as object,
        expiresAt,
      },
      update: {
        query,
        resultJson: result as unknown as object,
        expiresAt,
        hitCount: 0,
      },
    })
    .catch((err) => {
      // Cache failure should not break the response — log + ignore
      console.error("[ai-search] cache write failed", err);
    });
}

/* ============================================================
   System prompt
   ============================================================ */

const SYSTEM_PROMPT = `คุณคือผู้ช่วยค้นหาเอกสารของ Pooilgroup DocuFlow — ระบบเอกสารของบริษัทน้ำมัน + แก๊สที่มี 30+ สาขา 11 ประเภทธุรกิจ

หน้าที่: ตอบคำถาม "ภาษาคน" ของผู้บริหาร โดยเรียก tools ที่จำเป็นเพื่อดึงข้อมูล แล้วสรุปเป็นภาษาไทย

กฎการตอบ:
1. เรียก tool ก่อนตอบเสมอ — ห้ามเดาตัวเลข/ชื่อเอกสาร/วันหมดอายุ
2. ถ้าผู้ใช้ถามแบบกว้างๆ (เช่น "อะไรหมดเดือนนี้") ให้เรียก searchExpiringDocs ด้วย withinDays=30
3. ถ้าระบุชื่อสาขา/รหัสสาขา ให้ใส่ branchCode ใน searchDocuments
4. ถ้าถาม "รถ" → searchVehicleDocs · ถาม "คนขับ/พนักงาน" → searchPersonDocs
5. ถ้าถาม "ปั๊มน้ำมันต้องมีเอกสารอะไรบ้าง" หรือ "โรงบรรจุก๊าซต้องมีใบอนุญาตอะไรบ้าง" → getBusinessTypeDocsList(businessType=...)
   tool คืน 3 ส่วน — canonical (กฎหมายกำหนด) · uploaded (อัปโหลดแล้ว) · missing (ขาด)
   ตอบให้ครบทั้ง 3 ส่วนตามรูปแบบนี้:
     "📋 [biztype] ต้องมี [N] เอกสารตามกฎหมาย: [ชื่อสั้นๆ 3-5 รายการแรก]..."
     "✅ อัปโหลดแล้ว [M] รายการ"
     "❌ ยังขาด [K] รายการ: [ชื่อสำคัญ — เน้น critical/high]"
   ถ้า uploaded = 0 (ยังไม่อัปโหลดอะไร) ให้บอกชัดเจนว่า "ยังไม่มีเอกสารใน DocuFlow แต่ตามกฎหมายต้องมี: ..."
6. ตอบเป็นภาษาไทย กระชับ 3-8 บรรทัด ใช้ตัวเลขจาก tool result เท่านั้น
7. อ้างอิงเอกสาร/รถ/บุคคลด้วย bracket reference [document:ID] / [vehicle:ID] / [person:ID] ที่มากับ tool result — ระบบจะ render เป็นลิงก์ให้
8. ถ้า tool ไม่พบข้อมูล ตอบตรงๆ ว่า "ไม่พบ..." — ห้ามแต่ง

ประเภทธุรกิจที่รู้จัก: fuel_station (ปั๊มน้ำมัน), lpg_station (ปั๊มแก๊ส), bottling_plant (โรงบรรจุก๊าซ), hotel (โรงแรม), convenience_store (7-Eleven), ev_station (EV), cafe (Café Amazon), cafe_punthai (พันธุ์ไทย), lpg_retail (ร้านค้าแก๊ส), massage_chair (เก้าอี้นวด), claw_machine (ตู้คีบตุ๊กตา), training_center (ศูนย์ฝึก)`;

/* ============================================================
   Main entry
   ============================================================ */

export async function runAiSearch(
  orgId: string,
  query: string,
): Promise<AiSearchResult> {
  const trimmed = query.trim();
  const hash = hashQuery(trimmed);

  // 1. Cache check
  const cached = await readCache(orgId, hash);
  if (cached) return cached;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      answer:
        "AI Search ยังไม่ได้ตั้งค่า — กรุณาตั้งค่า ANTHROPIC_API_KEY ใน .env.local",
      citations: [],
      cached: false,
      resultCount: 0,
    };
  }

  const client = new Anthropic({ apiKey });

  // 2. Tool-use conversation loop
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: trimmed },
  ];

  const allCitations: Citation[] = [];
  let totalRows = 0;
  let rounds = 0;
  let finalText = "";

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds += 1;
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: AI_SEARCH_TOOLS,
      messages,
    });

    // Append assistant turn (full content blocks) so subsequent tool_results
    // bind to the right tool_use ids.
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      finalText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      break;
    }

    // Run every tool_use block in this turn, then feed all tool_results back
    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const out = await runTool(
        tu.name,
        orgId,
        (tu.input ?? {}) as Record<string, unknown>,
      );
      totalRows += out.rowCount;
      allCitations.push(...out.citations);
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: out.summary,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  // Track whether we actually got a final assistant answer. If we hit the
  // tool-loop ceiling without one, we surface a fallback to the caller but
  // skip the cache write — otherwise a transient failure would be served
  // for the full 1h TTL on every retry.
  const exhaustedWithoutAnswer = rounds === MAX_TOOL_ROUNDS && !finalText;
  if (!finalText) {
    finalText =
      "ระบบใช้เวลาตอบนานเกินกำหนด ลองถามใหม่ด้วยข้อความที่ระบุเฉพาะเจาะจงขึ้น";
  }

  // De-dupe citations by (type+id)
  const seen = new Set<string>();
  const dedupedCitations = allCitations.filter((c) => {
    const k = `${c.type}:${c.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const result: AiSearchResult = {
    answer: finalText,
    citations: dedupedCitations,
    cached: false,
    toolRounds: rounds,
    resultCount: totalRows,
  };

  // 3. Persist cache (1h TTL) — ignore errors. Only cache successful answers
  //    (final assistant text without tool_use blocks). Failed/exhausted runs
  //    must be re-tried on the next request, not served from cache.
  if (!exhaustedWithoutAnswer) {
    await writeCache(orgId, hash, trimmed, result);
  }

  return result;
}
