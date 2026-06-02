# LedgerLine (`ledger`) — Setup checklist (CEO / ops must provide)

> Created during M0+M1 build (2026-06-02). Items below are stubbed in code with
> `// TODO[ledger-secret]` and do NOT block the build — fill them in to activate.

## 1. Apply the migration
- `supabase db push` (or run `supabase/migrations/20260602190000_ledger_module_init.sql`)
  → creates 6 `ledger_*` tables + RLS + RPC `ledger_next_doc_code` + seeds 12 expense
  categories per active company (incl. JP Sync Group).
- Verify: all 6 tables have `rowsecurity = true`; `ledger_next_doc_code(org, company)`
  returns `EXP-YYYYMM-0001`.

## 2. Company / TRCloud mapping
- Company **JP Sync Group** (`code = JPSYNC`) already exists (seeded by `prisma/seed.ts`).
- Record TRCloud company mapping `trcloud_company_id = 45` in
  `companies.settings` JSON (e.g. `{ "trcloud_company_id": 45 }`) — not enforced by
  migration. The export module (Partition B/`trcloud-export.ts`) reads it.

## 3. Defer-pending-secret (stub + TODO in code — provide to activate)
| Secret | Where it lands | Needed for |
|---|---|---|
| LINE OA channel secret + access token | `ledger_line_channel.webhook_secret_enc` / `access_token_enc` (AES via `lib/recruit/channel-crypto`) | staff photographing receipts in a LINE group |
| `LEDGER_CHANNEL_KEY` env | env var (AES-256-GCM key for the above) | encrypting LINE secrets at rest |
| SlipOK / EasySlip API key | env (Phase 2) | QR slip verification (not OCR) |
| Google OAuth (Drive) | env (Phase 1.5) | storing originals in CEO's 2TB Drive (R2 used until then) |
| TRCloud write API key/endpoint | env (Phase 2/M2) | pushing AP entries into TRCloud |

## 4. AI pricing (done in this build)
- `gemini-3.1-flash-lite` ($0.10/M in · $0.40/M out) added to
  `lib/ai/cost-cap.ts` and `lib/costctrl/pricing.ts`.

## 5. Roles
- staff → capture + edit `draft`
- admin / org_admin / area_manager (accountant) → confirm / lock / budgets / export
- viewer → dashboard read-only · super_admin → everything
- Note: there is no dedicated `accountant` enum value; the confirming accountant
  maps to `admin`/`org_admin`. (`viewer` = read-only per UserRole enum comment.)
