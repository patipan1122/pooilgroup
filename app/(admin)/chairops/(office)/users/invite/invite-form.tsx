"use client";

// Admin "เชิญแม่บ้าน" — name + branch → one-tap LINE onboarding link.
// Maid taps the link → LINE login → auto-bound + logged in (no LINE-ID copy,
// no email). See createMaidInvite + /api/auth/line-login `invite` path.
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Copy, Link2, UserPlus } from "lucide-react";
import { createMaidInvite } from "@/app/(admin)/chairops/users/actions";

interface Branch {
  id: string;
  name: string;
}

export function InviteMaidForm({ branches }: { branches: ReadonlyArray<Branch> }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ link: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  if (result) {
    return (
      <div className="space-y-4 rounded-2xl border-2 border-emerald-200 bg-emerald-50/50 p-5">
        <div className="flex items-center gap-2 text-emerald-800">
          <Check className="size-5" aria-hidden />
          <span className="font-semibold">สร้างลิงก์เชิญ {result.name} แล้ว</span>
        </div>
        <p className="text-sm text-zinc-600">
          ส่งลิงก์นี้ให้แม่บ้านทาง LINE → เขากดเปิด → ล็อกอิน LINE → เข้าใช้งานได้เลย
        </p>
        <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white p-2.5">
          <Link2 className="size-4 shrink-0 text-zinc-400" aria-hidden />
          <span className="min-w-0 grow truncate font-mono text-xs text-zinc-700">
            {result.link}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => {
              void navigator.clipboard?.writeText(result.link);
              setCopied(true);
              toast.success("คัดลอกลิงก์แล้ว");
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? (
              <>
                <Check className="mr-1.5 size-4" /> คัดลอกแล้ว
              </>
            ) : (
              <>
                <Copy className="mr-1.5 size-4" /> คัดลอกลิงก์
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => {
              setResult(null);
              setCopied(false);
            }}
          >
            <UserPlus className="mr-1.5 size-4" /> เชิญอีกคน
          </Button>
        </div>
        <p className="text-[11px] text-zinc-500">
          ลิงก์มีอายุ 14 วัน · ผูกได้คนเดียว (คนแรกที่กดล็อกอิน)
        </p>
      </div>
    );
  }

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const r = await createMaidInvite(fd);
          if (r.ok && r.data) {
            setResult({
              link: r.data.link,
              name: String(fd.get("displayName") ?? "แม่บ้าน"),
            });
          } else {
            toast.error(r.ok ? "สร้างลิงก์ไม่สำเร็จ" : r.error);
          }
        })
      }
      className="space-y-4 rounded-2xl border-2 border-zinc-200 bg-white p-5 shadow-soft"
    >
      <div className="space-y-1.5">
        <label htmlFor="inv-name" className="text-sm font-semibold text-zinc-800">
          ชื่อแม่บ้าน
        </label>
        <Input
          id="inv-name"
          name="displayName"
          placeholder="เช่น พี่นิด สาขาโรบินสัน"
          required
          maxLength={100}
          disabled={isPending}
          className="h-11"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="inv-branch" className="text-sm font-semibold text-zinc-800">
          สาขาที่ดูแล
        </label>
        <select
          id="inv-branch"
          name="primaryBranchId"
          required
          disabled={isPending || branches.length === 0}
          defaultValue=""
          className="h-11 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm focus:border-zinc-500 focus:outline-none disabled:bg-zinc-100"
        >
          <option value="" disabled>
            — เลือกสาขา —
          </option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="h-12 w-full"
        loading={isPending}
        disabled={isPending || branches.length === 0}
      >
        <Link2 className="mr-2 size-5" aria-hidden /> สร้างลิงก์เชิญ
      </Button>
      {branches.length === 0 && (
        <p className="text-xs text-amber-700">ยังไม่มีสาขา · สร้างสาขาก่อน</p>
      )}
    </form>
  );
}
