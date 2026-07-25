// เว็บแอปในไลน์ (LIFF) — เปิดจาก Rich Menu → ระบุตัวตนด้วย LINE → พอร์ทัลผู้เช่าเต็มจอ
import "@/components/rentspace/tokens.css";
import { LiffRentspaceClient } from "./_client";

export const dynamic = "force-dynamic";

export default function LiffRentspacePage() {
  return <LiffRentspaceClient liffId={process.env.NEXT_PUBLIC_RENTSPACE_LIFF_ID ?? ""} />;
}
