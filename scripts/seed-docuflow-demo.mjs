// Seed DocuFlow demo data
// ────────────────────────────────────────────────────────────────────
// CEO request 2026-05-21: "เพิ่มข้อมูลตัวอย่างไป ให้เห็นภาพด้วย ทุกฟีเจอร"
// Idempotent: all seeded rows are marked with `metadata?.demo = true` via
// description prefix "[DEMO]" so CEO can wipe them with:
//   DELETE FROM documents WHERE description LIKE '[DEMO]%';
//   DELETE FROM vehicles WHERE notes LIKE '[DEMO]%';
//   DELETE FROM person_documents WHERE document_id IN (SELECT id FROM documents WHERE description LIKE '[DEMO]%');
//
// What it creates (per active org/branch combo):
//   • 12 Documents across 6 categories (legal/tax/insurance/station/contract/land)
//   • Document ownership (mix of org/company/branch)
//   • Document tags (10 hashtags)
//   • DocumentRenewal for ~9 docs with varied expiry dates (today, 5d, 22d, 60d, 90d, expired)
//   • 4 Vehicles + 16 VehicleDocuments (4 types each)
//   • Person documents for first 3 staff (license, health, training)
//   • Cross-branch shared documents (1-2 entries)
//
// Run:
//   node scripts/seed-docuflow-demo.mjs            # seeds first active org
//   node scripts/seed-docuflow-demo.mjs --org=<id> # specific org
//   node scripts/seed-docuflow-demo.mjs --clean    # delete demo rows only

import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "✗ Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const orgArg = process.argv.find((a) => a.startsWith("--org="));
const orgIdFromArg = orgArg ? orgArg.split("=")[1] : null;
const CLEAN_MODE = args.has("--clean");

const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEMO_PREFIX = "[DEMO]";
const DAY = 24 * 60 * 60 * 1000;

function today() {
  return new Date().toISOString().slice(0, 10);
}
function daysFromNow(n) {
  const d = new Date(Date.now() + n * DAY);
  return d.toISOString().slice(0, 10);
}

async function pickOrg() {
  if (orgIdFromArg) return orgIdFromArg;
  const { data, error } = await supa
    .from("organizations")
    .select("id, name")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("No active organization found");
  console.log(`→ Using org: ${data.name} (${data.id})`);
  return data.id;
}

async function clean(orgId) {
  console.log("→ Cleaning previous demo rows…");
  // person_documents + vehicle_documents are CASCADE on document delete
  const { data: demoDocs } = await supa
    .from("documents")
    .select("id")
    .eq("org_id", orgId)
    .like("description", `${DEMO_PREFIX}%`);
  const demoDocIds = (demoDocs ?? []).map((d) => d.id);
  if (demoDocIds.length) {
    await supa.from("documents").delete().in("id", demoDocIds);
    console.log(`  · Removed ${demoDocIds.length} demo documents`);
  }
  // demo vehicles tagged with [DEMO] in notes
  const { data: demoVeh } = await supa
    .from("vehicles")
    .select("id")
    .eq("org_id", orgId)
    .like("notes", `${DEMO_PREFIX}%`);
  const demoVehIds = (demoVeh ?? []).map((v) => v.id);
  if (demoVehIds.length) {
    await supa.from("vehicles").delete().in("id", demoVehIds);
    console.log(`  · Removed ${demoVehIds.length} demo vehicles`);
  }
}

async function loadContext(orgId) {
  const [companiesRes, branchesRes, usersRes] = await Promise.all([
    supa
      .from("companies")
      .select("id, code, name")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .limit(5),
    supa
      .from("branches")
      .select("id, code, name, business_type, company_id")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .limit(20),
    supa
      .from("users")
      .select("id, name, role")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .in("role", ["super_admin", "org_admin", "admin", "branch_manager", "driver", "staff"])
      .order("name", { ascending: true })
      .limit(8),
  ]);
  if (companiesRes.error) throw companiesRes.error;
  if (branchesRes.error) throw branchesRes.error;
  if (usersRes.error) throw usersRes.error;
  return {
    companies: companiesRes.data ?? [],
    branches: branchesRes.data ?? [],
    users: usersRes.data ?? [],
  };
}

