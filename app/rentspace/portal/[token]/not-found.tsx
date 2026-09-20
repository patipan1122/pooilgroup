import "@/components/rentspace/tokens.css";
import { LinkIcon } from "lucide-react";

export default function PortalNotFound() {
  return (
    <div className="rs-scope min-h-screen flex items-center justify-center px-6" style={{ background: "var(--rs-bg-2)" }}>
      <div className="rs-card p-8 max-w-sm text-center">
        <div className="mx-auto h-12 w-12 rounded-full flex items-center justify-center mb-3" style={{ background: "var(--rs-bg-2)" }}>
          <LinkIcon className="h-6 w-6" style={{ color: "var(--rs-text-2)" }} />
        </div>
        <h1 className="text-lg font-bold">ลิงก์นี้ใช้ไม่ได้</h1>
        <p className="text-[13.5px] mt-2 leading-relaxed" style={{ color: "var(--rs-text-2)" }}>
          ลิงก์อาจหมดอายุ ถูกยกเลิก หรือไม่ถูกต้อง กรุณาติดต่อเจ้าหน้าที่เพื่อขอลิงก์ใหม่ครับ
        </p>
      </div>
    </div>
  );
}
