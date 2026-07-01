// FlowCo branch mapping — ties a FlowCo station code (ste_id, e.g. 1003) to a
// CashHub fuel_station branch. The link is stored on the branch itself in
// `branches.settings.flowco_ste_id` (jsonb) — so NO new table / migration is needed.
//
// The office sync uses ste_id 1003–1032 (+ 3001 สนง.ใหญ่ / 9999 test). Seed below is
// the CEO's authoritative station list (editable on the mapping page before creating).

import type { SupabaseClient } from "@supabase/supabase-js";

type Admin = SupabaseClient;

/** Pooil Oil — company that owns the fuel stations (verified against existing fuel_station rows). */
export const FLOWCO_COMPANY_ID = "00000000-0000-0000-0000-0000000000a1";
/** jsonb key on branches.settings that holds the FlowCo ste_id. */
export const STE_SETTINGS_KEY = "flowco_ste_id";
export const FLOWCO_BUSINESS_TYPE = "fuel_station";

export interface FlowcoStation {
  steId: number;
  /** e.g. "สาขา 3 ตลาดแค" — the number ("สาขา 3") is used to auto-suggest an existing branch. */
  name: string;
}

/** ลิสต์ 20 สาขาปั๊ม FlowCo (จาก CEO 2026-07-01). แก้ชื่อได้ในหน้าจับคู่ก่อนสร้าง. */
export const FLOWCO_STATIONS: FlowcoStation[] = [
  { steId: 1003, name: "สาขา 3 ตลาดแค" },
  { steId: 1004, name: "สาขา 4 หัวทะเล" },
  { steId: 1005, name: "สาขา 5 โนนสูง" },
  { steId: 1006, name: "สาขา 6 โคกสูง 1" },
  { steId: 1007, name: "สาขา 7 ดอนขวาง 1" },
  { steId: 1008, name: "สาขา 8 พล 1" },
  { steId: 1009, name: "สาขา 9 ชุมพวง" },
  { steId: 1010, name: "สาขา 10 กม.12" },
  { steId: 1011, name: "สาขา 11 พนมวัน" },
  { steId: 1012, name: "สาขา 12 พล 2" },
  { steId: 1013, name: "สาขา 13 หนองหว้า" },
  { steId: 1014, name: "สาขา 14 ดอนขวาง 2" },
  { steId: 1015, name: "สาขา 15 บ้านเกาะ" },
  { steId: 1017, name: "สาขา 17 ลำปลายมาศ" },
  { steId: 1020, name: "สาขา 20 วัดป่า" },
  { steId: 1021, name: "สาขา 21 โคกสูง 2" },
  { steId: 1022, name: "สาขา 22 บายพาส" },
  { steId: 1029, name: "สาขา 29 กม.1" },
  { steId: 1031, name: "สาขา 31 โตนด" },
  { steId: 1032, name: "สาขา 32 ปักธงชัย" },
  // สำนักงานใหญ่ (ste 9999) — CEO ยืนยันเป็นสาขาจริง (13 หัวปั๊ม · ยอด ~10% ของ 20 สาขา
  // = ไม่ใช่ยอดรวม/ไม่นับซ้ำ) → รวมในลิสต์นำเข้า. NB: ste 3001 "พระยาสุเรนท์" ยอด ฿0
  // ไม่รวม (ยอดจริงของ 62 STATION มาจากระบบวายเอ็มพลัส source แยก).
  { steId: 9999, name: "สำนักงานใหญ่" },
];

const SEED_BY_STE = new Map(FLOWCO_STATIONS.map((s) => [s.steId, s]));

interface BranchRow {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  settings: Record<string, unknown> | null;
}

export interface FuelBranchOption {
  id: string;
  code: string;
  name: string;
  linkedSteId: number | null;
}

export interface FlowcoBranchLink {
  steId: number;
  /** display / suggested name for a new branch */
  name: string;
  inData: boolean; // ste_id has rows in po_fuel_sales_daily
  inSeed: boolean; // ste_id is one of the 20 known stations
  linkedBranchId: string | null; // already mapped (settings.flowco_ste_id === steId)
  linkedBranchName: string | null;
  suggestBranchId: string | null; // existing fuel_station branch matched by "สาขา N", not yet linked
  suggestBranchName: string | null;
}

export interface FlowcoMapState {
  links: FlowcoBranchLink[];
  fuelBranches: FuelBranchOption[];
  mappedCount: number;
  totalStations: number;
}

