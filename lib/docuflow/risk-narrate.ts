// DocuFlow — Org-wide Risk Narration (Item 2 / spec §7 part 2)
// ────────────────────────────────────────────────────────────────────
// Feeds a `OrgRiskSummary` (from risk-aggregate.ts) into Claude Haiku
// 4.5 to produce a 3-bullet executive narrative, business-impact phrase
// per bullet, and a per-bullet recommendation.
//
// Cache: AiSearchCache table — keyed on synthetic queryHash
//   `__org_risk_${YYYYMMDD}__` (one row per org per day). 24h TTL.
//
// Cost guard:
//   - Empty summary short-circuits with hardcoded "ปลอดภัย" output, no
//     Claude call.
//   - The Claude payload is bounded by ITEMS_PER_CATEGORY_CAP from
//     risk-aggregate.ts (≤ 8 items × ≤ 12 categories × 3 buckets).
//   - max_tokens: 1024 — output is small.
// ────────────────────────────────────────────────────────────────────

import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import type { OrgRiskSummary } from "./risk-aggregate";

/* ============================================================
   Types
   ============================================================ */

export interface NarratedRisk {
  rank: number;
  /** Short Thai title (one phrase, ≤ 60 chars) */
  title: string;
  /** How many items are in this risk grouping */
  count: number;
  /** Window — e.g. "ภายใน 30 วัน" */
  daysWindow: string;
  /** Business consequence in plain Thai (≤ 120 chars) */
  businessImpact: string;
  /** Concrete next action — verb-led (≤ 100 chars) */
  recommendation: string;
}

export interface OrgRiskNarrative {
  /** Top 1-3 risks ranked by urgency × count */
  topRisks: NarratedRisk[];
  /** One-sentence executive tone — "ปลอดภัย", "ต้องจัดการ X เรื่องด่วน", ฯลฯ */
  overallTone: string;
  /** Org name as supplied to narrate (for display only) */
  orgName: string;
  /** Snapshot timestamp from the input summary */
  computedAt: string;
  modelUsed: string | null;
  tokensUsed: number | null;
  fromCache: boolean;
}

/* ============================================================
   Constants
   ============================================================ */

const MODEL = "claude-haiku-4-5-20251001";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const CACHE_QUERY_PREFIX = "__org_risk__"; // distinguishes from search hashes

/* ============================================================
   Public: narrateOrgRisk
   ============================================================ */

export async function narrateOrgRisk(
  summary: OrgRiskSummary,
  orgName: string,
  opts: { force?: boolean } = {},
): Promise<OrgRiskNarrative> {
  // 0. Empty-org short circuit — never call Claude when there's nothing to say
  if (summary.totals.grandTotal === 0) {
    return {
      topRisks: [],
      overallTone:
        "ปลอดภัย — ไม่มีเอกสารใกล้หมดอายุภายใน 90 วัน · เยี่ยมมาก!",
      orgName,
      computedAt: summary.computedAt,
      modelUsed: null,
      tokensUsed: null,
      fromCache: false,
    };
  }

  // 1. Cache check — daily key per org. Key uses today's UTC date.
  const cacheKey = buildCacheKey(summary.computedAt);
  if (!opts.force) {
    const cached = await readCache(summary.orgId, cacheKey);
    if (cached) {
      return {
        ...cached,
        orgName,
        computedAt: summary.computedAt,
        fromCache: true,
      };
    }
  }

  // 2. Compose the user payload — small, tabular, easy for Claude to read
  const payload = stringifyPayloadForClaude(summary, orgName);

  // 3. Call Claude
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return fallbackNarrative(
      summary,
      orgName,
      "AI ยังไม่ได้ตั้งค่า — แสดงสรุปจากข้อมูลตรงๆ",
    );
  }

  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey });

  let raw = "";
  let tokensUsed: number | null = null;
  try {
    const result = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: payload }],
    });
    raw = result.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("\n")
      .trim();
    tokensUsed =
      (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0) ||
      null;
  } catch (err) {
    console.error("[risk-narrate] claude call failed", err);
    return fallbackNarrative(summary, orgName, "AI ตอบไม่ได้ในขณะนี้");
  }

  const parsed = safeParseJson(raw);
  const narrative: OrgRiskNarrative = {
    topRisks: normaliseRisks(parsed.topRisks),
    overallTone:
      typeof parsed.overallTone === "string" && parsed.overallTone.trim()
        ? parsed.overallTone.trim()
        : buildFallbackTone(summary),
    orgName,
    computedAt: summary.computedAt,
    modelUsed: MODEL,
    tokensUsed,
    fromCache: false,
  };

  // 4. Persist cache (best-effort; failures should not break the response)
  await writeCache(summary.orgId, cacheKey, narrative);

  return narrative;
}

/* ============================================================
   Cache I/O — uses AiSearchCache with a synthetic queryHash
   ============================================================ */

