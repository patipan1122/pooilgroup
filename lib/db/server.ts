// Server-side Supabase client — used in Server Components, Route Handlers, Actions
// `serverClient()` honors user session (RLS enforced)
// `adminClient()` uses service_role key (bypasses RLS — use only in trusted server code)

import { createServerClient } from "@supabase/ssr";
import { createClient as createSb } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { validateProductionEnv } from "@/lib/env-validate";

// Run env validation on first import — fails-closed in prod if config is bad
validateProductionEnv();

export async function serverClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Components cannot set cookies — proxy.ts handles refresh
          }
        },
      },
    },
  );
}

/**
 * Admin client — bypasses RLS. Use only in:
 *  - Webhook handlers (Telegram/LINE) where there is no user session
 *  - Cron jobs
 *  - Initial onboarding flows
 * NEVER import this in a "use client" file.
 */
export function adminClient() {
  return createSb(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
