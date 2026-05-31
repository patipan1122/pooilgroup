"use client";

import { useState, useTransition } from "react";
import {
  actUpsertCredential,
  actDeleteCredential,
  actUpdateBudget,
  actCreateAlertRule,
  actToggleAlertRule,
  actDeleteAlertRule,
  actToggleProvider,
  actPreviewCredential,
} from "../../_actions";
import { formatUsd } from "@/lib/costctrl/pricing";

type Provider = {
  id: string;
  slug: string;
  displayName: string;
  enabled: boolean;
  budgetThisMonth: number;
  budgetDefault: number;
};

type Rule = {
  id: string;
  providerSlug: string;
  providerName: string;
  metric: string;
  thresholdPct: number | null;
  thresholdAbs: number | null;
  channel: string;
  cooldownHours: number;
  enabled: boolean;
};

type Cred = {
  id: string;
  providerSlug: string;
  providerName: string;
  label: string;
  scope: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
};

type EventRow = {
  id: string;
  providerName: string;
  metric: string;
  triggeredAt: string;
  observedValue: number;
  thresholdValue: number;
  message: string;
  notified: boolean;
};

type Tab = "budgets" | "rules" | "creds" | "history";

const TAB_LABEL: Record<Tab, string> = {
  budgets: "งบ/เดือน",
  rules: "เตือน",
  creds: "คีย์ API",
  history: "ประวัติเตือน",
};

export function AlertsPanels(props: {
  providers: Provider[];
  rules: Rule[];
  creds: Cred[];
  events: EventRow[];
  ymKey: string;
  formatUsd?: (n: number) => string; // unused (server passed for back-compat)
}) {
  const [tab, setTab] = useState<Tab>("budgets");
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="ตั้งค่า" className="flex flex-wrap gap-1 ring-1 ring-zinc-200 bg-zinc-50 p-1 rounded-xl text-sm">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg ${tab === t ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900"}`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === "budgets" && <BudgetsPanel providers={props.providers} ymKey={props.ymKey} />}
      {tab === "rules" && <RulesPanel providers={props.providers} rules={props.rules} />}
      {tab === "creds" && <CredsPanel providers={props.providers} creds={props.creds} />}
      {tab === "history" && <HistoryPanel events={props.events} />}
    </div>
  );
}

function BudgetsPanel({ providers, ymKey }: { providers: Provider[]; ymKey: string }) {
  return (
    <div className="rounded-xl ring-1 ring-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-zinc-900 mb-3">งบรายเดือนต่อ Provider · {ymKey}</h2>
      <p className="text-xs text-zinc-500 mb-4">ตั้งค่าเฉพาะเดือนนี้ หรือ default (ใช้กับทุกเดือนที่ยังไม่ได้ตั้ง) · เกินงบ → เตือนทาง LINE</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {providers.map((p) => (
          <BudgetRow key={p.id} provider={p} ymKey={ymKey} />
        ))}
      </div>
    </div>
  );
}

function BudgetRow({ provider, ymKey }: { provider: Provider; ymKey: string }) {
  const [pending, start] = useTransition();
  const [thisMonth, setThisMonth] = useState(String(provider.budgetThisMonth));
  const [def, setDef] = useState(String(provider.budgetDefault));
  return (
    <div className="rounded-lg ring-1 ring-zinc-200 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-zinc-900">{provider.displayName}</p>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await actToggleProvider(provider.slug, !provider.enabled);
            })
          }
          className={`text-[11px] px-2 py-0.5 rounded-full ring-1 ${provider.enabled ? "bg-emerald-50 ring-emerald-200 text-emerald-700" : "bg-zinc-100 ring-zinc-200 text-zinc-500"}`}
        >
          {provider.enabled ? "เปิด" : "ปิด"}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <label>
          <span className="text-zinc-500">{ymKey} (USD)</span>
          <input
            type="number"
            min={0}
            step="0.5"
            value={thisMonth}
            onChange={(e) => setThisMonth(e.target.value)}
            className="block w-full mt-1 px-2 py-1 rounded ring-1 ring-zinc-200 focus:ring-blue-300 outline-none"
          />
        </label>
        <label>
          <span className="text-zinc-500">default (USD)</span>
          <input
            type="number"
            min={0}
            step="0.5"
            value={def}
            onChange={(e) => setDef(e.target.value)}
            className="block w-full mt-1 px-2 py-1 rounded ring-1 ring-zinc-200 focus:ring-blue-300 outline-none"
          />
        </label>
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await actUpdateBudget({ providerSlug: provider.slug, ymKey, budgetUsd: Number(thisMonth) || 0 });
            await actUpdateBudget({ providerSlug: provider.slug, ymKey: "default", budgetUsd: Number(def) || 0 });
          })
        }
        className="w-full h-8 rounded bg-zinc-900 text-white text-xs font-medium hover:bg-zinc-800 disabled:opacity-50"
      >
        {pending ? "กำลังบันทึก..." : "บันทึก"}
      </button>
    </div>
  );
}

