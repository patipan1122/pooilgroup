// Seed demo data for ระบบแจ้งซ่อม (CEO request 2026-05-21)
// Idempotent: deletes existing DEMO-flagged tickets first then re-inserts fresh.
// All seeded tickets are tagged metadata.demo = true so CEO can clean up with one query:
//   DELETE FROM repair_tickets WHERE metadata->>'demo' = 'true';
//
// What it creates:
//  * 8 categories (if not present)
//  * 6 technicians (4 internal + 2 vendor)
//  * 18 tickets spanning every status (NEW · ACK · IN_PROGRESS · WAITING_PARTS · RESOLVED · CLOSED · CANCELLED)
//    covering both Pooil + JP Sync companies, multiple urgencies, with photos
//    placeholders, parts, and timeline events.
//
// Branches/companies are auto-discovered from the existing org (script does NOT
// create branches — they come from the live tenant). If org has <2 active
// branches the script bails with a friendly error.
//
// Run: node scripts/seed-repair-demo.mjs

import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const log = (...a) => console.log("[seed-repair]", ...a);
const warn = (...a) => console.warn("[seed-repair][warn]", ...a);

// ---------- categories ----------
const CATEGORIES = [
  { slug: "air",       label: "แอร์/เครื่องปรับอากาศ",   emoji: "❄️", defaultUrgency: "NORMAL", sortOrder: 10 },
  { slug: "electric",  label: "ไฟฟ้า/ปลั๊ก/แสงสว่าง",     emoji: "⚡", defaultUrgency: "URGENT", sortOrder: 20 },
  { slug: "plumbing",  label: "น้ำ/ท่อ/สุขภัณฑ์",          emoji: "💧", defaultUrgency: "NORMAL", sortOrder: 30 },
  { slug: "pos",       label: "POS / คอมพิวเตอร์",         emoji: "🖥",  defaultUrgency: "URGENT", sortOrder: 40 },
  { slug: "dispenser", label: "ตู้จ่าย/ปั๊ม/หัวจ่าย",      emoji: "⛽", defaultUrgency: "URGENT", sortOrder: 50 },
  { slug: "fridge",    label: "ตู้เย็น/ตู้แช่",             emoji: "🧊", defaultUrgency: "NORMAL", sortOrder: 60 },
  { slug: "structure", label: "โครงสร้าง/หลังคา/ประตู",     emoji: "🏗",  defaultUrgency: "LOW",    sortOrder: 70 },
  { slug: "other",     label: "อื่น ๆ",                     emoji: "🛠",  defaultUrgency: "NORMAL", sortOrder: 99 },
];

// ---------- technicians ----------
const TECHS = [
  { name: "ต้อง รัตน์ภพ",  kind: "INTERNAL", phone: "0812345601", specialties: ["แอร์", "ไฟฟ้า", "POS"] },
  { name: "ตี๋ ธนกร",       kind: "INTERNAL", phone: "0812345602", specialties: ["น้ำ/ท่อ", "โครงสร้าง"] },
  { name: "เอ๋ สุนทรา",     kind: "INTERNAL", phone: "0812345603", specialties: ["ตู้จ่าย/ปั๊ม", "ไฟฟ้า"] },
  { name: "ต้น พีระพัฒน์",   kind: "INTERNAL", phone: "0812345604", specialties: ["แอร์", "ตู้เย็น"] },
  { name: "บอย สมชาย",     kind: "VENDOR",   phone: "0812345605", specialties: ["POS", "คอมพิวเตอร์"] },
  { name: "หนุ่ม ปาราเมศ",  kind: "VENDOR",   phone: "0812345606", specialties: ["โครงสร้าง"] },
];

