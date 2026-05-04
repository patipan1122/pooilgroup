import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-white relative overflow-hidden">
      <div
        className="absolute -top-32 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full opacity-20 blur-3xl"
        style={{
          background:
            "radial-gradient(circle, oklch(0.50 0.28 263) 0%, transparent 70%)",
        }}
      />
      <div className="text-center max-w-sm relative animate-fade-up">
        <div className="size-16 mx-auto rounded-2xl bg-[--color-brand-600] text-white flex items-center justify-center mb-5 shadow-blue">
          <Compass className="size-8" strokeWidth={2.5} />
        </div>
        <p className="text-[10rem] font-extrabold leading-none font-display text-[--color-brand-600] tracking-tighter mb-2">
          404
        </p>
        <h1 className="text-2xl font-extrabold tracking-tight font-display mb-2">
          ไม่พบ <span className="accent">หน้านี้</span>
        </h1>
        <p className="text-sm text-zinc-500 mb-6">
          URL อาจผิด หรือ หน้าถูกลบไปแล้ว
        </p>
        <Link href="/">
          <Button size="lg">กลับหน้าหลัก →</Button>
        </Link>
      </div>
    </div>
  );
}
