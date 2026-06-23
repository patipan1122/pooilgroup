// หน้าเดิมถูกรวมเข้าแอป "Play a lot" (เต็มจอ) แล้ว — forward เข้าจอที่ถูกต้องในแอปเดียว
// ตัดหน้าซ้ำตามที่ CEO สั่ง (2026-06-23 · D-023) · ลิงก์เก่า/บุ๊กมาร์ก/TV ยังใช้ได้ ไม่ 404
import { redirect } from "next/navigation";

export default function Page() {
  redirect("/playland?screen=pos");
}
