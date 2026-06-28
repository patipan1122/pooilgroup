// DC · /dc/move — รวมเข้ากับหน้า "ส่ง/โอน" แล้ว (CEO #4: หน้าเดียวมี toggle)
//   route นี้ยังใช้ได้ (มี nav/bookmark เก่าชี้มา) → redirect ไปแท็บ "ย้ายที่" ของหน้ารวม
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function DcMovePage() {
  redirect("/dc/transfer?mode=move");
}