const TICKET_TEMPLATES = [
  // urgent (NEW · ยังไม่มอบ)
  { catSlug: "dispenser", title: "ตู้จ่าย B3 เบนซิน 95 ไหลช้ามาก",
    desc: "ลูกค้าร้องเรียน · เติม 40 ลิตรใช้เวลา 4 นาที · ตรวจหัวจ่ายเบื้องต้นไม่อุดตัน · ขอช่างขั้นตอนถัดไป",
    status: "NEW", urgency: "URGENT", ageHr: 26, assignTech: null,
    photoCount: 3, parts: [],
    msgs: ["มีรอเข้าคิวอยู่ 4 คัน", "ผจก.สาขาขอเร่งด่วน"],
  },
  { catSlug: "fridge", title: "ตู้แช่เครื่องดื่ม ไม่เย็น · เครื่องดื่มหน้าร้าน",
    desc: "อุณหภูมิจริง 12°C ต้องไม่เกิน 4°C · คอมเพรสเซอร์ทำงานเสียงดังกว่าปกติ",
    status: "NEW", urgency: "URGENT", ageHr: 2, assignTech: null,
    photoCount: 3, parts: [], msgs: [],
  },
  { catSlug: "electric", title: "เบรกเกอร์หลักทริปทุก 2 ชม.",
    desc: "เปิดปิดมา 3 วัน · ตรวจเบื้องต้นไม่เห็นต้นเหตุ · สงสัยเบรกเกอร์เก่า", status: "NEW",
    urgency: "URGENT", ageHr: 1, assignTech: null, photoCount: 2, parts: [], msgs: [],
  },

  // ACK (รับงานแล้ว ยังไม่ลงมือ)
  { catSlug: "pos", title: "POS เครื่อง 2 ค้าง · พิมพ์ใบเสร็จไม่ออก",
    desc: "เปลี่ยน thermal paper แล้วยัง · เครื่อง 1 ยังใช้ได้", status: "ACK",
    urgency: "NORMAL", ageHr: 8, assignTech: 4, photoCount: 1, parts: [],
    msgs: ["ช่างจะเข้าบ่ายนี้"],
  },
  { catSlug: "air", title: "แอร์ห้องผู้จัดการสาขา ทำงานน้อย ลามถึงเสียง",
    desc: "ลามจนพนักงานได้ยินเสียง · ต้องซ่อมก่อนวันจันทร์",
    status: "ACK", urgency: "NORMAL", ageHr: 48, assignTech: 3,
    photoCount: 3, parts: [], msgs: ["ขอเช็คคาปาก่อน"],
  },

  // IN_PROGRESS
  { catSlug: "air", title: "แอร์ห้องพัก 305 ไม่เย็น เสียงดัง",
    desc: "แขกแจ้งว่าแอร์เย็นไม่พอตั้งแต่เมื่อคืน · ตอนเปิด 20°C อุณหภูมิห้องอยู่ที่ ~26°C เสียงพัดลมดังกว่าปกติ",
    status: "IN_PROGRESS", urgency: "URGENT", ageHr: 14, assignTech: 0,
    photoCount: 4, parts: [
      { name: "ผ้ารองคอนเดนเซอร์", quantity: 1, unit: "ผืน", unitPrice: 280, partStatus: "INSTALLED" },
      { name: "น้ำยาแอร์ R32", quantity: 1, unit: "กก.", unitPrice: 1500, partStatus: "INSTALLED" },
    ],
    msgs: ["รับงานเข้าหน้างาน", "พบคาปาเสีย รอของ", "ติดตั้งใหม่เรียบร้อย · เปิดทดสอบ"],
  },
  { catSlug: "plumbing", title: "ห้องน้ำชาย สุขภัณฑ์ตัน 2 ห้อง",
    desc: "ลูกค้าเข้าใช้ไม่ได้ ตั้งแต่เช้า · ปั๊มดูดแล้วยังตัน",
    status: "IN_PROGRESS", urgency: "NORMAL", ageHr: 6, assignTech: 1,
    photoCount: 2, parts: [
      { name: "ของเหลวล้างท่อ", quantity: 2, unit: "ขวด", unitPrice: 350, partStatus: "INSTALLED" },
    ],
    msgs: ["เริ่มทำงาน 14:00", "ห้อง 1 OK · กำลังทำห้อง 2"],
  },

  // WAITING_PARTS
  { catSlug: "dispenser", title: "ตู้จ่ายหมายเลข 2 รั่วใต้ก้น",
    desc: "พิจารณาว่าหัวจ่ายตันบางตัว ขอเปลี่ยน O-ring + ตรวจสายส่ง",
    status: "WAITING_PARTS", urgency: "URGENT", ageHr: 42, assignTech: 2,
    photoCount: 4, parts: [
      { name: "O-ring หัวจ่ายดีเซล D1", spec: "เบอร์ 12.5×2", quantity: 6, unit: "ชิ้น", unitPrice: 280, partStatus: "ORDERED", supplier: "PetroParts" },
      { name: "วาล์วหัวจ่ายเบนซิน 95", spec: "DN20", quantity: 2, unit: "ชุด", unitPrice: 6500, partStatus: "ORDERED", supplier: "PetroParts" },
    ],
    msgs: ["สั่งของแล้ว ETA 2 วัน"],
  },
  { catSlug: "electric", title: "ป้ายไฟ LED หน้าปั๊ม ดับครึ่งหนึ่ง",
    desc: "ดับมา 2 วัน · ให้สาขาแจ้งลูกค้าผ่านสื่อ · ตรวจว่า driver ตัน",
    status: "WAITING_PARTS", urgency: "NORMAL", ageHr: 56, assignTech: 2,
    photoCount: 1, parts: [
      { name: "Driver LED 100W กว้าน", spec: "100W 24V", quantity: 4, unit: "ตัว", unitPrice: 850, partStatus: "ORDERED", supplier: "LightHub" },
    ],
    msgs: ["จัดซื้อกำลังสั่ง", "ส่งมาแล้วจะนัดเข้า"],
  },

  // RESOLVED (รอปิดงาน)
  { catSlug: "air", title: "แอร์โซน Office ห้องประชุมใหญ่ ไม่ทำงาน 3 ตัว",
    desc: "ระบบอุณหภูมิผู้บริหารกรุ๊ปนี้ · ขอด่วน", status: "RESOLVED",
    urgency: "URGENT", ageHr: 60, assignTech: 3, photoCount: 3,
    parts: [
      { name: "คอมเพรสเซอร์แอร์ R32 12K", quantity: 1, unit: "ตัว", unitPrice: 11500, partStatus: "INSTALLED" },
    ],
    msgs: ["ติดตั้งเสร็จ ทดสอบ 1 ชม.", "รอ ผจก. กดปิด"],
    resolveCost: { parts: 11500, labor: 3000 },
  },
  { catSlug: "pos", title: "WiFi สาขาตก ทุก 30 นาที",
    desc: "AP ข้างปั๊มแสดงสถานะ Error · กระทบ POS + CCTV",
    status: "RESOLVED", urgency: "NORMAL", ageHr: 10, assignTech: 4,
    photoCount: 0, parts: [], msgs: ["เปลี่ยน AP ใหม่ ทดสอบดี"],
    resolveCost: { parts: 4200, labor: 1200 },
  },

  // CLOSED
  { catSlug: "fridge", title: "ตู้แช่ออมิ น้ำแข็งเกาะหนา · ปิดประตูไม่สนิท",
    desc: "ปรับลูกบิด · ตรวจซิลขอบประตู", status: "CLOSED",
    urgency: "LOW", ageHr: 96, assignTech: 3, photoCount: 1, parts: [],
    msgs: ["ปรับซีลแล้ว", "ใช้งานปกติ ปิดงาน"],
    resolveCost: { parts: 280, labor: 500 },
  },
  { catSlug: "electric", title: "เปลี่ยนหลอดไฟ ฝ้า 6 จุด",
    desc: "เปลี่ยนหลอด LED ใหม่ทั้งหมด พร้อมตรวจ ballast", status: "CLOSED",
    urgency: "NORMAL", ageHr: 120, assignTech: 0, photoCount: 2, parts: [
      { name: "หลอด LED T8 18W", quantity: 6, unit: "หลอด", unitPrice: 480, partStatus: "INSTALLED" },
    ],
    msgs: ["เปลี่ยนครบ", "ทดสอบสว่างปกติ"],
    resolveCost: { parts: 2880, labor: 800 },
  },

  // Mix of LOW priority and CANCELLED
  { catSlug: "other", title: "เครื่องดูดควันครัวเสียงดัง",
    desc: "เสียงดังกว่าปกติ ใช้ได้แต่หนวกหู · ลองตัดสินใจซื้อใหม่ดีกว่า", status: "CANCELLED",
    urgency: "LOW", ageHr: 200, assignTech: null, photoCount: 1, parts: [], msgs: ["ผู้บริหารตัดสินใจซื้อใหม่"],
  },
  { catSlug: "structure", title: "ป้ายชื่อสาขา หลุดน็อต ฝนตกหนัก",
    desc: "ลมแรงทำหลุด · ขอตอกใหม่", status: "ACK",
    urgency: "URGENT", ageHr: 36, assignTech: 5, photoCount: 5, parts: [], msgs: ["เลื่อนเข้าพรุ่งนี้เช้า"],
  },

  // JP Sync side (assigned to second company if exists)
  { catSlug: "pos", title: "JP สำนัก เครื่อง POS A หาเครื่องพิมพ์ไม่เจอ",
    desc: "Driver หาย หลังอัปเดต Windows · ขอติดตั้งใหม่",
    status: "ACK", urgency: "NORMAL", ageHr: 14, assignTech: 4, photoCount: 1,
    parts: [], msgs: ["ช่างจะเข้าเย็นนี้"], company: "JPSYNC",
  },
  { catSlug: "air", title: "JP ห้องประชุม กลิ่นอับ · ขอล้างแอร์",
    desc: "ล้างใหญ่ตามวงจร 6 เดือน · นัดวันเสาร์", status: "WAITING_PARTS",
    urgency: "LOW", ageHr: 80, assignTech: 0, photoCount: 0,
    parts: [{ name: "น้ำยาล้างแอร์", quantity: 2, unit: "แกลลอน", unitPrice: 450, partStatus: "ORDERED" }],
    msgs: ["รอ vendor ส่ง"], company: "JPSYNC",
  },
];

