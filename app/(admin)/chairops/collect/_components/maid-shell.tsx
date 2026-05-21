// Shared maid-PWA shell · imported by /collect, /cleanliness, /damage/new layouts.
// One source of truth for the bottom nav so all 4 maid surfaces stay consistent.
import Link from "next/link";
import { Wallet, Sparkles, Wrench, LogOut } from "lucide-react";

const NAV = [
  { href: "/chairops/collect", label: "เก็บเงิน", icon: Wallet },
  { href: "/chairops/cleanliness", label: "ความสะอาด", icon: Sparkles },
  { href: "/chairops/damage/new", label: "แจ้งซ่อม", icon: Wrench },
  { href: "/logout", label: "ออก", icon: LogOut },
];

export function MaidShell({
  displayName,
  children,
}: {
  displayName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-muted/30 pb-[calc(72px+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex h-12 items-center gap-2 px-4">
          <span className="text-base font-bold tracking-tight">ChairOps</span>
          <span className="ml-auto text-xs text-muted-foreground">{displayName}</span>
        </div>
      </header>

      <main className="mx-auto max-w-md px-3 py-4">{children}</main>

      <nav
        aria-label="เมนูหลัก"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="mx-auto grid max-w-md grid-cols-4">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.href} className="flex">
                <Link
                  href={item.href}
                  className="flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted active:bg-muted/80"
                >
                  <Icon className="h-5 w-5" aria-hidden />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
