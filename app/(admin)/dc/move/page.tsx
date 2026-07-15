// DC · /dc/move — รวมเข้ากับหน้า "เบิก · โอน · ย้ายที่" แล้ว (หน้าเดียว 3 แท็บ)
//   route นี้ยังใช้ได้ (มี nav/bookmark เก่าชี้มา) → redirect ไปแท็บ "ย้ายที่" ของหน้ารวม
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function DcMovePage() {
  redirect("/dc/transfer?tab=move");
}