const PLACEHOLDER_IMAGE =
  "https://images.unsplash.com/photo-1551611231-25e34c44b27a?auto=format&fit=crop&w=600&q=60";

const REPORTERS = [
  { name: "สมชาย ผจก.อนุสาวรีย์", phone: "0812345601" },
  { name: "อังคณา ผจก.รัชดา",   phone: "0812345602" },
  { name: "วิทยา ผจก.บางพลัด",   phone: "0812345603" },
  { name: "พัชรา ผจก.ลาดพร้าว",   phone: "0812345604" },
  { name: "ภัทร พนักงานปั๊ม",     phone: "0812345605" },
  { name: "ปริมา ผจก.บางนา",     phone: "0812345606" },
  { name: "สุริยกร พนักงาน 7-11",  phone: "0812345607" },
];

// ----- helpers -----
function pickReporter(i) { return REPORTERS[i % REPORTERS.length]; }
function hoursAgo(h) { return new Date(Date.now() - h * 60 * 60 * 1000); }
function addHours(d, h) { return new Date(d.getTime() + h * 60 * 60 * 1000); }
function slaHoursFor(u) { return u === "URGENT" ? 24 : u === "NORMAL" ? 72 : 168; }
function responseHoursFor(u) { return u === "URGENT" ? 4 : u === "NORMAL" ? 24 : 72; }

