/**
 * ตู้คีบ OS — สาขา (Branches)
 * Server: ดึง P&L รายสาขา (จริง) ใน try/catch → ส่งให้ client.
 * ถ้า DB ว่าง/ยังไม่ migrate → client ใช้ SAMPLE fallback + แบนเนอร์ "กำลังแสดงตัวอย่าง".
 */
import { getBranchPnl, bangkokStartOfDay, bangkokEndOfToday, type PnlRange } from "@/lib/clawfleet/pnl-queries";
import { getBranchMachineInfo, type MachineDotStatus } from "@/lib/clawfleet/dashboard-queries";
import { getCfMachinesForBranchAdmin } from "@/lib/clawfleet/stock-queries";
import { getV2Branches } from "@/lib/clawfleet/queries";
import { getStockSourceMap } from "@/lib/clawfleet/stock-source";
import { requireCfSession, cfHasAdminPower } from "@/lib/clawfleet/role-guard";
import { adminClient } from "@/lib/db/server";
import { listCompanies, listBankAccounts, type CompanyOpt, type BankAccountOpt } from "@/lib/cashhub/amazon-settlement-data";
import { BranchesClient, type BranchRow, type MachineOption, type BranchOption } from "./branches-client";

export const dynamic = "force-dynamic";

/** แปลง "YYYY-MM-DD" (จาก <input type=date>) → Date ต้นวัน/ปลายวัน "ตามเวลาไทย" · ค่าเสีย → undefined (graceful)
 *  ⚠️ ต้องตรึง +07:00 เสมอ — ไม่งั้นบน Vercel (UTC) จะตัดวันเพี้ยน 7 ชม. → รอบเก็บ 01:00–07:00 ไทยหลุดวัน
 *  (ให้ตรงกับ path default ที่ใช้ bangkokStartOfDay/bangkokEndOfToday · ไทย = UTC+7 คงที่ ไม่มี DST) */
function parseDateStart(s?: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(`${s}T00:00:00+07:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
function parseDateEnd(s?: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(`${s}T23:59:59.999+07:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
/** วันนี้ตามปฏิทินไทย (Asia/Bangkok) "YYYY-MM-DD" — ให้ default ฝั่ง server ตรงกับปุ่มลัดฝั่ง client */
function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

export default async function BranchesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;

  // ── ช่วงวันที่ (จาก searchParams ?from=&to=) — ไม่ได้เลือก/ค่าขยะ → default = วันนี้ (คงพฤติกรรมเดิม) ──
  // fromISO/toISO ที่ส่งเข้า client (ป้าย + ช่องกรอก) derive จากวันที่ parse "ผ่านจริง" เท่านั้น
  const parsedFrom = parseDateStart(sp.from);
  const parsedTo = parseDateEnd(sp.to);
  const fromISO = parsedFrom ? sp.from! : todayISO();
  const toISO = parsedTo ? sp.to! : todayISO();
  // Date range ที่ใช้ query จริง — ไม่มี param ที่ parse ผ่าน → ใช้ helper เวลาไทย
  // (เท่ากับ getBranchPnl() default เป๊ะ = วันนี้ · ตัดวันตาม Asia/Bangkok ไม่อิงเวลาเครื่อง)
  const range: PnlRange = {
    from: parsedFrom ?? bangkokStartOfDay(0),
    to: parsedTo ?? bangkokEndOfToday(),
  };

  let branchPnl: Awaited<ReturnType<typeof getBranchPnl>> = [];
  let machineInfo: Awaited<ReturnType<typeof getBranchMachineInfo>> | null = null;
  // surface-existing (reassign UI) — ต้องรู้ว่าเป็นแอดมินไหม (server assert อยู่แล้ว · UI แค่ซ่อน/แสดง)
  let isAdmin = false;
  let machineOptions: MachineOption[] = [];
  let branchOptions: BranchOption[] = [];
  let stockSourceByBranch: Record<string, string | null> = {};
  let companies: CompanyOpt[] = [];
  let bankAccounts: BankAccountOpt[] = [];
  try {
    const session = await requireCfSession();
    isAdmin = await cfHasAdminPower(session);
    // โหลดตู้ + สาขา + บริษัท/บัญชีธนาคาร เฉพาะแอดมิน (คนอื่นไม่เห็นการ์ดตั้งค่า → ไม่ต้องโหลด)
    if (isAdmin) {
      const admin = adminClient();
      const [ms, bs, srcMap, cos, banks] = await Promise.all([
        getCfMachinesForBranchAdmin(),
        getV2Branches(),
        getStockSourceMap(session.user.org_id),
        listCompanies(admin, session.user.org_id),
        listBankAccounts(admin, session.user.org_id),
      ]);
      machineOptions = ms.map((m) => ({
        id: m.id, code: m.code, nickname: m.nickname, branchId: m.branchId, branchName: m.branchName, isActive: m.isActive,
      }));
      branchOptions = bs.map((b) => ({ id: b.id, name: b.name, code: b.code }));
      stockSourceByBranch = srcMap;
      companies = cos;
      bankAccounts = banks;
    }
  } catch {
    // graceful: ยังไม่ login / DB ว่าง → ซ่อนปุ่มย้าย (isAdmin=false)
  }
  try {
    // P&L ขยับตามช่วงที่เลือก · getBranchMachineInfo() = สถานะฝูงตู้ปัจจุบัน (ไม่ผูกวันที่) → คงเดิม
    [branchPnl, machineInfo] = await Promise.all([getBranchPnl(range), getBranchMachineInfo()]);
  } catch {
    // graceful: DB ว่าง/ยังไม่ migrate → client จะ fallback เป็นตัวอย่าง
  }

  const branches: BranchRow[] = branchPnl.map((b) => {
    const info = machineInfo?.byBranch.get(b.branchId);
    return {
      branchId: b.branchId,
      code: b.code,
      name: b.name,
      // จำนวนตู้จริง (cfMachine active) — เลิกใช้ proxy riskyMachines+sessions
      machines: info?.count ?? 0,
      dolls: b.dollsOut,
      revenue: b.revenue,
      profit: b.profit,
      avgWin: b.avgBahtPerDoll == null ? 0 : Math.round(b.avgBahtPerDoll),
      flag: b.flag.flag,
      // สถานะรายตู้จริง (good/warn/broken) สำหรับ render dots
      dots: (info?.dots ?? []) as MachineDotStatus[],
    };
  });

  return (
    <BranchesClient
      branches={branches}
      isAdmin={isAdmin}
      machineOptions={machineOptions}
      branchOptions={branchOptions}
      stockSourceByBranch={stockSourceByBranch}
      companies={companies}
      bankAccounts={bankAccounts}
      fromISO={fromISO}
      toISO={toISO}
    />
  );
}