function RulesPanel({ providers, rules }: { providers: Provider[]; rules: Rule[] }) {
  const [pending, start] = useTransition();
  const [providerSlug, setProvider] = useState(providers[0]?.slug ?? "");
  const [metric, setMetric] = useState("cost_usd");
  const [thresholdPct, setPct] = useState("80");
  const [thresholdAbs, setAbs] = useState("");
  const [cooldown, setCooldown] = useState("24");

  return (
    <div className="space-y-4">
      <div className="rounded-xl ring-1 ring-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900 mb-3">เพิ่ม rule</h2>
        <div className="grid gap-2 sm:grid-cols-5">
          <select value={providerSlug} onChange={(e) => setProvider(e.target.value)} className="h-9 px-2 rounded ring-1 ring-zinc-200 text-sm">
            {providers.map((p) => <option key={p.slug} value={p.slug}>{p.displayName}</option>)}
          </select>
          <input value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="metric เช่น cost_usd" className="h-9 px-2 rounded ring-1 ring-zinc-200 text-sm" />
          <input value={thresholdPct} onChange={(e) => setPct(e.target.value)} placeholder="% ของ budget" inputMode="decimal" className="h-9 px-2 rounded ring-1 ring-zinc-200 text-sm" />
          <input value={thresholdAbs} onChange={(e) => setAbs(e.target.value)} placeholder="หรือ ค่าตรง" inputMode="decimal" className="h-9 px-2 rounded ring-1 ring-zinc-200 text-sm" />
          <input value={cooldown} onChange={(e) => setCooldown(e.target.value)} placeholder="cooldown ชม." inputMode="numeric" className="h-9 px-2 rounded ring-1 ring-zinc-200 text-sm" />
        </div>
        <button
          type="button"
          disabled={pending || !providerSlug}
          onClick={() =>
            start(async () => {
              await actCreateAlertRule({
                providerSlug,
                metric,
                thresholdPct: thresholdPct ? Number(thresholdPct) : null,
                thresholdAbs: thresholdAbs ? Number(thresholdAbs) : null,
                cooldownHours: Number(cooldown) || 24,
              });
              setPct("80");
              setAbs("");
            })
          }
          className="mt-3 h-9 px-4 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
        >
          เพิ่ม rule
        </button>
      </div>

      <div className="rounded-xl ring-1 ring-zinc-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50 text-zinc-600 text-xs">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Provider</th>
              <th className="text-left px-3 py-2 font-medium">Metric</th>
              <th className="text-right px-3 py-2 font-medium">Threshold</th>
              <th className="text-right px-3 py-2 font-medium">Cooldown</th>
              <th className="text-center px-3 py-2 font-medium">เปิด</th>
              <th className="text-right px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rules.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">{r.providerName}</td>
                <td className="px-3 py-2 text-zinc-600">{r.metric}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {r.thresholdPct != null ? `${r.thresholdPct}%` : r.thresholdAbs != null ? r.thresholdAbs.toFixed(2) : "—"}
                </td>
                <td className="px-3 py-2 text-right text-zinc-500">{r.cooldownHours}h</td>
                <td className="px-3 py-2 text-center">
                  <button
                    type="button"
                    onClick={() => start(async () => { await actToggleAlertRule(r.id, !r.enabled); })}
                    className={`text-[11px] px-2 py-0.5 rounded-full ring-1 ${r.enabled ? "bg-emerald-50 ring-emerald-200 text-emerald-700" : "bg-zinc-100 ring-zinc-200 text-zinc-500"}`}
                  >
                    {r.enabled ? "เปิด" : "ปิด"}
                  </button>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => start(async () => { if (confirm("ลบ rule นี้?")) await actDeleteAlertRule(r.id); })}
                    className="text-xs text-rose-600 hover:underline"
                  >
                    ลบ
                  </button>
                </td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-zinc-500 text-sm">ยังไม่มี rule</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CredsPanel({ providers, creds }: { providers: Provider[]; creds: Cred[] }) {
  const [pending, start] = useTransition();
  const [providerSlug, setProvider] = useState("vercel");
  const [label, setLabel] = useState("pooil-vercel");
  const [payload, setPayload] = useState("");
  const [scope, setScope] = useState("");
  const [previewedId, setPreviewedId] = useState<string | null>(null);
  const [previewMasked, setPreviewMasked] = useState<string>("");

  const placeholderByProvider: Record<string, string> = {
    vercel: '{"token":"…","teamId":"team_…"}',
    supabase: '{"token":"…","projectRef":"abcxyz"}',
    r2: '{"token":"…","accountId":"…","bucket":"pooil"}',
    anthropic: "(no token needed — reads from ai_usage)",
    gemini: "(no token needed — reads from ai_usage)",
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl ring-1 ring-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900 mb-3">เพิ่ม / อัปเดต API Key</h2>
        <div className="grid gap-2 sm:grid-cols-4">
          <select value={providerSlug} onChange={(e) => setProvider(e.target.value)} className="h-9 px-2 rounded ring-1 ring-zinc-200 text-sm">
            {providers.map((p) => <option key={p.slug} value={p.slug}>{p.displayName}</option>)}
          </select>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="label เช่น pooil-vercel" className="h-9 px-2 rounded ring-1 ring-zinc-200 text-sm" />
          <input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="(optional scope)" className="h-9 px-2 rounded ring-1 ring-zinc-200 text-sm" />
          <button
            type="button"
            disabled={pending || !payload}
            onClick={() =>
              start(async () => {
                await actUpsertCredential({ providerSlug, label, payload, scope: scope || undefined });
                setPayload("");
              })
            }
            className="h-9 px-3 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            บันทึก (encrypt)
          </button>
        </div>
        <textarea
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          rows={3}
          placeholder={placeholderByProvider[providerSlug] ?? "JSON or raw token"}
          className="mt-2 w-full px-3 py-2 rounded ring-1 ring-zinc-200 text-sm font-mono"
        />
        <p className="text-xs text-zinc-500 mt-2">ใส่ JSON {"{token, teamId/projectRef/accountId, …}"} หรือ token ดิบก็ได้ · เก็บใน DB เป็น ciphertext เท่านั้น</p>
      </div>

      <div className="rounded-xl ring-1 ring-zinc-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50 text-zinc-600 text-xs">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Provider</th>
              <th className="text-left px-3 py-2 font-medium">Label</th>
              <th className="text-left px-3 py-2 font-medium">Scope</th>
              <th className="text-left px-3 py-2 font-medium">ใช้ล่าสุด</th>
              <th className="text-left px-3 py-2 font-medium">สถานะ</th>
              <th className="text-right px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {creds.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2">{c.providerName}</td>
                <td className="px-3 py-2 font-mono text-xs">{c.label}</td>
                <td className="px-3 py-2 text-zinc-500 text-xs">{c.scope ?? "—"}</td>
                <td className="px-3 py-2 text-zinc-500 text-xs">{c.lastUsedAt ?? "—"}</td>
                <td className={`px-3 py-2 text-xs ${c.lastError ? "text-rose-600" : "text-emerald-600"}`}>
                  {c.lastError ? `error: ${c.lastError.slice(0, 50)}` : "ok"}
                </td>
                <td className="px-3 py-2 text-right space-x-3 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      start(async () => {
                        const r = await actPreviewCredential(c.id);
                        setPreviewedId(c.id);
                        setPreviewMasked(r.masked);
                      })
                    }
                    className="text-blue-600 hover:underline"
                  >
                    ดู
                  </button>
                  <button
                    type="button"
                    onClick={() => start(async () => { if (confirm("ลบคีย์นี้?")) await actDeleteCredential(c.id); })}
                    className="text-rose-600 hover:underline"
                  >
                    ลบ
                  </button>
                </td>
              </tr>
            ))}
            {creds.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-zinc-500 text-sm">ยังไม่มีคีย์</td></tr>
            )}
          </tbody>
        </table>
        {previewedId && (
          <pre className="text-xs font-mono bg-zinc-900 text-zinc-100 p-3 rounded-b-xl whitespace-pre-wrap break-all">
            {previewMasked}
          </pre>
        )}
      </div>
    </div>
  );
}