async function getOrgAndBranches() {
  const { data: orgs, error: e1 } = await sb
    .from("organizations")
    .select("id, name")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1);
  if (e1) throw e1;
  if (!orgs?.length) throw new Error("ไม่พบ organization ที่ active");
  const org = orgs[0];

  const { data: companies, error: e2 } = await sb
    .from("companies")
    .select("id, name, code")
    .eq("org_id", org.id)
    .eq("is_active", true);
  if (e2) throw e2;

  const { data: branches, error: e3 } = await sb
    .from("branches")
    .select("id, code, name, business_type, company_id")
    .eq("org_id", org.id)
    .eq("is_active", true)
    .order("code");
  if (e3) throw e3;

  if (!branches?.length) {
    throw new Error("ไม่พบ branch ที่ active · เพิ่ม branch ก่อนแล้วค่อยรัน seed");
  }
  return { org, companies: companies ?? [], branches };
}

async function ensureCategories(orgId) {
  const { data: existing, error } = await sb
    .from("repair_categories")
    .select("id, slug")
    .eq("org_id", orgId);
  if (error) throw error;
  const haveSlugs = new Set((existing ?? []).map((c) => c.slug));
  const toInsert = CATEGORIES.filter((c) => !haveSlugs.has(c.slug)).map((c) => ({
    id: randomUUID(),
    org_id: orgId,
    slug: c.slug,
    label: c.label,
    emoji: c.emoji,
    default_urgency: c.defaultUrgency,
    sort_order: c.sortOrder,
    is_active: true,
  }));
  if (toInsert.length > 0) {
    const { error: ie } = await sb.from("repair_categories").insert(toInsert);
    if (ie) throw ie;
    log(`+ ${toInsert.length} categories inserted`);
  } else {
    log(`= categories already complete (${existing.length})`);
  }
  const { data: all } = await sb
    .from("repair_categories")
    .select("id, slug, label, emoji, default_urgency")
    .eq("org_id", orgId);
  return all ?? [];
}

