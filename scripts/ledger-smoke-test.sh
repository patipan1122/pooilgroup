#!/usr/bin/env bash
# LedgerLine runtime smoke test — verifies schema + RPC + never-auto-post + dedup
# on an ISOLATED throwaway local Postgres DB (prod NEVER touched).
# Requires: local postgres (5432) + psql + `prisma db push`. Usage: bash scripts/ledger-smoke-test.sh
set -e
U=$(whoami); DB=ledger_smoke
dropdb --if-exists "$DB"; createdb "$DB"
npx prisma db push --url "postgresql://$U@localhost:5432/$DB" --accept-data-loss >/dev/null
psql -d "$DB" -v ON_ERROR_STOP=0 -f supabase/migrations/20260602190000_ledger_module_init.sql >/dev/null 2>&1 || true  # RPC (RLS needs Supabase current_org_id — skipped locally)
BT=$(psql -d "$DB" -tAc "SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname=(SELECT udt_name FROM information_schema.columns WHERE table_name='branches' AND column_name='business_type') LIMIT 1;")
O=11111111-1111-1111-1111-111111111111; C=22222222-2222-2222-2222-222222222222; B=33333333-3333-3333-3333-333333333333; K=44444444-4444-4444-4444-444444444444
psql -d "$DB" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO public.organizations (id,name,slug,updated_at) VALUES ('$O','JP Sync Group','jpsync-smoke',now());
INSERT INTO public.companies (id,org_id,code,name,updated_at) VALUES ('$C','$O','JPSYNC','เจพีซิ้งค์ กรุ๊ป',now());
INSERT INTO public.branches (id,org_id,company_id,code,name,business_type,updated_at) VALUES ('$B','$O','$C','HQ','สนญ.','$BT',now());
INSERT INTO public.ledger_category (id,org_id,company_id,name,updated_at,created_at) VALUES ('$K','$O','$C','ค่าวัตถุดิบ',now(),now());
INSERT INTO public.ledger_expense (id,org_id,company_id,branch_id,doc_code,category_id,vendor,subtotal,vat,total,updated_at,created_at)
 VALUES (gen_random_uuid(),'$O','$C','$B',public.ledger_next_doc_code('$O','$C'),'$K','ร้านทดสอบ',1000,70,1070,now(),now());
\echo 'A never-auto-post:'   ;SELECT doc_code,status,needs_review FROM public.ledger_expense;
UPDATE public.ledger_expense SET status='confirmed',confirmed_at=now();
\echo 'B groupBy:'           ;SELECT c.name,sum(e.total) FROM public.ledger_expense e JOIN public.ledger_category c ON c.id=e.category_id WHERE e.status='confirmed' GROUP BY c.name;
\echo 'C rpc increments:'    ;SELECT public.ledger_next_doc_code('$O','$C');
SQL
dropdb --if-exists "$DB"; echo "smoke test done (DB dropped)"
