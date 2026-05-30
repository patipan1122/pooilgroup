// Client-side Supabase — for "use client" components only
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Cache the client at the module level so every call returns the same socket.
// Without this, hooks that call browserClient() inside useEffect (e.g. the
// inbox realtime hook) would mint a fresh WebSocket per remount — leaky
// under React StrictMode + when the effect's deps change (audit RT-004).
let cached: SupabaseClient | null = null;

export function browserClient(): SupabaseClient {
  if (cached) return cached;
  cached = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return cached;
}