async function ensureTechnicians(orgId) {
  const { data: existing } = await sb
    .from("repair_technicians")
    .select("id, name")
    .eq("org_id", orgId)
    .in("name", TECHS.map((t) => t.name));
  const existingNames = new Set((existing ?? []).map((t) => t.name));
  const toInsert = TECHS.filter((t) => !existingNames.has(t.name)).map((t) => ({
    id: randomUUID(),
    org_id: orgId,
    kind: t.kind,
    name: t.name,
    phone: t.phone,
    specialties: t.specialties,
    is_active: true,
  }));
  if (toInsert.length > 0) {
    const { error } = await sb.from("repair_technicians").insert(toInsert);
    if (error) throw error;
    log(`+ ${toInsert.length} technicians inserted`);
  } else {
    log(`= technicians already complete (${existing.length})`);
  }
  const { data: all } = await sb
    .from("repair_technicians")
    .select("id, name, kind, specialties")
    .eq("org_id", orgId)
    .in("name", TECHS.map((t) => t.name));
  return all ?? [];
}

async function deleteDemoTickets(orgId) {
  // First fetch demo ticket IDs so we can cascade clean
  const { data: existing } = await sb
    .from("repair_tickets")
    .select("id")
    .eq("org_id", orgId)
    .filter("metadata->>demo", "eq", "true");
  if (!existing?.length) {
    log("= no existing demo tickets to clean");
    return;
  }
  const ids = existing.map((t) => t.id);
  // Cascade should handle photos/parts/events because FK has onDelete: Cascade
  const { error } = await sb.from("repair_tickets").delete().in("id", ids);
  if (error) throw error;
  log(`- removed ${ids.length} existing demo tickets`);
}

async function nextTicketCode(orgId) {
  const { data, error } = await sb.rpc("repair_next_ticket_code", { p_org_id: orgId });
  if (error) throw error;
  return data;
}

async function createTicket({
  orgId,
  branch,
  category,
  tech,
  template,
  reporter,
}) {
  const code = await nextTicketCode(orgId);
  const createdAt = hoursAgo(template.ageHr);
  const responseDueAt = addHours(createdAt, responseHoursFor(template.urgency));
  const resolveDueAt = addHours(createdAt, slaHoursFor(template.urgency));
  const acknowledgedAt = ["ACK", "IN_PROGRESS", "WAITING_PARTS", "RESOLVED", "CLOSED"].includes(template.status)
    ? addHours(createdAt, Math.max(0.5, responseHoursFor(template.urgency) * 0.4))
    : null;
  const startedAt = ["IN_PROGRESS", "WAITING_PARTS", "RESOLVED", "CLOSED"].includes(template.status)
    ? addHours(createdAt, Math.max(1, responseHoursFor(template.urgency) * 0.6))
    : null;
  const resolvedAt = ["RESOLVED", "CLOSED"].includes(template.status)
    ? addHours(createdAt, slaHoursFor(template.urgency) * 0.75)
    : null;
  const closedAt = template.status === "CLOSED" ? addHours(createdAt, slaHoursFor(template.urgency) * 0.85) : null;
  const cancelledAt = template.status === "CANCELLED" ? addHours(createdAt, slaHoursFor(template.urgency) * 0.3) : null;

  const partsCostCents = template.resolveCost?.parts ? template.resolveCost.parts * 100 : 0;
  const laborCostCents = template.resolveCost?.labor ? template.resolveCost.labor * 100 : 0;

  const id = randomUUID();
  const { error } = await sb.from("repair_tickets").insert({
    id,
    org_id: orgId,
    company_id: branch.company_id,
    branch_id: branch.id,
    category_id: category.id,
    ticket_code: code,
    title: template.title,
    description: template.desc,
    status: template.status,
    urgency: template.urgency,
    source: "FREEFORM",
    reporter_name: reporter.name,
    reporter_phone: reporter.phone,
    assigned_tech_id: tech ? tech.id : null,
    assigned_at: tech ? addHours(createdAt, 0.5) : null,
    response_due_at: responseDueAt,
    resolve_due_at: resolveDueAt,
    acknowledged_at: acknowledgedAt,
    started_at: startedAt,
    resolved_at: resolvedAt,
    closed_at: closedAt,
    cancelled_at: cancelledAt,
    parts_cost_cents: partsCostCents,
    labor_cost_cents: laborCostCents,
    metadata: { demo: true, seedAt: new Date().toISOString() },
    created_at: createdAt.toISOString(),
    updated_at: (resolvedAt ?? acknowledgedAt ?? createdAt).toISOString(),
  });
  if (error) throw error;
  return { id, code, createdAt, acknowledgedAt, startedAt, resolvedAt, closedAt, cancelledAt };
}

