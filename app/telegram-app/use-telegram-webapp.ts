"use client";

// Thin typed wrapper around `window.Telegram.WebApp` — the Telegram Mini
// App JS SDK (loaded via <Script src="https://telegram.org/js/telegram-web-app.js?64">
// in app/telegram-app/page.tsx). Every access to `window.Telegram` goes
// through here so the rest of the Mini App never has to re-guard for "is
// this running inside Telegram at all" — outside Telegram (e.g. a plain
// desktop browser, used for local visual QA) `window.Telegram` is simply
// `undefined` and every method below becomes a safe no-op.
//
// NEVER trust `initDataUnsafe` for anything that matters — it's parsed
// client-side and can be forged by anyone with devtools. The only field
// this hook exposes for server calls is the RAW `initData` string, which
// every Mini-App API route re-verifies server-side
// (lib/telegram/webapp-auth.ts). `initDataUnsafe` is not read anywhere in
// this codebase.

import { useCallback, useEffect, useRef, useState } from "react";

export interface TelegramThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
}

type HapticImpactStyle = "light" | "medium" | "heavy" | "rigid" | "soft";
type HapticNotificationType = "error" | "success" | "warning";

interface TelegramMainButton {
  text: string;
  isVisible: boolean;
  isActive: boolean;
  isProgressVisible: boolean;
  setText: (text: string) => void;
  onClick: (cb: () => void) => void;
  offClick: (cb: () => void) => void;
  show: () => void;
  hide: () => void;
  enable: () => void;
  disable: () => void;
  showProgress: (leaveActive?: boolean) => void;
  hideProgress: () => void;
}

interface TelegramBackButton {
  isVisible: boolean;
  show: () => void;
  hide: () => void;
  onClick: (cb: () => void) => void;
  offClick: (cb: () => void) => void;
}

interface TelegramHapticFeedback {
  impactOccurred: (style: HapticImpactStyle) => void;
  notificationOccurred: (type: HapticNotificationType) => void;
  selectionChanged: () => void;
}

export interface TelegramWebAppApi {
  ready: () => void;
  expand: () => void;
  close: () => void;
  initData: string;
  colorScheme: "light" | "dark";
  themeParams: TelegramThemeParams;
  onEvent: (event: "themeChanged", cb: () => void) => void;
  offEvent: (event: "themeChanged", cb: () => void) => void;
  MainButton: TelegramMainButton;
  BackButton: TelegramBackButton;
  HapticFeedback: TelegramHapticFeedback;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebAppApi };
  }
}

export function getTelegramWebApp(): TelegramWebAppApi | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

// Fallback defaults — used whenever `themeParams` doesn't supply a field
// (always true outside Telegram; Telegram itself may also omit a field on
// older clients). Light-mode, roughly matches Telegram's own default
// light theme so the page doesn't look jarring even without a real
// themeParams payload.
const FALLBACK_THEME: Required<TelegramThemeParams> = {
  bg_color: "#ffffff",
  text_color: "#0f172a",
  hint_color: "#6b7280",
  link_color: "#2563eb",
  button_color: "#2563eb",
  button_text_color: "#ffffff",
  secondary_bg_color: "#f1f2f4",
};

const CSS_VAR_MAP: Record<keyof TelegramThemeParams, string> = {
  bg_color: "--tg-bg",
  text_color: "--tg-text",
  hint_color: "--tg-hint",
  link_color: "--tg-link",
  button_color: "--tg-button",
  button_text_color: "--tg-button-text",
  secondary_bg_color: "--tg-secondary-bg",
};

function applyTheme(webApp: TelegramWebAppApi | null, rootEl: HTMLElement) {
  const theme = webApp?.themeParams ?? {};
  for (const key of Object.keys(CSS_VAR_MAP) as Array<keyof TelegramThemeParams>) {
    const value = theme[key] || FALLBACK_THEME[key];
    rootEl.style.setProperty(CSS_VAR_MAP[key], value);
  }
  rootEl.dataset.tgColorScheme = webApp?.colorScheme ?? "light";
}

export interface UseTelegramWebAppResult {
  webApp: TelegramWebAppApi | null;
  /** True once ready()/expand() have run (or immediately, outside Telegram). */
  isReady: boolean;
  /** True only when `window.Telegram.WebApp` actually exists. */
  isInsideTelegram: boolean;
  initData: string;
  rootRef: React.RefObject<HTMLDivElement | null>;
  haptic: {
    impact: (style?: HapticImpactStyle) => void;
    success: () => void;
    error: () => void;
    selection: () => void;
  };
}

/**
 * Mount-time Telegram WebApp bootstrap: ready() + expand(), theme CSS
 * variables applied to `rootRef`'s element (re-applied on the SDK's
 * `themeChanged` event), and a stable `haptic` helper that safely no-ops
 * outside Telegram.
 */
