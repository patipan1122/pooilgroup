"use client";

import { useEffect, useState } from "react";
import { MessageCircle, Loader2 } from "lucide-react";
import { getLiff, getLiffIdToken } from "@/lib/line/liff-client";
import type { PortalView } from "@/lib/rentspace/portal";
import { PortalClient } from "@/app/rentspace/portal/[token]/_components/portal-client";

type Phase = "loading" | "linked" | "unlinked" | "error";

export function LiffRentspaceClient({ liffId }: { liffId: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [view, setView] = useState<PortalView | null>(null);
  const [screen, setScreen] = useState("bills");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!liffId) {
          if (!cancelled) setPhase("error");
          return;
        }
        const liff = await getLiff(liffId);
        if (!liff) {
          if (!cancelled) setPhase("error");
          return;
        }
        // ปุ่ม rich menu ส่ง ?screen=bills|history|news|docs มาเปิดแท็บที่ถูก
        try {
          const sp = new URLSearchParams(window.location.search);
          if (sp.get("screen")) setScreen(sp.get("screen") as string);
        } catch {
          /* ignore */
        }
        const idToken = await getLiffIdToken(liffId);
        if (!idToken) {
          if (!cancelled) setPhase("error");
          return;
        }
        const res = await fetch("/api/rentspace/portal-liff", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idToken }),
        });
        const data = (await res.json()) as { linked?: boolean; view?: PortalView };
        if (cancelled) return;
        if (data.linked && data.view) {
          setView(data.view);
          setPhase("linked");
        } else {
          setPhase("unlinked");
        }
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [liffId]);

  if (phase === "loading") {
    return (
      <Center>
        <Loader2 className="h-7 w-7 animate-spin" style={{ color: "var(--rs-brand)" }} />
        <div className="mt-3 text-[14px] rs-text-2">กำลังโหลดข้อมูลของคุณ…</div>
      </Center>
    );
  }

  if (phase === "unlinked") {
    return (
      <Center>
        <div className="h-12 w-12 rounded-full flex items-center justify-center mb-3" style={{ background: "#06C755" }}>
          <MessageCircle className="h-6 w-6 text-white" />
        </div>
        <div className="text-[16px] font-bold">ยังไม่ได้เชื่อมบัญชี</div>
        <p className="text-[13.5px] rs-text-2 mt-2 leading-relaxed max-w-xs">
          บัญชี LINE นี้ยังไม่ได้เชื่อมกับข้อมูลผู้เช่า กรุณากดลิงก์เชิญที่ได้รับจากเจ้าหน้าที่ แล้วกด "เชื่อม LINE" ก่อนครับ
        </p>
      </Center>
    );
  }

  if (phase === "error") {
    return (
      <Center>
        <div className="text-[15px] font-semibold">เปิดไม่สำเร็จ</div>
        <p className="text-[13.5px] rs-text-2 mt-2 max-w-xs">กรุณาเปิดผ่านแอป LINE (เมนูด้านล่าง) อีกครั้ง หรือลองใหม่ภายหลังครับ</p>
      </Center>
    );
  }

  if (view) {
    return (
      <PortalClient
        token={view.token}
        tenantName={view.tenantName}
        bills={view.bills}
        announcements={view.announcements}
        documents={view.documents}
        payments={view.payments}
        lineLinked={view.lineLinked}
        email={view.email}
        emailOptIn={view.emailOptIn}
        lineNotice={null}
        inLiff
        initialScreen={screen}
      />
    );
  }
  return null;
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="rs-scope min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ background: "var(--rs-bg-2)" }}>
      {children}
    </div>
  );
}