function buildCacheKey(isoTimestamp: string): string {
  const ymd = isoTimestamp.slice(0, 10).replace(/-/g, ""); // YYYYMMDD
  return `${CACHE_QUERY_PREFIX}${ymd}`;
}

function hashKey(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

async function readCache(
  orgId: string,
  cacheKey: string,
): Promise<OrgRiskNarrative | null> {
  const queryHash = hashKey(cacheKey);
  try {
    const row = await prisma.aiSearchCache.findUnique({
      where: { orgId_queryHash: { orgId, queryHash } },
    });
    if (!row) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;
    return row.resultJson as unknown as OrgRiskNarrative;
  } catch (err) {
    console.error("[risk-narrate] cache read failed", err);
    return null;
  }
}

async function writeCache(
  orgId: string,
  cacheKey: string,
  narrative: OrgRiskNarrative,
): Promise<void> {
  const queryHash = hashKey(cacheKey);
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
  try {
    await prisma.aiSearchCache.upsert({
      where: { orgId_queryHash: { orgId, queryHash } },
      create: {
        orgId,
        queryHash,
        query: cacheKey,
        resultJson: narrative as unknown as object,
        expiresAt,
      },
      update: {
        query: cacheKey,
        resultJson: narrative as unknown as object,
        expiresAt,
        hitCount: 0,
      },
    });
  } catch (err) {
    console.error("[risk-narrate] cache write failed", err);
  }
}

/* ============================================================
   Claude prompt + payload builder
   ============================================================ */

const SYSTEM_PROMPT = `คุณคือผู้ช่วยผู้บริหาร Pooilgroup — บริษัทน้ำมัน + แก๊สที่มี 30+ สาขา 5 บริษัทในเครือ

หน้าที่: รับ snapshot ความเสี่ยงเอกสารระดับองค์กร (เอกสารทั่วไป + รถ + พนักงาน) แล้วสรุปเป็น "Top 3 ความเสี่ยงที่ต้องจัดการก่อน" ให้ผู้บริหารอ่าน 30 วินาทีเข้าใจ + ตัดสินใจได้

กฎการตอบ:
1. ตอบเป็น JSON เท่านั้น (ไม่มี text นอก JSON · ไม่ใช้ markdown code fence)
2. เลือก top 1-3 ความเสี่ยง — เลือกจาก critical bucket ก่อน ถ้ายังไม่ครบจาก urgent
3. แต่ละ risk ต้องมี: rank, title, count, daysWindow, businessImpact, recommendation
4. title สั้น กระชับ ภาษาคน (ไม่ใช่ jargon) — เช่น "รถบรรทุกแก๊ส 12 คัน ทะเบียนจะหมด"
5. daysWindow: "ภายใน 30 วัน" / "ภายใน 60 วัน" / "หมดแล้ว" ตามข้อมูลจริง
6. businessImpact: ใช้ businessImpact phrase ที่ส่งมาเป็น base — สรุปให้กระชับ ภาษาคน
7. recommendation: เป็น action ที่ทำได้จริง verb นำหน้า — เช่น "จัดคิวต่อทะเบียน 12 คันก่อนสิ้นเดือน" หรือ "ติดต่อขนส่งจังหวัดต่อใบอนุญาตโรงบรรจุ KKN"
8. overallTone: 1 ประโยค — สรุปสภาพรวม
   - ถ้ามี critical → "ต้องจัดการ X เรื่องด่วนใน 30 วัน"
   - ถ้ามีแต่ urgent/watch → "ยังไม่วิกฤต แต่ควรเริ่มเตรียม"
   - ถ้าว่างเปล่า → "ปลอดภัย"
9. ห้ามแต่งตัวเลขที่ไม่ได้อยู่ใน input — ใช้ count จาก data เท่านั้น

JSON schema ที่ต้องคืน:
{
  "topRisks": [
    {
      "rank": 1,
      "title": "string (≤ 60 ตัวอักษร)",
      "count": number,
      "daysWindow": "string เช่น 'ภายใน 30 วัน'",
      "businessImpact": "string (≤ 120 ตัวอักษร)",
      "recommendation": "string (≤ 100 ตัวอักษร verb-led)"
    }
  ],
  "overallTone": "string 1 ประโยคสรุป"
}`;

function stringifyPayloadForClaude(
  s: OrgRiskSummary,
  orgName: string,
): string {
  const lines: string[] = [];
  lines.push(`องค์กร: ${orgName}`);
  lines.push(`Snapshot: ${s.computedAt}`);
  lines.push("");
  lines.push("ยอดรวมตามความเร่งด่วน:");
  lines.push(`- หมดอายุแล้ว: ${s.totals.expired}`);
  lines.push(`- ≤ 7 วัน (วิกฤต): ${s.totals.critical}`);
  lines.push(`- ≤ 30 วัน (เร่งด่วน): ${s.totals.urgent}`);
  lines.push(`- 31-90 วัน (เฝ้าระวัง): ${s.totals.watch}`);
  lines.push("");

  function writeBucket(label: string, groups: typeof s.critical) {
    if (groups.length === 0) return;
    lines.push(`=== ${label} ===`);
    for (const g of groups) {
      lines.push(`หมวด: ${g.categoryLabel} (${g.count} รายการ)`);
      lines.push(`  ผลกระทบหลัก: ${g.businessImpact}`);
      const sample = g.items.slice(0, 5);
      for (const it of sample) {
        const days = it.daysUntilExpiry;
        const dayLabel =
          days === null
            ? "—"
            : days < 0
              ? `หมดแล้ว ${Math.abs(days)} วัน`
              : days === 0
                ? "หมดวันนี้"
                : `เหลือ ${days} วัน`;
        const sub = it.subLabel ? ` · ${it.subLabel}` : "";
        lines.push(`  - ${it.label}${sub} · ${dayLabel}`);
      }
      if (g.count > sample.length) {
        lines.push(`  ... และอีก ${g.count - sample.length} รายการ`);
      }
    }
    lines.push("");
  }

  writeBucket("CRITICAL (≤ 30 วัน · รวมหมดแล้ว)", s.critical);
  writeBucket("URGENT (31-60 วัน)", s.urgent);
  writeBucket("WATCH (61-90 วัน)", s.watch);

  lines.push(
    "ส่งกลับ JSON ตาม schema เท่านั้น — top 1-3 risks + overallTone",
  );
  return lines.join("\n");
}

/* ============================================================
   Parsing + normalisation
   ============================================================ */

function safeParseJson(raw: string): Record<string, unknown> {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
  }
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    cleaned = cleaned.slice(first, last + 1);
  }
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normaliseRisks(value: unknown): NarratedRisk[] {
  if (!Array.isArray(value)) return [];
  const out: NarratedRisk[] = [];
  for (let i = 0; i < value.length && out.length < 3; i++) {
    const v = value[i];
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    const title = typeof r.title === "string" ? r.title.trim() : "";
    if (!title) continue;
    out.push({
      rank: typeof r.rank === "number" ? r.rank : out.length + 1,
      title: title.slice(0, 80),
      count:
        typeof r.count === "number" && Number.isFinite(r.count)
          ? Math.max(0, Math.floor(r.count))
          : 0,
      daysWindow:
        typeof r.daysWindow === "string" && r.daysWindow.trim()
          ? r.daysWindow.trim().slice(0, 40)
          : "ไม่ระบุ",
      businessImpact:
        typeof r.businessImpact === "string" && r.businessImpact.trim()
          ? r.businessImpact.trim().slice(0, 200)
          : "—",
      recommendation:
        typeof r.recommendation === "string" && r.recommendation.trim()
          ? r.recommendation.trim().slice(0, 160)
          : "—",
    });
  }
  return out;
}

