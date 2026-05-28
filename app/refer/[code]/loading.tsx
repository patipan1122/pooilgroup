export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-purple-50 to-white">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center animate-pulse">
        <div className="size-16 mx-auto rounded-2xl bg-zinc-200" />
        <div className="h-6 w-3/4 mx-auto bg-zinc-200 rounded mt-5" />
        <div className="h-4 w-full bg-zinc-100 rounded mt-3" />
        <div className="h-12 w-full bg-zinc-200 rounded mt-8" />
      </div>
    </div>
  );
}
