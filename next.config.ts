import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "date-fns",
      "date-fns-tz",
      "sonner",
      "@radix-ui/react-icons",
    ],
  },
};

// Sentry v10 + Next 16 (Turbopack):
// - `disableLogger`, `automaticVercelMonitors`, `reactComponentAnnotation`
//   are webpack-only options that are no-ops under Turbopack. Removed to
//   silence deprecation warnings.
// - Source-map upload still works via SENTRY_AUTH_TOKEN env var.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
