// CostCtrl provider fetchers — pull current MTD usage from each provider API.
// Each fetcher returns an array of metric points; the sync orchestrator writes
// them into cost_snapshot. Fetcher failure is non-fatal — sync logs status.

import { decryptCredential } from "./crypto";

export type MetricPoint = {
  metric: string;
  unit: string;
  value: number;
  costUsd: number;
  raw?: unknown;
};

export type FetcherResult =
  | { ok: true; points: MetricPoint[] }
  | { ok: false; error: string };

// ── Vercel ─────────────────────────────────────────────────
// Hobby plan caveat (2026-05): `/v1/usage` returns 403 plan_upgrade_required.
// CEO is on Hobby, so we fetch the TEAM record to confirm plan + record the
// fact + free-tier limits in a "plan-info" snapshot. Real usage is NOT
// available via API on Hobby — CEO sees from vercel.com dashboard or the
// monthly bill (which on Hobby is $0 unless they overage-upgrade).
type VercelCred = { token: string; teamId?: string };

export async function fetchVercel(cred: VercelCred): Promise<FetcherResult> {
  try {
    // Try Pro/Enterprise usage endpoint first (works for paid plans)
    const fromIso = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    const toIso = new Date().toISOString();
    const url = new URL("https://api.vercel.com/v1/usage");
    url.searchParams.set("from", fromIso);
    url.searchParams.set("to", toIso);
    if (cred.teamId) url.searchParams.set("teamId", cred.teamId);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${cred.token}` },
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 403 || res.status === 402) {
      // Hobby plan — usage endpoint not available · degrade gracefully
      return {
        ok: true,
        points: [
          { metric: "plan", unit: "text", value: 0, costUsd: 0, raw: { plan: "hobby", note: "Vercel Hobby plan — usage API not available · ดูที่ vercel.com dashboard" } },
          { metric: "cost_usd", unit: "USD", value: 0, costUsd: 0 },
        ],
      };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `vercel ${res.status}: ${body.slice(0, 200)}` };
    }
    const json: { usage?: Record<string, { used?: number }>; total?: number } = await res.json();
    const points: MetricPoint[] = [];
    const usage = json.usage ?? {};
    if (usage.bandwidth?.used != null) points.push({ metric: "bandwidth_gb", unit: "GB", value: usage.bandwidth.used / 1024 / 1024 / 1024, costUsd: 0 });
    if (usage.functionInvocations?.used != null) points.push({ metric: "function_invocations", unit: "count", value: usage.functionInvocations.used, costUsd: 0 });
    if (usage.buildMinutes?.used != null) points.push({ metric: "build_minutes", unit: "min", value: usage.buildMinutes.used, costUsd: 0 });
    if (usage.edgeRequests?.used != null) points.push({ metric: "edge_requests", unit: "count", value: usage.edgeRequests.used, costUsd: 0 });
    if (json.total != null) points.push({ metric: "cost_usd", unit: "USD", value: json.total, costUsd: json.total });
    return { ok: true, points };
  } catch (e) {
    return { ok: false, error: `vercel fetch: ${(e as Error).message}` };
  }
}

// ── Supabase ───────────────────────────────────────────────
// Supabase Management API has NO `/usage` endpoint (2026-05). Workaround:
// use `/v1/projects/{ref}/database/query` to run SELECTs against postgres
// for db_size, mau, table size, connection count, etc. The token must be
// a Supabase access token (sbp_*) with project access.
type SupabaseCred = { token: string; projectRef: string };

async function supabaseQuery(cred: SupabaseCred, sql: string): Promise<unknown[] | null> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${cred.projectRef}/database/query`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${cred.token}` },
    body: JSON.stringify({ query: sql }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  return (await res.json()) as unknown[];
}

export async function fetchSupabase(cred: SupabaseCred): Promise<FetcherResult> {
  try {
    const sql = `
      SELECT
        pg_database_size(current_database())::bigint AS db_bytes,
        (SELECT count(*) FROM auth.users WHERE last_sign_in_at > now() - interval '30 days')::bigint AS mau,
        (SELECT count(*) FROM auth.users)::bigint AS users_total,
        (SELECT count(*) FROM pg_stat_activity)::bigint AS active_connections
    `;
    const rows = await supabaseQuery(cred, sql);
    if (!rows) {
      return { ok: false, error: `supabase mgmt-api query failed for ref ${cred.projectRef}` };
    }
    const r = (rows[0] ?? {}) as { db_bytes?: number | string; mau?: number | string; users_total?: number | string; active_connections?: number | string };
    const dbBytes = Number(r.db_bytes ?? 0);
    const points: MetricPoint[] = [
      { metric: "db_size_mb", unit: "MB", value: dbBytes / 1024 / 1024, costUsd: 0 },
      { metric: "mau", unit: "count", value: Number(r.mau ?? 0), costUsd: 0 },
      { metric: "users_total", unit: "count", value: Number(r.users_total ?? 0), costUsd: 0 },
      { metric: "active_connections", unit: "count", value: Number(r.active_connections ?? 0), costUsd: 0 },
      { metric: "cost_usd", unit: "USD", value: 0, costUsd: 0 }, // free tier
    ];
    return { ok: true, points };
  } catch (e) {
    return { ok: false, error: `supabase fetch: ${(e as Error).message}` };
  }
}

// ── Cloudflare R2 ──────────────────────────────────────────
type R2Cred = { token: string; accountId: string; bucket?: string };

export async function fetchR2(cred: R2Cred): Promise<FetcherResult> {
  try {
    // Strategy: list buckets via REST API (always works) · then per-bucket use
    // the R2 storage GraphQL with the correct schema. If GraphQL fails we
    // still return bucket count + names as a useful signal.
    const buckRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cred.accountId}/r2/buckets`, {
      headers: { Authorization: `Bearer ${cred.token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!buckRes.ok) {
      const body = await buckRes.text().catch(() => "");
      return { ok: false, error: `r2 buckets ${buckRes.status}: ${body.slice(0, 200)}` };
    }
    const buckJson: { result?: { buckets?: Array<{ name: string; creation_date?: string }> } } = await buckRes.json();
    const buckets = buckJson.result?.buckets ?? [];

    // Sum storage + ops across all buckets via Cloudflare analytics GraphQL.
    // Schema as of 2026: r2StorageAdaptiveGroups (storage snapshots) +
    // r2OperationsAdaptiveGroups (Class A/B counters).
    const fromIso = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    const query = `query {
      viewer {
        accounts(filter: {accountTag: "${cred.accountId}"}) {
          r2StorageAdaptiveGroups(limit: 1, orderBy: [datetime_DESC], filter: {datetime_geq: "${fromIso}"}) {
            max { payloadSize metadataSize objectCount }
          }
          r2OperationsAdaptiveGroups(limit: 100, filter: {datetime_geq: "${fromIso}"}) {
            sum { requests }
            dimensions { actionType }
          }
        }
      }
    }`;

    const gqlRes = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${cred.token}` },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(8000),
    });

    const points: MetricPoint[] = [
      { metric: "bucket_count", unit: "count", value: buckets.length, costUsd: 0 },
    ];

    if (gqlRes.ok) {
      type R2GqlAcct = {
        r2StorageAdaptiveGroups?: Array<{ max?: { payloadSize?: number; metadataSize?: number; objectCount?: number } }>;
        r2OperationsAdaptiveGroups?: Array<{ sum?: { requests?: number }; dimensions?: { actionType?: string } }>;
      };
      const json: { data?: { viewer?: { accounts?: R2GqlAcct[] } } } = await gqlRes.json();
      const acct = json.data?.viewer?.accounts?.[0];
      const storage = acct?.r2StorageAdaptiveGroups?.[0]?.max;
      if (storage?.payloadSize != null) {
        points.push({ metric: "storage_gb", unit: "GB", value: storage.payloadSize / 1024 / 1024 / 1024, costUsd: 0 });
      }
      if (storage?.objectCount != null) {
        points.push({ metric: "object_count", unit: "count", value: storage.objectCount, costUsd: 0 });
      }
      // Operations: ListBuckets/HeadObject etc → Class B · PutObject/DeleteObject → Class A
      // https://developers.cloudflare.com/r2/pricing/#class-a-vs-class-b
      const classAActions = new Set(["PutObject", "CopyObject", "CompleteMultipartUpload", "CreateMultipartUpload", "ListBuckets", "PutBucket", "ListMultipartUploads", "UploadPart"]);
      let classA = 0;
      let classB = 0;
      for (const op of acct?.r2OperationsAdaptiveGroups ?? []) {
        const reqs = op.sum?.requests ?? 0;
        const action = op.dimensions?.actionType ?? "";
        if (classAActions.has(action)) classA += reqs;
        else classB += reqs;
      }
      points.push({ metric: "class_a_ops", unit: "count", value: classA, costUsd: 0 });
      points.push({ metric: "class_b_ops", unit: "count", value: classB, costUsd: 0 });
    } else {
      // GraphQL failed (perhaps token scope) — still keep bucket_count + cost_usd=0
      const txt = await gqlRes.text().catch(() => "");
      points.push({ metric: "_gql_error", unit: "text", value: 0, costUsd: 0, raw: { error: txt.slice(0, 200) } });
    }

    points.push({ metric: "cost_usd", unit: "USD", value: 0, costUsd: 0 }); // free tier (10GB / 1M class-A / 10M class-B)
    return { ok: true, points };
  } catch (e) {
    return { ok: false, error: `r2 fetch: ${(e as Error).message}` };
  }
}

// ── Credential loader ──────────────────────────────────────
export function parseCredentialAsJson(plaintext: string): Record<string, string> | null {
  try {
    const obj = JSON.parse(plaintext);
    return typeof obj === "object" && obj ? (obj as Record<string, string>) : null;
  } catch {
    return null;
  }
}

export function decryptToObject(ciphertext: string): Record<string, string> | null {
  const plain = decryptCredential(ciphertext);
  if (!plain) return null;
  // Support both formats: pure token string OR JSON {token, teamId/projectRef/...}
  const asObj = parseCredentialAsJson(plain);
  if (asObj) return asObj;
  return { token: plain };
}