/* ============================================================
   Fallbacks (when Claude unavailable / empty)
   ============================================================ */

function fallbackNarrative(
  s: OrgRiskSummary,
  orgName: string,
  noteOverride?: string,
): OrgRiskNarrative {
  // Build 1-3 simple risks straight from the data without Claude.
  const candidates = [
    ...s.critical.map((g) => ({ g, window: "ภายใน 30 วัน", priority: 0 })),
    ...s.urgent.map((g) => ({ g, window: "ภายใน 60 วัน", priority: 1 })),
    ...s.watch.map((g) => ({ g, window: "ภายใน 90 วัน", priority: 2 })),
  ];
  candidates.sort(
    (a, b) => a.priority - b.priority || b.g.count - a.g.count,
  );
  const top = candidates.slice(0, 3).map((c, i) => ({
    rank: i + 1,
    title: `${c.g.categoryLabel} ${c.g.count} รายการ ${c.window}`,
    count: c.g.count,
    daysWindow: c.window,
    businessImpact: c.g.businessImpact,
    recommendation: `เปิดดูรายการในหมวด ${c.g.categoryLabel} แล้วจัดคิวดำเนินการ`,
  }));

  return {
    topRisks: top,
    overallTone: noteOverride ?? buildFallbackTone(s),
    orgName,
    computedAt: s.computedAt,
    modelUsed: null,
    tokensUsed: null,
    fromCache: false,
  };
}

function buildFallbackTone(s: OrgRiskSummary): string {
  const c = s.totals.expired + s.totals.critical + s.totals.urgent;
  if (s.totals.grandTotal === 0) return "ปลอดภัย — ไม่มีเอกสารใกล้หมดอายุ";
  if (c > 0) return `ต้องจัดการ ${c} เรื่องด่วนภายใน 30 วัน`;
  return "ยังไม่วิกฤต แต่ควรเริ่มเตรียมเอกสารใน 90 วันข้างหน้า";
}
