/**
 * ClawFleet v2 — จัดการ ("เพิ่มสาขา/ตู้"). Full CRUD overview: ทุกสาขาตู้คีบ +
 * รายการตู้ในแต่ละสาขา. เพิ่ม/เปลี่ยนชื่อ/ลบ สาขา · เพิ่ม/เปลี่ยนชื่อ/ปลดระวาง ตู้.
 * ทุกปุ่มต่อกับ server action จริง (createBranch / renameBranch / deleteBranch /
 * createCfMachine / renameCfMachine / retireCfMachine) ใน lib/clawfleet/v2-actions.ts.
 */
import { getV2ManageBranches } from "@/lib/clawfleet/v2-queries";
import { ManageClient } from "@/components/clawfleet/v2/manage-client";

export const dynamic = "force-dynamic";

export default async function ManagePage() {
  const branches = await getV2ManageBranches();
  return <ManageClient branches={branches} />;
}
