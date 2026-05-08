import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Security headers (RULES §21 Layer 2). Applied on every response so
// static assets, API routes, and SSR pages all carry the same hardening.
// CSP is permissive enough to allow LIFF / Supabase / R2 / Recharts /
// inline SVG (Lucide). Tighten when external integrations stabilise.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.line-scdn.net https://*.line.me",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://*.upstash.io https://*.r2.cloudflarestorage.com https://api.telegram.org https://*.line.me wss://*.supabase.co",
  "frame-src 'self' https://liff.line.me https://*.line.me",
  "frame-ancestors 'self' https://liff.line.me",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const ALLOWED_ORIGINS = [
  "https://poolgroup.com",
  "https://www.poolgroup.com",
  "https://liff.line.me",
  "http://localhost:3100",
];

function applySecurityHeaders(headers: Headers) {
  headers.set("Content-Security-Policy", CSP);
  headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload",
  );
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(self), payment=()",
  );
  headers.set("X-XSS-Protection", "0");
}

function applyCors(req: NextRequest, headers: Headers) {
  if (!req.nextUrl.pathname.startsWith("/api/")) return;
  const origin = req.headers.get("origin");
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set(
      "Access-Control-Allow-Methods",
      "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    );
    headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Telegram-Bot-Api-Secret-Token",
    );
    headers.set("Access-Control-Max-Age", "86400");
  }
}

export async function updateSession(request: NextRequest) {
  // CORS preflight short-circuit (don't bother with Supabase for OPTIONS)
  if (
    request.method === "OPTIONS" &&
    request.nextUrl.pathname.startsWith("/api/")
  ) {
    const preflight = new NextResponse(null, { status: 204 });
    applySecurityHeaders(preflight.headers);
    applyCors(request, preflight.headers);
    return preflight;
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  await supabase.auth.getUser();

  applySecurityHeaders(supabaseResponse.headers);
  applyCors(request, supabaseResponse.headers);

  return supabaseResponse;
}
