// DC · /dc/issue — รวมเข้ากับหน้า "เบิก · โอน · ย้ายที่" แล้ว (หน้าเดียว 3 แท็บ)
//   route นี้ยังใช้ได้ (มี nav/bookmark/ปุ่มลัดหน้าคลังเก่าชี้มา) → redirect ไปแท็บ "เบิกออก" ของหน้ารวม
//   ตัว <IssueWorkspace> ยังอยู่ที่ ./issue-workspace — หน้ารวมเรียกใช้ตัวเดียวกันนี้
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function DcIssuePage() {
  redirect("/dc/transfer?tab=issue");
}
