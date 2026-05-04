export default function LiffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-zinc-50 flex flex-col">{children}</div>;
}
