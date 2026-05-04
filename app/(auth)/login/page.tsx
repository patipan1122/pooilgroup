import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="w-full max-w-md">
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center size-14 rounded-2xl bg-[--color-brand-600] text-white mb-4 shadow-lg">
          <span className="text-2xl font-bold font-display">P</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 font-display">
          ยินดีต้อนรับกลับ
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          เข้าสู่ระบบเพื่อจัดการ Pool Group ERP
        </p>
      </div>
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-soft p-6 sm:p-8">
        <LoginForm />
      </div>
      <p className="text-center text-xs text-zinc-400 mt-6">
        ลืมรหัสผ่าน? ติดต่อผู้ดูแลระบบ
      </p>
    </div>
  );
}