async function seedDocuments(orgId, ctx) {
  const adminId = ctx.users[0]?.id ?? null;
  const company1 = ctx.companies[0];
  const company2 = ctx.companies[1] ?? company1;
  const branch1 = ctx.branches[0];
  const branch2 = ctx.branches[1] ?? branch1;
  const branch3 = ctx.branches[2] ?? branch1;
  const driverUser = ctx.users.find((u) => u.role === "driver") ?? ctx.users[1];

  if (!company1 || !branch1) {
    console.warn("⚠ ต้องมีอย่างน้อย 1 บริษัท + 1 สาขา ก่อน seed ได้");
    return [];
  }

  const docs = [
    // Station — fuel
    {
      name: "ใบอนุญาตประกอบกิจการถัง KKN-002",
      cat: "station",
      ownership: { level: "branch", branchId: branch1.id, companyId: company1.id },
      expiry: daysFromNow(0), // หมดวันนี้
      tags: ["ต่ออายุด่วน", "ใบอนุญาตหลัก"],
      notes: "ต้องต่ออายุภายในวันนี้ — มิฉะนั้นปั๊มจะปิดดำเนินการ",
    },
    {
      name: "ใบรับรองถังเก็บเชื้อเพลิง KKN-002",
      cat: "station",
      ownership: { level: "branch", branchId: branch1.id, companyId: company1.id },
      expiry: daysFromNow(5),
      tags: ["ต่ออายุด่วน"],
      notes: "ตรวจสภาพ + ออกใบใหม่",
    },
    // Insurance
    {
      name: "ประกัน พ.ร.บ. รถบรรทุก 70-1234",
      cat: "insurance",
      ownership: { level: "branch", branchId: branch1.id, companyId: company1.id },
      expiry: daysFromNow(5),
      tags: ["พ.ร.บ.", "รถ"],
    },
    // Contract — land lease
    {
      name: "สัญญาเช่าที่ดินสาขาท่าจีน",
      cat: "land",
      ownership: { level: "branch", branchId: branch2.id, companyId: company1.id },
      expiry: daysFromNow(12),
      tags: ["สัญญาที่ดิน"],
      notes: "ต่อสัญญา 3 ปี · ปีละ 84,000 บาท",
    },
    // Legal — สัญญาเช่า
    {
      name: "ภ.พ.20",
      cat: "legal",
      ownership: { level: "group", branchId: null, companyId: null },
      expiry: daysFromNow(18),
      tags: ["ภาษี", "กลุ่ม"],
    },
    // Tax
    {
      name: "ทะเบียนการค้าสาขาน้ำพอง",
      cat: "tax",
      ownership: { level: "branch", branchId: branch3.id, companyId: company1.id },
      expiry: daysFromNow(27),
      tags: ["ภาษี"],
    },
    // Vehicle docs
    {
      name: "ทะเบียนรถบรรทุก 70-1234",
      cat: "vehicle",
      ownership: { level: "company", companyId: company1.id },
      expiry: daysFromNow(60),
      tags: ["ทะเบียนรถ"],
    },
    // Long-term renewal
    {
      name: "เอกสารเปลี่ยนมาตรวัด KKN-003",
      cat: "station",
      ownership: { level: "branch", branchId: branch2.id, companyId: company1.id },
      expiry: daysFromNow(60),
      tags: ["ตรวจสอบ"],
    },
    {
      name: "ใบ อบต. สิ่งแวดล้อม KKN-002",
      cat: "station",
      ownership: { level: "branch", branchId: branch1.id, companyId: company1.id },
      expiry: daysFromNow(84),
      tags: ["สิ่งแวดล้อม"],
    },
    // Multi-company
    {
      name: "ใบทะเบียนการค้า JP Sync",
      cat: "legal",
      ownership: { level: "company", companyId: company2.id },
      expiry: daysFromNow(180),
      tags: ["JP Sync", "ทะเบียน"],
    },
    // Expired (เพื่อให้เห็น danger state)
    {
      name: "ใบอนุญาตเก่า KKN-005 (หมดแล้ว)",
      cat: "station",
      ownership: { level: "branch", branchId: branch1.id, companyId: company1.id },
      expiry: daysFromNow(-15),
      tags: ["หมดแล้ว"],
      notes: "ต่อใหม่แล้ว — ฉบับนี้เก็บเป็นประวัติ",
    },
    // Without renewal (ไม่หมดอายุ)
    {
      name: "หนังสือมอบอำนาจขาย KKN-007",
      cat: "legal",
      ownership: { level: "branch", branchId: branch1.id, companyId: company1.id },
      expiry: null,
      tags: ["มอบอำนาจ"],
    },
  ];

  const seeded = [];
  for (const doc of docs) {
    const docId = randomUUID();
    const fileKey = `documents/${orgId}/${docId}/demo-placeholder.pdf`;

    // Insert document
    const { error: docErr } = await supa.from("documents").insert({
      id: docId,
      org_id: orgId,
      name: doc.name,
      description: `${DEMO_PREFIX} ${doc.notes ?? "เอกสารตัวอย่างจาก seed"}`,
      file_key: fileKey,
      file_public_url: null,
      mime_type: "application/pdf",
      file_size: 102400,
      uploaded_by_id: adminId,
      is_active: true,
    });
    if (docErr) {
      console.error(`✗ Insert document failed: ${doc.name}`, docErr);
      continue;
    }

    // Ownership
    await supa.from("document_ownership").insert({
      org_id: orgId,
      document_id: docId,
      level: doc.ownership.level,
      company_id: doc.ownership.companyId ?? null,
      branch_id: doc.ownership.branchId ?? null,
      business_type: doc.ownership.businessType ?? null,
      person_id: null,
    });

    // Tags
    for (const t of doc.tags) {
      await supa.from("document_tags").insert({
        org_id: orgId,
        document_id: docId,
        tag: t,
      });
    }

    // Renewal (if has expiry)
    if (doc.expiry) {
      await supa.from("document_renewals").insert({
        org_id: orgId,
        document_id: docId,
        expiry_date: doc.expiry,
        renewal_period_years: 1,
        alert_days: [90, 30, 7],
        responsible_user_id: adminId,
        status: doc.expiry < today() ? "overdue" : "pending",
        notes: doc.notes ?? null,
      });
    }

    seeded.push({ id: docId, name: doc.name });
  }

  console.log(`✓ Seeded ${seeded.length} documents`);

  // Cross-branch share — pick the first 2 docs and share branch1↔branch2
  if (seeded.length >= 2 && branch1 && branch2 && branch1.id !== branch2.id) {
    for (const s of seeded.slice(0, 2)) {
      await supa.from("document_shared_branches").insert({
        org_id: orgId,
        document_id: s.id,
        branch_id: branch2.id,
        added_by_id: adminId,
      });
    }
    console.log(`✓ Shared 2 docs to ${branch2.code}`);
  }

  return seeded;
}