function HistoryPanel({ events }: { events: EventRow[] }) {
  return (
    <div className="rounded-xl ring-1 ring-zinc-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-zinc-50 text-zinc-600 text-xs">
          <tr>
            <th className="text-left px-3 py-2 font-medium">เวลา</th>
            <th className="text-left px-3 py-2 font-medium">Provider</th>
            <th className="text-left px-3 py-2 font-medium">Metric</th>
            <th className="text-right px-3 py-2 font-medium">Observed</th>
            <th className="text-right px-3 py-2 font-medium">Threshold</th>
            <th className="text-center px-3 py-2 font-medium">LINE</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {events.map((e) => (
            <tr key={e.id}>
              <td className="px-3 py-2 text-xs text-zinc-500">{e.triggeredAt}</td>
              <td className="px-3 py-2">{e.providerName}</td>
              <td className="px-3 py-2 text-zinc-600">{e.metric}</td>
              <td className="px-3 py-2 text-right font-mono">{formatUsd(e.observedValue)}</td>
              <td className="px-3 py-2 text-right font-mono">{formatUsd(e.thresholdValue)}</td>
              <td className="px-3 py-2 text-center text-xs">
                <span className={e.notified ? "text-emerald-600" : "text-zinc-400"}>{e.notified ? "✓" : "—"}</span>
              </td>
            </tr>
          ))}
          {events.length === 0 && (
            <tr><td colSpan={6} className="px-3 py-4 text-center text-zinc-500 text-sm">ยังไม่เคยเตือน</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