export function useTelegramWebApp(): UseTelegramWebAppResult {
  const rootRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);
  const [isInsideTelegram, setIsInsideTelegram] = useState(false);
  const [initData, setInitData] = useState("");

  const init = useCallback((webApp: TelegramWebAppApi) => {
    const root = rootRef.current;
    setIsInsideTelegram(true);
    try {
      webApp.ready();
      webApp.expand();
    } catch (err) {
      console.error("[telegram-app] WebApp.ready()/expand() failed", err);
    }
    setInitData(webApp.initData || "");
    if (root) applyTheme(webApp, root);

    const onThemeChanged = () => {
      if (rootRef.current) applyTheme(webApp, rootRef.current);
    };
    webApp.onEvent("themeChanged", onThemeChanged);
    setIsReady(true);

    return () => webApp.offEvent("themeChanged", onThemeChanged);
  }, []);

  useEffect(() => {
    // The Telegram SDK (<Script strategy="afterInteractive"> in page.tsx)
    // may not have finished executing yet on the very first render —
    // poll briefly rather than assuming it's either immediately present
    // or permanently absent. Outside Telegram (no script present, or a
    // plain desktop browser), this polls a handful of times then falls
    // back to the "not inside Telegram" state cleanly.
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 20; // ~1s total at 50ms apart

    const tryInit = () => {
      if (cancelled) return;
      const webApp = getTelegramWebApp();
      if (webApp) {
        cleanup = init(webApp);
        return;
      }
      attempts += 1;
      if (attempts >= MAX_ATTEMPTS) {
        setIsInsideTelegram(false);
        setIsReady(true);
        if (rootRef.current) applyTheme(null, rootRef.current);
        return;
      }
      setTimeout(tryInit, 50);
    };
    tryInit();

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const haptic = {
    impact: (style: HapticImpactStyle = "light") => {
      try {
        getTelegramWebApp()?.HapticFeedback.impactOccurred(style);
      } catch {
        /* no-op outside Telegram */
      }
    },
    success: () => {
      try {
        getTelegramWebApp()?.HapticFeedback.notificationOccurred("success");
      } catch {
        /* no-op outside Telegram */
      }
    },
    error: () => {
      try {
        getTelegramWebApp()?.HapticFeedback.notificationOccurred("error");
      } catch {
        /* no-op outside Telegram */
      }
    },
    selection: () => {
      try {
        getTelegramWebApp()?.HapticFeedback.selectionChanged();
      } catch {
        /* no-op outside Telegram */
      }
    },
  };

  return {
    webApp: getTelegramWebApp(),
    isReady,
    isInsideTelegram,
    initData,
    rootRef,
    haptic,
  };
}

/**
 * Wires Telegram's MainButton to one screen's primary action. Re-runs
 * whenever `text`/`visible`/`enabled`/`onClick` change, and ALWAYS hides
 * the button on unmount/dependency-change cleanup — screens must not
 * leak a stale button into the next view.
 */
export function useMainButton(
  webApp: TelegramWebAppApi | null,
  opts: {
    text: string;
    visible: boolean;
    enabled?: boolean;
    progress?: boolean;
    onClick: () => void;
  },
) {
  const { text, visible, enabled = true, progress = false, onClick } = opts;
  // "Latest ref" pattern — the assignment happens in its OWN effect (never
  // during render) so `handler` below always calls the current `onClick`
  // without needing `onClick` itself in the other effect's deps (which
  // would re-subscribe Telegram's button on every render if the caller
  // passes an inline arrow function, as every call site here does).
  const onClickRef = useRef(onClick);
  useEffect(() => {
    onClickRef.current = onClick;
  }, [onClick]);

  useEffect(() => {
    if (!webApp) return;
    const btn = webApp.MainButton;
    const handler = () => onClickRef.current();
    // The REAL Telegram SDK throws `WebAppBottomButtonParamInvalid`
    // ("Bottom button text is required") if setText() is ever called
    // with an empty string — found via a Playwright run against the
    // actual unmocked telegram-web-app.js, not just our own mock (which
    // didn't validate this). Every informational screen (loading/error/
    // not-connected/etc.) renders with text="" + visible=false, so this
    // guard matters on first mount, not just as a theoretical edge case.
    if (text) btn.setText(text);
    btn.onClick(handler);
    if (visible) {
      btn.show();
      if (enabled && !progress) btn.enable();
      else btn.disable();
      if (progress) btn.showProgress(false);
      else btn.hideProgress();
    } else {
      btn.hide();
    }
    return () => {
      btn.offClick(handler);
    };
  }, [webApp, text, visible, enabled, progress]);

  useEffect(() => {
    return () => {
      webApp?.MainButton.hide();
    };
  }, [webApp]);
}

/** Wires Telegram's BackButton to one screen's "go back" action. */
export function useBackButton(
  webApp: TelegramWebAppApi | null,
  opts: { visible: boolean; onClick: () => void },
) {
  const { visible, onClick } = opts;
  const onClickRef = useRef(onClick);
  useEffect(() => {
    onClickRef.current = onClick;
  }, [onClick]);

  useEffect(() => {
    if (!webApp) return;
    const btn = webApp.BackButton;
    const handler = () => onClickRef.current();
    btn.onClick(handler);
    if (visible) btn.show();
    else btn.hide();
    return () => {
      btn.offClick(handler);
    };
  }, [webApp, visible]);

  useEffect(() => {
    return () => {
      webApp?.BackButton.hide();
    };
  }, [webApp]);
}