async function createTimelineEvents(orgId, ticket, template, tech, reporter) {
  const events = [];
  events.push({
    id: randomUUID(),
    org_id: orgId,
    ticket_id: ticket.id,
    kind: "CREATED",
    actor_name: reporter.name,
    payload: { source: "FREEFORM" },
    created_at: ticket.createdAt.toISOString(),
  });
  if (tech) {
    events.push({
      id: randomUUID(),
      org_id: orgId,
      ticket_id: ticket.id,
      kind: "ASSIGN",
      actor_name: "ระบบประสาน",
      payload: { tech: tech.name },
      created_at: addHours(ticket.createdAt, 0.5).toISOString(),
    });
  }
  if (ticket.acknowledgedAt) {
    events.push({
      id: randomUUID(),
      org_id: orgId,
      ticket_id: ticket.id,
      kind: "STATUS_CHANGE",
      actor_name: tech ? tech.name : "ระบบประสาน",
      payload: { from: "NEW", to: "ACK" },
      created_at: ticket.acknowledgedAt.toISOString(),
    });
  }
  if (ticket.startedAt) {
    events.push({
      id: randomUUID(),
      org_id: orgId,
      ticket_id: ticket.id,
      kind: "STATUS_CHANGE",
      actor_name: tech ? tech.name : "ช่าง",
      payload: { from: "ACK", to: "IN_PROGRESS" },
      created_at: ticket.startedAt.toISOString(),
    });
  }
  // comments
  let commentOffset = 1;
  for (const m of template.msgs) {
    const base = ticket.startedAt ?? ticket.acknowledgedAt ?? ticket.createdAt;
    events.push({
      id: randomUUID(),
      org_id: orgId,
      ticket_id: ticket.id,
      kind: "COMMENT",
      actor_name: tech ? tech.name : "ผู้แจ้ง",
      payload: { body: m },
      created_at: addHours(base, commentOffset).toISOString(),
    });
    commentOffset += 1.5;
  }
  if (ticket.resolvedAt) {
    events.push({
      id: randomUUID(),
      org_id: orgId,
      ticket_id: ticket.id,
      kind: "STATUS_CHANGE",
      actor_name: tech ? tech.name : "ระบบ",
      payload: { from: "IN_PROGRESS", to: "RESOLVED" },
      created_at: ticket.resolvedAt.toISOString(),
    });
  }
  if (ticket.closedAt) {
    events.push({
      id: randomUUID(),
      org_id: orgId,
      ticket_id: ticket.id,
      kind: "CLOSE",
      actor_name: "ผจก. สาขา",
      payload: { from: "RESOLVED", to: "CLOSED" },
      created_at: ticket.closedAt.toISOString(),
    });
  }
  if (ticket.cancelledAt) {
    events.push({
      id: randomUUID(),
      org_id: orgId,
      ticket_id: ticket.id,
      kind: "STATUS_CHANGE",
      actor_name: "ผู้บริหาร",
      payload: { from: "NEW", to: "CANCELLED", reason: "ตัดสินใจซื้อใหม่ดีกว่า" },
      created_at: ticket.cancelledAt.toISOString(),
    });
  }
  if (events.length === 0) return;
  const { error } = await sb.from("repair_timeline_events").insert(events);
  if (error) throw error;
}

async function createPhotos(orgId, ticket, template, reporter) {
  if (!template.photoCount) return;
  const photos = [];
  for (let i = 0; i < template.photoCount; i++) {
    photos.push({
      id: randomUUID(),
      org_id: orgId,
      ticket_id: ticket.id,
      phase: i === template.photoCount - 1 && ticket.resolvedAt ? "AFTER" : "BEFORE",
      r2_key: `demo/${ticket.id}/${i}.jpg`,
      r2_public_url: PLACEHOLDER_IMAGE,
      content_type: "image/jpeg",
      size_bytes: 84000 + i * 1000,
      uploaded_by_name: reporter.name,
      created_at: addHours(ticket.createdAt, i * 0.25).toISOString(),
    });
  }
  const { error } = await sb.from("repair_photos").insert(photos);
  if (error) throw error;
}

