"use client";
/**
 * ClawFleet v2 — Staff App phone-frame shell (web-playable front-of-house).
 *
 * Full-screen takeover (fixed inset-0) on the cream Playalot bg → centered phone frame →
 * inside the screen: (1) a lightweight demo PIN gate like the prototype, then (2) the REAL
 * staff collect flow via <CollectGroupClient> (reused verbatim — no fork). The phone screen
 * scrolls; the admin chrome behind is fully covered so this reads as a separate surface.
 *
 * The PIN screen is preview-only sugar (real auth is the parent session). Demo PIN: 1111.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import "../clawfleet-liff.css"; // Playalot employee skin + staff-app phone-frame + PIN gate
import { CollectGroupClient } from "@/app/(admin)/clawfleet/v2/collect/collect-group-client";
import type {
  GroupCollectBranch,
  CollectSku,
} from "@/lib/clawfleet/v2-group-data";

const DEMO_PIN = "1111";

type Props = { orgId: string; branches: GroupCollectBranch[]; skus: CollectSku[] };

export function StaffAppFrame({ orgId, branches, skus }: Props) {
  const [unlocked, setUnlocked] = useState(false);

  // This is a separate FRONT-OF-HOUSE surface → hide the admin mobile bottom nav
  // (rendered by the parent clawfleet layout) while the staff app is mounted.
  useEffect(() => {
    document.body.classList.add("cf-staffapp-active");
    return () => document.body.classList.remove("cf-staffapp-active");
  }, []);

  return (
    <div className="cf-staffapp-stage">
      {/* exit back to the back-office (this surface has no admin sidebar) */}
      <Link href="/clawfleet/v2/preview" className="cf-staffapp-exit">
        ← กลับหลังบ้าน
      </Link>

      <div className="cf-staffapp-phone">
        <div className="cf-staffapp-notch" />
        <div className="cf-staffapp-screen cf-liff">
          {unlocked ? (
            <CollectGroupClient orgId={orgId} branches={branches} skus={skus} />
          ) : (
            <PinGate onUnlock={() => setUnlocked(true)} />
          )}
        </div>
      </div>

      <div className="cf-staffapp-hint">
        แอปพนักงาน (กดเล่นได้จริง) · PIN ตัวอย่าง <strong>{DEMO_PIN}</strong> ·
        เลือกสาขา → เก็บรอบ → ปิดกลุ่ม + cross-check
      </div>
    </div>
  );
}

/** Prototype-style staff pick + PIN. Demo: any name → PIN 1111 unlocks. */
function PinGate({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);

  const press = (d: string) => {
    setErr(false);
    setPin((p) => {
      const next = (p + d).slice(0, 4);
      if (next.length === 4) {
        if (next === DEMO_PIN) {
          setTimeout(onUnlock, 120);
        } else {
          setErr(true);
          setTimeout(() => setPin(""), 350);
        }
      }
      return next;
    });
  };
  const back = () => {
    setErr(false);
    setPin((p) => p.slice(0, -1));
  };

  return (
    <div className="cf-pin">
      <div className="cf-pin-head">
        <div className="cf-pin-avatar">🧸</div>
        <div className="cf-pin-name">น้องเอ</div>
        <div className="cf-pin-role">พนักงานเก็บเงิน · ตู้คีบ</div>
      </div>

      <div className="cf-pin-ask">ใส่ PIN เพื่อเริ่มงาน</div>
      <div className={`cf-pin-dots ${err ? "is-err" : ""}`}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`cf-pin-dot ${i < pin.length ? "is-on" : ""}`} />
        ))}
      </div>
      {err && <div className="cf-pin-err">PIN ไม่ถูก · ลองใหม่</div>}

      <div className="cf-pin-pad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" className="cf-pin-key" onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <button type="button" className="cf-pin-key cf-pin-key-skip" onClick={onUnlock}>
          ข้าม
        </button>
        <button type="button" className="cf-pin-key" onClick={() => press("0")}>
          0
        </button>
        <button type="button" className="cf-pin-key cf-pin-key-back" onClick={back}>
          ⌫
        </button>
      </div>

      <div className="cf-pin-foot">เดโม · ใส่ {DEMO_PIN} หรือกด “ข้าม”</div>
    </div>
  );
}