function steIdFromSettings(settings: Record<string, unknown> | null): number | null {
  const v = settings?.[STE_SETTINGS_KEY];
  const n = typeof v === "number" ? v : v != null ? parseInt(String(v), 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** เลข "สาขา N" จากชื่อ (ไม่ใช่ ste_id) — ใช้ match กับสาขาที่มีอยู่ */
function branchNoFromName(name: string): number | null {
  const m = name.match(/สาขา\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

async function loadFuelBranches(admin: Admin, orgId: string): Promise<BranchRow[]> {
  const { data, error } = await admin
    .from("branches")
    .select("id,code,name,is_active,settings")
    .eq("org_id", orgId)
    .eq("business_type", FLOWCO_BUSINESS_TYPE)
    .order("code", { ascending: true });
  if (error) throw new Error(`อ่านสาขาปั๊มไม่สำเร็จ: ${error.message}`);
  return (data ?? []) as BranchRow[];
}

/** สร้างสถานะการจับคู่ทั้งหมด (สำหรับหน้าจับคู่สาขา) */
export async function buildFlowcoMapState(
  admin: Admin,
  orgId: string,
  steIdsInData: number[],
): Promise<FlowcoMapState> {
  const branches = await loadFuelBranches(admin, orgId);
  const linkedBySte = new Map<number, BranchRow>();
  for (const b of branches) {
    const ste = steIdFromSettings(b.settings);
    if (ste != null) linkedBySte.set(ste, b);
  }
  const inDataSet = new Set(steIdsInData);

  // union of known stations + any ste_id present in data (catches 3001 / 9999)
  const allSteIds = [
    ...new Set([...FLOWCO_STATIONS.map((s) => s.steId), ...steIdsInData]),
  ].sort((a, b) => a - b);

  const usedAsSuggestion = new Set<string>();
  const links: FlowcoBranchLink[] = allSteIds.map((steId) => {
    const seed = SEED_BY_STE.get(steId);
    const name = seed?.name ?? `สาขา (${steId})`;
    const linked = linkedBySte.get(steId) ?? null;

    let suggestBranchId: string | null = null;
    let suggestBranchName: string | null = null;
    if (!linked) {
      const no = seed ? branchNoFromName(seed.name) : null;
      if (no != null) {
        const cand = branches.find((b) => {
          if (steIdFromSettings(b.settings) != null) return false; // already linked to some ste
          if (usedAsSuggestion.has(b.id)) return false;
          const bno = branchNoFromName(b.name);
          return bno === no;
        });
        if (cand) {
          suggestBranchId = cand.id;
          suggestBranchName = cand.name;
          usedAsSuggestion.add(cand.id);
        }
      }
    }

    return {
      steId,
      name,
      inData: inDataSet.has(steId),
      inSeed: !!seed,
      linkedBranchId: linked?.id ?? null,
      linkedBranchName: linked?.name ?? null,
      suggestBranchId,
      suggestBranchName,
    };
  });

  return {
    links,
    fuelBranches: branches.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      linkedSteId: steIdFromSettings(b.settings),
    })),
    mappedCount: links.filter((l) => l.linkedBranchId).length,
    totalStations: FLOWCO_STATIONS.length,
  };
}

export type MapDecision =
  | { steId: number; action: "link"; branchId: string }
  | { steId: number; action: "create"; name: string }
  | { steId: number; action: "skip" };

export interface ApplyMapResult {
  linked: number;
  created: number;
  errors: string[];
}

/** บันทึกการจับคู่: link = เขียน settings.flowco_ste_id ลงสาขาเดิม · create = สร้างสาขาปั๊มใหม่ */
export async function applyFlowcoMapping(
  admin: Admin,
  orgId: string,
  userId: string,
  decisions: MapDecision[],
): Promise<ApplyMapResult> {
  const branches = await loadFuelBranches(admin, orgId);
  const byId = new Map(branches.map((b) => [b.id, b]));
  const now = new Date().toISOString();
  const res: ApplyMapResult = { linked: 0, created: 0, errors: [] };

  for (const d of decisions) {
    if (d.action === "skip") continue;

    if (d.action === "link") {
      const b = byId.get(d.branchId);
      if (!b) {
        res.errors.push(`สาขา ${d.steId}: ไม่พบสาขาที่เลือก`);
        continue;
      }
      const settings = { ...(b.settings ?? {}), [STE_SETTINGS_KEY]: d.steId };
      const { error } = await admin
        .from("branches")
        .update({ settings, updated_at: now })
        .eq("id", d.branchId)
        .eq("org_id", orgId);
      if (error) res.errors.push(`สาขา ${d.steId}: ${error.message}`);
      else res.linked += 1;
      continue;
    }

    // create
    const code = `PO-FUEL-${d.steId}`;
    const { error } = await admin.from("branches").upsert(
      {
        id: crypto.randomUUID(),
        org_id: orgId,
        company_id: FLOWCO_COMPANY_ID,
        code,
        name: `ปั๊มน้ำมัน - พีโอออยล์ ${d.name}`.trim(),
        business_type: FLOWCO_BUSINESS_TYPE,
        report_deadline: "23:00",
        is_active: true,
        settings: { [STE_SETTINGS_KEY]: d.steId },
        created_at: now,
        updated_at: now,
      },
      { onConflict: "org_id,code" },
    );
    if (error) res.errors.push(`สาขา ${d.steId} (${code}): ${error.message}`);
    else res.created += 1;
  }

  return res;
}

/** map ste_id → branch_id สำหรับตอนนำเข้า (เฉพาะสาขาที่จับคู่แล้ว) */
export async function resolveSteToBranch(
  admin: Admin,
  orgId: string,
): Promise<Map<number, { id: string; name: string }>> {
  const branches = await loadFuelBranches(admin, orgId);
  const map = new Map<number, { id: string; name: string }>();
  for (const b of branches) {
    const ste = steIdFromSettings(b.settings);
    if (ste != null) map.set(ste, { id: b.id, name: b.name });
  }
  return map;
}
