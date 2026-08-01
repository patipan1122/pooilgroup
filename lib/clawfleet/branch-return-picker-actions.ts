"use server";

// ClawFleet · ส่งคืนคลังกลาง (DC) — UI bridge (server actions)
//   branch-return-queries.ts เป็น server module ธรรมดา (ไม่ใช่ "use server") → client เรียกตรงไม่ได้.
//   ไฟล์นี้ห่อ 2 query (read-only) ให้เป็น server action เพื่อให้ modal ฝั่งสาขา (stock-client.tsx)
//   เรียกตอนกด "เลือกจากใบโอน" ได้ — ไม่แตะ logic เดิม (delegate ล้วน · session/scope guard อยู่ใน query แล้ว).

import {
  listReceivedTransfersForBranch,
  getBranchReturnableFromTransfer,
} from "./branch-return-queries";
import type { ReceivedTransferRow, ReturnableLine } from "./branch-return-queries";

/** ใบโอน DC ที่รับเข้าสาขานี้แล้ว (สำหรับ list ของ picker "เลือกจากใบโอน"). */
export async function fetchReceivedTransfersForReturn(branchId: string): Promise<ReceivedTransferRow[]> {
  return listReceivedTransfersForBranch(branchId);
}

/** map ใบโอนที่เลือก → รายการ CfProduct + prefill qty (cap = min(received, onHand)). */
export async function fetchReturnableFromTransfer(
  branchId: string,
  transferId: string,
): Promise<ReturnableLine[]> {
  return getBranchReturnableFromTransfer(branchId, transferId);
}
