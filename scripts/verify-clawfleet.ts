import { prisma } from "@/lib/prisma";

async function main() {
  const tables = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int as n FROM pg_tables
    WHERE schemaname='public' AND tablename LIKE 'cf_%' AND rowsecurity=true
  `;
  const triggers = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int as n FROM pg_trigger WHERE tgname LIKE 'cf_%'
  `;
  const functions = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int as n FROM pg_proc WHERE proname LIKE 'cf_%'
  `;
  const generated = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int as n FROM information_schema.columns
    WHERE table_name='cf_collection_events' AND is_generated='ALWAYS'
  `;
  const partial = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int as n FROM pg_indexes
    WHERE schemaname='public' AND indexname LIKE 'cf_%' AND indexdef LIKE '%WHERE%'
  `;
  const products = await prisma.cfProduct.count();
  const code = await prisma.$queryRaw<{ code: string }[]>`
    SELECT public.cf_next_session_code((SELECT id FROM organizations WHERE is_active=true LIMIT 1))::text as code
  `;
  console.log(JSON.stringify({
    tables_with_RLS: tables[0]?.n,
    triggers: triggers[0]?.n,
    cf_functions: functions[0]?.n,
    generated_columns: generated[0]?.n,
    seeded_products_total: products,
    partial_unique_indexes: partial[0]?.n,
    sample_session_code: code[0]?.code,
  }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
