"use client";

// Maid logout button. Mirrors the AdminShell.logout() flow:
//   1) POST /api/auth/logout  → audits + closes the session row server-side
//   2) browserClient().auth.signOut() → clears local Supabase session
//   3) redirect to /login
//
// Bug fix: the profile page previously used `<form action="/logout" method="POST">`,
// but no `/logout` route exists (the real endpoint is `/api/auth/logout`, which
// returns JSON not a redirect). That made the only logout button a dead no-op /
// 404. This client button restores a working logout for the maid surface.
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/db/client";
import { Button } from "@/components/ui/button";
import { LogOut, Loader2 } from "lucide-react";

export function MaidLogoutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onLogout() {
    startTransition(async () => {
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
      const sb = browserClient();
      await sb.auth.signOut().catch(() => {});
      router.refresh();
      router.push("/login");
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={onLogout}
      disabled={pending}
      className="h-14 w-full text-base font-semibold text-rose-700 ring-rose-200 hover:bg-rose-50"
    >
      {pending ? (
        <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
      ) : (
        <LogOut className="mr-2 h-5 w-5" aria-hidden />
      )}
      ออกจากระบบ
    </Button>
  );
}