async function createParts(orgId, ticket, template) {
  if (!template.parts?.length) return;
  // We need an arbitrary actor id for added_by_id — pick first super_admin user.
  const { data: actor } = await sb
    .from("users")
    .select("id, name")
    .eq("org_id", orgId)
    .in("role", ["super_admin", "org_admin", "admin"])
    .limit(1);
  const actorId = actor?.[0]?.id;
  if (!actorId) {
    warn("ไม่พบ admin user · ข้ามการ seed parts (added_by_id required)");
    return;
  }
  const rows = template.parts.map((p) => ({
    id: randomUUID(),
    org_id: orgId,
    ticket_id: ticket.id,
    name: p.name,
    spec: p.spec ?? null,
    quantity: p.quantity,
    unit: p.unit,
    unit_price_cents: p.unitPrice * 100,
    status: p.partStatus,
    supplier: p.supplier ?? null,
    added_by_id: actorId,
    ordered_at: ["ORDERED", "DELIVERED", "INSTALLED"].includes(p.partStatus)
      ? addHours(ticket.createdAt, 4).toISOString()
      : null,
    delivered_at: ["DELIVERED", "INSTALLED"].includes(p.partStatus)
      ? addHours(ticket.createdAt, 12).toISOString()
      : null,
    installed_at: p.partStatus === "INSTALLED"
      ? addHours(ticket.createdAt, 20).toISOString()
      : null,
    created_at: addHours(ticket.createdAt, 2).toISOString(),
  }));
  const { error } = await sb.from("repair_parts").insert(rows);
  if (error) throw error;
}

// ---------- main ----------
async function main() {
  log("starting seed…");
  const { org, companies, branches } = await getOrgAndBranches();
  log(`org=${org.name} (${org.id}) · branches=${branches.length} · companies=${companies.length}`);

  const cats = await ensureCategories(org.id);
  const techs = await ensureTechnicians(org.id);
  const catBySlug = Object.fromEntries(cats.map((c) => [c.slug, c]));

  await deleteDemoTickets(org.id);

  // Map company codes to ids
  const companyByCode = Object.fromEntries(companies.map((c) => [c.code.toUpperCase(), c]));
  const pooilBranches = branches.filter((b) =>
    companyByCode.POOIL ? b.company_id === companyByCode.POOIL.id : true,
  );
  const jpBranches = branches.filter((b) =>
    companyByCode.JPSYNC ? b.company_id === companyByCode.JPSYNC.id : false,
  );

  let i = 0;
  let created = 0;
  for (const tpl of TICKET_TEMPLATES) {
    const cat = catBySlug[tpl.catSlug] ?? cats[0];
    const targetBranches = tpl.company === "JPSYNC" && jpBranches.length > 0 ? jpBranches : pooilBranches;
    const branch = targetBranches[i % targetBranches.length];
    if (!branch) {
      warn(`skip ticket "${tpl.title}" — no suitable branch`);
      continue;
    }
    const tech = tpl.assignTech !== null && tpl.assignTech !== undefined ? techs[tpl.assignTech % techs.length] : null;
    const reporter = pickReporter(i);
    const ticket = await createTicket({
      orgId: org.id,
      branch,
      category: cat,
      tech,
      template: tpl,
      reporter,
    });
    await createTimelineEvents(org.id, ticket, tpl, tech, reporter);
    await createPhotos(org.id, ticket, tpl, reporter);
    await createParts(org.id, ticket, tpl);
    log(`  + ${ticket.code} · ${tpl.status} · ${tpl.urgency} · ${branch.code} · ${tpl.title.slice(0, 38)}`);
    i++;
    created++;
  }

  log(`✓ seed complete · ${created} demo tickets created`);
  log("hint: ลบทั้งหมดได้ด้วย → DELETE FROM repair_tickets WHERE metadata->>'demo' = 'true';");
}

main().catch((e) => {
  console.error("✗ seed failed", e);
  process.exit(1);
});
