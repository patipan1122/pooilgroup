export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-white relative">
      {/* radial blue glow */}
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div
          className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full opacity-30 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, oklch(0.50 0.28 263) 0%, transparent 65%)",
          }}
        />
        {/* dot grid background */}
        <div className="absolute inset-0 bg-grid-dots opacity-50" />
      </div>
      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        {children}
      </main>
      <footer className="text-center text-xs text-zinc-400 pb-6 relative z-10">
        Pool Group ERP · v0.1
      </footer>
    </div>
  );
}
