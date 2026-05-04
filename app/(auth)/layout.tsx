export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-zinc-50">
      {/* subtle background accent */}
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full opacity-20 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, oklch(0.55 0.16 165) 0%, transparent 70%)",
          }}
        />
      </div>
      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        {children}
      </main>
      <footer className="text-center text-xs text-zinc-400 pb-6">
        Pool Group ERP · v0.1
      </footer>
    </div>
  );
}
