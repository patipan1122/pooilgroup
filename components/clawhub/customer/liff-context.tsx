"use client";

// ClawHub customer LIFF context — one place that boots LIFF (clawhub channel), grabs
// the profile + id_token, and loads the member summary. Screens read everything from
// useClawhub(). The id_token lives in memory and is POSTed on every write (server
// re-verifies it — W-014: we never trust a client-held member id / cookie).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  getClawhubProfile,
  getClawhubIdToken,
  clawhubLiffError,
} from "@/lib/clawhub/liff-customer";
import { liffIdForModule } from "@/lib/line/channels";
import type { MemberSummary } from "@/lib/clawhub/customer-data";

export type LiffProfileLite = {
  userId: string;
  displayName: string;
  pictureUrl?: string;
};

type Phase = "loading" | "ready" | "error";

export type ClawhubCtx = {
  phase: Phase;
  error: string | null;
  profile: LiffProfileLite | null;
  member: MemberSummary | null;
  /** Get the (cached) LIFF id_token for a write. Null only if LIFF never logged in. */
  getIdToken: () => Promise<string | null>;
  /** Re-pull the member summary from the server (after a refund / redeem). */
  refreshMember: () => Promise<void>;
  /** Optimistically replace the member summary (e.g. server returned a fresh balance). */
  setMember: (m: MemberSummary) => void;
};

const Ctx = createContext<ClawhubCtx | null>(null);

export function useClawhub(): ClawhubCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useClawhub must be used inside <ClawhubProvider>");
  return v;
}

export function ClawhubProvider({ children }: { children: React.ReactNode }) {
  const liffId = liffIdForModule("clawhub");
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<LiffProfileLite | null>(null);
  const [member, setMember] = useState<MemberSummary | null>(null);
  const idTokenRef = useRef<string | null>(null);

  const getIdToken = useCallback(async (): Promise<string | null> => {
    if (idTokenRef.current) return idTokenRef.current;
    const t = await getClawhubIdToken(liffId);
    if (t) idTokenRef.current = t;
    return t;
  }, [liffId]);

  const loadMember = useCallback(async (): Promise<MemberSummary | null> => {
    const idToken = await getIdToken();
    if (!idToken) return null;
    const res = await fetch("/api/clawhub/member", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      member?: MemberSummary;
    };
    return json.ok && json.member ? json.member : null;
  }, [getIdToken]);

  const refreshMember = useCallback(async () => {
    const m = await loadMember();
    if (m) setMember(m);
  }, [loadMember]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // getLiffProfile triggers liff.login() inside the LINE webview if needed.
      const p = await getClawhubProfile(liffId);
      if (cancelled) return;
      if (!p) {
        // Not in LINE / not logged in / init failed → surface a calm error.
        const initErr = clawhubLiffError();
        setError(
          initErr
            ? `เปิดผ่านแอป LINE เท่านั้น (${initErr})`
            : "กรุณาเปิดหน้านี้ผ่านแอป LINE",
        );
        setPhase("error");
        return;
      }
      setProfile({
        userId: p.userId,
        displayName: p.displayName,
        pictureUrl: p.pictureUrl,
      });
      // Prime the id_token + member summary (auto-creates the member on the server).
      const m = await loadMember();
      if (cancelled) return;
      if (m) setMember(m);
      setPhase("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [liffId, loadMember]);

  const value: ClawhubCtx = {
    phase,
    error,
    profile,
    member,
    getIdToken,
    refreshMember,
    setMember,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