async function seedVehicles(orgId, ctx) {
  const adminId = ctx.users[0]?.id ?? null;
  const company1 = ctx.companies[0];
  const branch1 = ctx.branches[0];

  if (!company1 || !branch1) {
    console.warn("⚠ Skip vehicle seed (no company/branch)");
    return [];
  }

  const vehicles = [
    { plate: "70-1234", type: "fuel_truck" },
    { plate: "82-5678", type: "fuel_truck" },
    { plate: "BS-2999", type: "gas_truck" },
    { plate: "ขก 0001", type: "service" },
  ];

  const seeded = [];
  for (const v of vehicles) {
    const vid = randomUUID();
    const { error } = await supa.from("vehicles").insert({
      id: vid,
      org_id: orgId,
      license_plate: v.plate,
      vehicle_type: v.type,
      company_id: company1.id,
      branch_id: branch1.id,
      is_active: true,
      notes: `${DEMO_PREFIX} รถตัวอย่างจาก seed`,
    });
    if (error) {
      console.error(`✗ Vehicle insert failed: ${v.plate}`, error);
      continue;
    }

    // 4 vehicle docs per vehicle (registration / insurance_compulsory / inspection / tank_cert)
    const docTypes = [
      { kind: "registration", label: "ทะเบียน", expiry: daysFromNow(120) },
      { kind: "insurance_compulsory", label: "พ.ร.บ.", expiry: daysFromNow(45) },
      { kind: "inspection", label: "ตรวจสภาพ", expiry: daysFromNow(8) },
      { kind: "tank_cert", label: "ใบรับรองถัง", expiry: daysFromNow(-10) },
    ];

    for (const t of docTypes) {
      const did = randomUUID();
      const key = `documents/${orgId}/${did}/demo-vehicle-${v.plate.replace(/[^A-Z0-9]/gi, "")}-${t.kind}.pdf`;
      const { error: docErr } = await supa.from("documents").insert({
        id: did,
        org_id: orgId,
        name: `${t.label} - ${v.plate}`,
        description: `${DEMO_PREFIX} เอกสารรถ ${v.plate}`,
        file_key: key,
        file_public_url: null,
        mime_type: "application/pdf",
        file_size: 80000,
        uploaded_by_id: adminId,
        is_active: true,
      });
      if (docErr) continue;
      await supa.from("vehicle_documents").insert({
        org_id: orgId,
        vehicle_id: vid,
        document_id: did,
        doc_type: t.kind,
        expiry_date: t.expiry,
      });
      await supa.from("document_renewals").insert({
        org_id: orgId,
        document_id: did,
        expiry_date: t.expiry,
        renewal_period_years: 1,
        alert_days: [90, 30, 7],
        responsible_user_id: adminId,
        status: t.expiry < today() ? "overdue" : "pending",
      });
    }

    seeded.push({ id: vid, plate: v.plate });
  }

  console.log(`✓ Seeded ${seeded.length} vehicles + ${seeded.length * 4} vehicle docs`);
  return seeded;
}

