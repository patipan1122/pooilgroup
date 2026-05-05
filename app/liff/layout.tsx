import { getSession } from "@/lib/auth/session";
import { LiffBootstrap } from "./liff-bootstrap";

export default async function LiffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col">
      <LiffBootstrap haveSession={!!session} />
      {children}
    </div>
  );
}
