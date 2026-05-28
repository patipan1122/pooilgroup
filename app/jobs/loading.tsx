export default function Loading() {
  return (
    <div className="min-h-screen bg-zinc-50 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8 animate-pulse">
          <div className="size-14 mx-auto rounded-2xl bg-zinc-200" />
          <div className="h-7 w-48 mx-auto bg-zinc-200 rounded-md mt-4" />
          <div className="h-4 w-32 mx-auto bg-zinc-100 rounded-md mt-3" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white rounded-2xl border-2 border-zinc-200 p-5 animate-pulse"
            >
              <div className="flex gap-3">
                <div className="size-10 rounded-xl bg-zinc-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-zinc-200 rounded w-1/2" />
                  <div className="h-3 bg-zinc-100 rounded w-1/3" />
                  <div className="h-3 bg-zinc-100 rounded w-full mt-2" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