async function seedPersonDocs(orgId, ctx) {
  const company1 = ctx.companies[0];
  // Pick up to 3 staff/driver users
  const targets = ctx.users
    .filter((u) =>
      ["driver", "staff", "branch_manager", "area_manager"].includes(u.role),
    )
    .slice(0, 3);

  if (targets.length === 0) {
    console.warn("⚠ Skip person doc seed (no driver/staff users)");
    return;
  }

  const docTypes = [
    { kind: "license", label: "ใบขับขี่", expiry: daysFromNow(40) },
    { kind: "health", label: "ใบรับรองสุขภาพ", expiry: daysFromNow(15) },
    { kind: "training", label: "ใบรับรองการอบรม", expiry: daysFromNow(120) },
  ];

  let count = 0;
  for (const u of targets) {
    for (const t of docTypes) {
      const did = randomUUID();
      const key = `documents/${orgId}/${did}/demo-person-${u.name.replace(/\s+/g, "_")}-${t.kind}.pdf`;
      const { error: docErr } = await supa.from("documents").insert({
        id: did,
        org_id: orgId,
        name: `${t.label} - ${u.name}`,
        description: `${DEMO_PREFIX} เอกสารบุคคล ${u.name}`,
        file_key: key,
        file_public_url: null,
        mime_type: "application/pdf",
        file_size: 60000,
        uploaded_by_id: u.id,
        is_active: true,
      });
      if (docErr) continue;
      await supa.from("document_ownership").insert({
        org_id: orgId,
        document_id: did,
        level: "person",
        company_id: company1?.id ?? null,
        person_id: u.id,
      });
      await supa.from("person_documents").insert({
        org_id: orgId,
        user_id: u.id,
        document_id: did,
        doc_type: t.kind,
        expiry_date: t.expiry,
      });
      await supa.from("document_renewals").insert({
        org_id: orgId,
        document_id: did,
        expiry_date: t.expiry,
        renewal_period_years: 1,
        alert_days: [90, 30, 7],
        responsible_user_id: u.id,
        status: "pending",
      });
      count++;
    }
  }

  console.log(`✓ Seeded ${count} person docs across ${targets.length} users`);
}

async function main() {
  const orgId = await pickOrg();
  await clean(orgId);
  if (CLEAN_MODE) {
    console.log("✓ Clean mode — done.");
    return;
  }
  const ctx = await loadContext(orgId);
  console.log(
    `→ Context: ${ctx.companies.length} companies · ${ctx.branches.length} branches · ${ctx.users.length} users`,
  );
  await seedDocuments(orgId, ctx);
  await seedVehicles(orgId, ctx);
  await seedPersonDocs(orgId, ctx);
  console.log("");
  console.log("✓ Done. Open /docuflow to see the demo data.");
  console.log(`  To remove later:  node scripts/seed-docuflow-demo.mjs --clean`);
}

main().catch((err) => {
  console.error("✗ Seed failed:", err);
  process.exit(1);
});
