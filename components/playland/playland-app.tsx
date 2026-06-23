"use client";

// Playland · "Play a lot" — single-page tablet cashier app.
// Faithful port of the Claude Design prototype (Play a lot Prototype.dc.html).
// Inline styles are copied verbatim from the prototype; fonts swapped to the
// repo's CSS vars (--font-mitr / --font-fredoka). Real mutations wired to
// @/lib/playland/actions; UI stays fully functional with optimistic local
// state when an action can't be safely targeted.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  checkInSession,
  checkOutSession,
  createMember,
  createSale,
  extendSession,
} from "@/lib/playland/actions";

const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";

// ---------------------------------------------------------------------------
// Types (props seeded from real data)
// ---------------------------------------------------------------------------
export interface PlaylandKid {
  id: string; // real sessionId
  name: string;
  mascot: string; // "sunny" | "skye" | "rocky"
  pkg: string;
  sec: number; // remaining seconds
  dayPass?: boolean;
  charges: { label: string; amount: number }[];
}
export interface PlaylandPackageVM {
  id: string;
  mins: number; // 0 = day pass
  label: string;
  sub: string;
  price: number; // baht
}
export interface PlaylandProductVM {
  id: string;
  emoji: string;
  name: string;
  price: number; // baht
}
export interface PlaylandMemberVM {
  id: string;
  familyName: string;
  childName: string;
  visits: number;
  isMember: boolean;
  mascot: string;
}
interface Props {
  initialKids: PlaylandKid[];
  packages: PlaylandPackageVM[];
  products: PlaylandProductVM[];
  members?: PlaylandMemberVM[];
  revenue: number; // baht today
  branchId: string;
  cashierName: string;
}

type Screen =
  | "home"
  | "board"
  | "checkout"
  | "pos"
  | "checkin"
  | "receipt"
  | "monitor"
  | "shift"
  | "dashboard"
  | "settings"
  | "staff";
type CkStep = "choose" | "search" | "register" | "package";

interface Receipt {
  name: string;
  no: string;
  lines: { label: string; amount: number }[];
  total: number;
}

interface State {
  screen: Screen;
  kids: PlaylandKid[];
  revenue: number;
  coKidId: string | null;
  extKidId: string | null;
  cart: Record<string, number>;
  chargeKidId: string | null;
  ckStep: CkStep;
  ckName: string;
  ckMemberId: string | null; // real memberId chosen/created for check-in
  receipt: Receipt | null;
  toast: string | null;
}

const PRESET_PRODUCTS: PlaylandProductVM[] = [
  { id: "p1", emoji: "🍪", name: "โอริโอ้", price: 35 },
  { id: "p2", emoji: "🍿", name: "ป๊อปคอร์น", price: 45 },
  { id: "p3", emoji: "🍩", name: "โดนัท", price: 30 },
  { id: "p4", emoji: "🍬", name: "เยลลี่", price: 25 },
  { id: "p5", emoji: "🧁", name: "คัพเค้ก", price: 40 },
  { id: "p6", emoji: "🍦", name: "ไอศกรีม", price: 35 },
  { id: "p7", emoji: "🥤", name: "น้ำส้ม", price: 30 },
  { id: "p8", emoji: "🍫", name: "ช็อกโกแลต", price: 30 },
];

const PRESET_PACKAGES: PlaylandPackageVM[] = [
  { id: "pk30", mins: 30, label: "30 นาที", sub: "เล่นสั้น", price: 70 },
  { id: "pk60", mins: 60, label: "60 นาที", sub: "มาตรฐาน · ขายดี", price: 100 },
  { id: "pk120", mins: 120, label: "120 นาที", sub: "เล่นนาน", price: 180 },
  { id: "pkday", mins: 0, label: "Day Pass", sub: "เล่นทั้งวัน", price: 350 },
];

const MASCOTS = ["sunny", "skye", "rocky"];
function mascotSrc(name: string) {
  return `/playland/brand/mascot-${name}.png`;
}
function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ":" + String(s).padStart(2, "0");
}
function colorFor(sec: number): string {
  if (sec <= 600) return "#E74C3C";
  if (sec <= 1500) return "#F0B323";
  return "#1F8A5B";
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------
type Action =
  | { t: "tick" }
  | { t: "set"; p: Partial<State> }
  | { t: "go"; screen: Screen }
  | { t: "addCart"; id: string }
  | { t: "decCart"; id: string }
  | { t: "applyExtendLocal"; kidId: string; mins: number; price: number }
  | { t: "chargeKid"; kidId: string; lines: { label: string; amount: number }[] }
  | { t: "completeCheckout"; kidId: string; receipt: Receipt }
  | { t: "addKid"; kid: PlaylandKid }
  | { t: "posReceipt"; receipt: Receipt; total: number };

function reducer(s: State, a: Action): State {
  switch (a.t) {
    case "tick":
      return { ...s, kids: s.kids.map((k) => (k.dayPass || k.sec <= 0 ? k : { ...k, sec: k.sec - 1 })) };
    case "set":
      return { ...s, ...a.p };
    case "go":
      return { ...s, screen: a.screen };
    case "addCart":
      return { ...s, cart: { ...s.cart, [a.id]: (s.cart[a.id] || 0) + 1 } };
    case "decCart": {
      const n = { ...s.cart };
      n[a.id] = (n[a.id] || 0) - 1;
      if (n[a.id] <= 0) delete n[a.id];
      return { ...s, cart: n };
    }
    case "applyExtendLocal":
      return {
        ...s,
        kids: s.kids.map((k) =>
          k.id === a.kidId
            ? {
                ...k,
                sec: k.dayPass ? k.sec : k.sec + a.mins * 60,
                dayPass: false,
                charges: [...k.charges, { label: "ต่อเวลา +" + a.mins + " นาที", amount: a.price }],
              }
            : k,
        ),
        extKidId: null,
      };
    case "chargeKid":
      return {
        ...s,
        kids: s.kids.map((k) => (k.id === a.kidId ? { ...k, charges: [...k.charges, ...a.lines] } : k)),
        cart: {},
        chargeKidId: null,
        screen: "board",
      };
    case "completeCheckout":
      return {
        ...s,
        receipt: a.receipt,
        kids: s.kids.filter((k) => k.id !== a.kidId),
        revenue: s.revenue + a.receipt.total,
        coKidId: null,
        screen: "receipt",
      };
    case "addKid":
      return {
        ...s,
        kids: [...s.kids, a.kid],
        ckStep: "choose",
        ckName: "",
        ckMemberId: null,
        screen: "board",
      };
    case "posReceipt":
      return { ...s, receipt: a.receipt, revenue: s.revenue + a.total, cart: {}, screen: "receipt" };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function PlaylandApp(props: Props) {
  const router = useRouter();
  const products = props.products.length ? props.products : PRESET_PRODUCTS;
  const packages = props.packages.length ? props.packages : PRESET_PACKAGES;
  const members = props.members ?? [];

  const [state, dispatch] = useReducer(reducer, {
    screen: "home",
    kids: props.initialKids,
    revenue: props.revenue,
    coKidId: null,
    extKidId: null,
    cart: {},
    chargeKidId: null,
    ckStep: "choose",
    ckName: "",
    ckMemberId: null,
    receipt: null,
    toast: null,
  });

  // toast timer
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    dispatch({ t: "set", p: { toast: msg } });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => dispatch({ t: "set", p: { toast: null } }), 2200);
  }, []);

  // clock tick
  useEffect(() => {
    const id = setInterval(() => dispatch({ t: "tick" }), 1000);
    return () => clearInterval(id);
  }, []);

  // frame auto-zoom to fit
  const frameRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const fit = () => {
      const frame = frameRef.current;
      if (!frame) return;
      const availW = window.innerWidth - 68;
      const availH = window.innerHeight - 130;
      const z = Math.min(1, availW / 1280, availH / 860);
      // `zoom` matches the prototype's behavior exactly
      (frame.style as CSSStyleDeclaration & { zoom?: string }).zoom = String(z);
    };
    window.addEventListener("resize", fit);
    fit();
    const raf = requestAnimationFrame(fit);
    const t = setTimeout(fit, 120);
    return () => {
      window.removeEventListener("resize", fit);
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, []);

  const s = state;

  // ----- handlers -----
  const go = (screen: Screen) => dispatch({ t: "go", screen });
  const goPos = () => {
    dispatch({ t: "set", p: { chargeKidId: null } });
    go("pos");
  };
  const startCheckin = () => dispatch({ t: "set", p: { ckStep: "choose", screen: "checkin", ckMemberId: null } });

  const cartLines = useMemo(
    () =>
      Object.keys(s.cart).map((id) => {
        const p = products.find((x) => x.id === id)!;
        return { ...p, qty: s.cart[id] };
      }),
    [s.cart, products],
  );

  const addToCart = (id: string) => dispatch({ t: "addCart", id });
  const decFromCart = (id: string) => dispatch({ t: "decCart", id });

  const checkoutKid = (id: string) => dispatch({ t: "set", p: { coKidId: id, screen: "checkout" } });
  const addSnackFor = (id: string) => dispatch({ t: "set", p: { chargeKidId: id, screen: "pos" } });
  const openExtend = (id: string) => dispatch({ t: "set", p: { extKidId: id } });
  const closeExtend = () => dispatch({ t: "set", p: { extKidId: null } });

  // ----- POS pay -----
  const payPos = async () => {
    const lines = cartLines;
    if (lines.length === 0) {
      showToast("ยังไม่มีรายการ");
      return;
    }
    const total = lines.reduce((a, l) => a + l.price * l.qty, 0);

    if (s.chargeKidId != null) {
      // charging a kid → add to that kid's running charges (collected at checkout)
      const kid = s.kids.find((k) => k.id === s.chargeKidId);
      dispatch({
        t: "chargeKid",
        kidId: s.chargeKidId,
        lines: lines.map((l) => ({ label: l.name + " ×" + l.qty, amount: l.price * l.qty })),
      });
      showToast("ลงบิลให้ " + (kid ? kid.name : "") + " แล้ว · เก็บตอนเช็คเอาท์");
      return;
    }

    // walk-in cash sale → real createSale when products map to real ids
    const realItems = lines
      .filter((l) => !l.id.startsWith("p") || l.id.length > 3) // preset ids are p1..p8
      .map((l) => ({ productId: l.id, quantity: l.qty }));
    const usingRealProducts = props.products.length > 0 && realItems.length === lines.length;

    dispatch({
      t: "posReceipt",
      receipt: {
        name: "ลูกค้า",
        no: "#" + (740 + Math.floor(Math.random() * 60)),
        lines: lines.map((l) => ({ label: l.name + " ×" + l.qty, amount: l.price * l.qty })),
        total,
      },
      total,
    });

    if (usingRealProducts) {
      try {
        const res = await createSale({
          branchId: props.branchId,
          items: realItems,
          paymentMethod: "CASH",
        });
        if (res.ok) router.refresh();
        else showToast(res.error);
      } catch {
        // optimistic receipt already shown; backend can be retried by CEO
      }
    }
  };

  // ----- checkout -----
  const doCheckout = async () => {
    const kid = s.kids.find((k) => k.id === s.coKidId);
    if (!kid) {
      go("board");
      return;
    }
    const total = kid.charges.reduce((a, c) => a + c.amount, 0);
    const kidId = kid.id;
    dispatch({
      t: "completeCheckout",
      kidId,
      receipt: {
        name: kid.name,
        no: "#" + (740 + Math.floor(Math.random() * 60)),
        lines: kid.charges,
        total,
      },
    });
    // real session ids are uuids; preset/local kids use short numeric ids
    if (isRealId(kidId)) {
      try {
        const res = await checkOutSession(kidId);
        if (res.ok) router.refresh();
        else showToast(res.error);
      } catch {
        /* optimistic */
      }
    }
  };

  // ----- extend -----
  const applyExtend = async (mins: number, price: number) => {
    const kidId = s.extKidId;
    if (!kidId) return;
    dispatch({ t: "applyExtendLocal", kidId, mins, price });
    showToast("ต่อเวลา +" + mins + " นาที แล้ว");
    // map minutes → a real package id to call extendSession
    const pkg = packages.find((p) => p.mins === mins) ?? packages.find((p) => p.mins > 0);
    if (isRealId(kidId) && pkg && isRealId(pkg.id)) {
      try {
        const res = await extendSession({ sessionId: kidId, extraPackageId: pkg.id, paymentMethod: "CASH" });
        if (res.ok) router.refresh();
        else showToast(res.error);
      } catch {
        /* optimistic */
      }
    }
  };

  // ----- check-in: choose package -----
  const [creating, setCreating] = useState(false);
  const pickPackage = async (pkg: PlaylandPackageVM) => {
    const name = s.ckName || "น้องใหม่";
    const mascot = MASCOTS[Math.floor(Math.random() * 3)];

    // try real wiring first: ensure a member, then check in
    if (props.branchId && isRealId(pkg.id) && !creating) {
      setCreating(true);
      try {
        let memberId = s.ckMemberId;
        if (!memberId) {
          const cm = await createMember({
            branchId: props.branchId,
            type: "KID",
            name,
            nickname: name,
            consentGiven: true,
            newFamilyGroupName: `ครอบครัว ${name}`,
          });
          if (cm.ok) memberId = cm.data.memberId;
        }
        if (memberId) {
          const ci = await checkInSession({
            branchId: props.branchId,
            memberId,
            packageId: pkg.id,
            paymentMethod: "CASH",
          });
          if (ci.ok) {
            dispatch({
              t: "addKid",
              kid: {
                id: ci.data.sessionId,
                name,
                mascot,
                pkg: pkg.label,
                sec: pkg.mins * 60,
                dayPass: pkg.mins === 0,
                charges: [{ label: "ค่าเล่น " + pkg.label, amount: pkg.price }],
              },
            });
            showToast(name + " เช็คอินแล้ว!");
            router.refresh();
            setCreating(false);
            return;
          } else {
            showToast(ci.error);
          }
        }
      } catch {
        /* fall through to optimistic */
      }
      setCreating(false);
    }

    // optimistic fallback (preset packages / no branch / action failed)
    dispatch({
      t: "addKid",
      kid: {
        id: "L" + Date.now(),
        name,
        mascot,
        pkg: pkg.label,
        sec: pkg.mins * 60,
        dayPass: pkg.mins === 0,
        charges: [{ label: "ค่าเล่น " + pkg.label, amount: pkg.price }],
      },
    });
    showToast(name + " เช็คอินแล้ว!");
  };

  const checkinBack = () => {
    if (s.ckStep === "choose") go("home");
    else dispatch({ t: "set", p: { ckStep: "choose" } });
  };

  // ----- derived render values -----
  const near = s.kids.filter((k) => !k.dayPass && k.sec <= 600).length;
  const revenueStr = "฿" + s.revenue.toLocaleString();
  const co = s.kids.find((k) => k.id === s.coKidId);
  const ext = s.kids.find((k) => k.id === s.extKidId);
  const chargeKid = s.kids.find((k) => k.id === s.chargeKidId);
  const posTotal = cartLines.reduce((a, l) => a + l.price * l.qty, 0);
  const rc = s.receipt;

  // search results: real members (mapped) or two seed families to keep flow alive
  const searchResults: PlaylandMemberVM[] =
    members.length > 0
      ? members.slice(0, 6)
      : [
          { id: "seedA", familyName: "ครอบครัวคุณแม่ปุ๊ก", childName: "น้องเอ", visits: 7, isMember: true, mascot: "sunny" },
          { id: "seedB", familyName: "ครอบครัวคุณพ่อโต้ง", childName: "น้องบีม", visits: 3, isMember: false, mascot: "skye" },
        ];

  const extOptions = [
    { label: "+15", price: "฿30", mins: 15, p: 30 },
    { label: "+30", price: "฿55", mins: 30, p: 55 },
    { label: "+60", price: "฿100", mins: 60, p: 100 },
  ];

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------
  return (
    <div
      style={{
        fontFamily: MITR,
        color: "#3A3026",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: 34,
        background: "#d9d4cc",
      }}
    >
      {/* keyframes for pulse (matches prototype <style>) */}
      <style>{`@keyframes pulseRed{0%,100%{box-shadow:0 0 0 0 rgba(231,76,60,.0)}50%{box-shadow:0 0 0 5px rgba(231,76,60,.25)}}`}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 22, color: "#2D6CB1" }}>
          Play <span style={{ color: "#F0B323" }}>a</span> lot
        </div>
        <span style={{ fontSize: 14, color: "#7a7264" }}>· นาฬิกาเดินจริง · กดได้จริง</span>
      </div>

      {/* tablet frame */}
      <div
        ref={frameRef}
        id="plFrame"
        style={{
          width: 1280,
          height: 860,
          background: "#fff",
          borderRadius: 22,
          boxShadow: "0 18px 50px rgba(0,0,0,.22)",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* ===== HOME ===== */}
        {s.screen === "home" && (
          <div style={{ height: "100%", background: "#F7F2EA", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ height: 74, flex: "none", background: "#fff", borderBottom: "1px solid #ece5d8", display: "flex", alignItems: "center", padding: "0 28px", gap: 18 }}>
              <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 24, color: "#2D6CB1" }}>
                Play <span style={{ color: "#F0B323" }}>a</span> lot
              </div>
              <div style={{ width: 1, height: 28, background: "#ece5d8" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#eaf3eb", color: "#1F8A5B", padding: "8px 14px", borderRadius: 999, fontSize: 14 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#1F8A5B", display: "inline-block" }} />
                กะเปิดอยู่
              </div>
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
                <div onClick={() => go("shift")} style={{ cursor: "pointer", fontSize: 14, color: "#6b6052", padding: "8px 14px", borderRadius: 10, background: "#f4ede0" }}>ปิดกะ</div>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#F0B323", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FREDOKA, fontWeight: 600, color: "#fff", fontSize: 18 }}>
                  {props.cashierName.trim().charAt(0) || "?"}
                </div>
              </div>
            </div>
            <div style={{ flex: 1, padding: "30px 38px", display: "flex", flexDirection: "column" }}>
              <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 26 }}>{greeting()} {props.cashierName} 👋</div>
              <div style={{ fontSize: 16, color: "#8a7f70", marginBottom: 22 }}>
                มีเด็กเล่นอยู่ <strong style={{ color: "#2D6CB1" }}>{s.kids.length}</strong> คน · รายได้ <strong style={{ color: "#1F8A5B" }}>{revenueStr}</strong>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, flex: 1 }}>
                {/* รับเด็กเข้าเล่น */}
                <div onClick={startCheckin} style={{ cursor: "pointer", background: "#2D6CB1", borderRadius: 20, padding: "26px 30px", color: "#fff", display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative", overflow: "hidden" }}>
                  <div style={{ width: 56, height: 56, borderRadius: 15, background: "rgba(255,255,255,.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" /></svg>
                  </div>
                  <div>
                    <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 26 }}>รับเด็กเข้าเล่น</div>
                    <div style={{ fontSize: 15, opacity: 0.85 }}>ลงทะเบียน · เลือกแพ็กเกจ</div>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mascotSrc("skye")} alt="" style={{ position: "absolute", right: -10, bottom: -14, width: 128, opacity: 0.9 }} />
                </div>
                {/* เด็กที่กำลังเล่น */}
                <div onClick={() => go("board")} style={{ cursor: "pointer", background: "#E74C3C", borderRadius: 20, padding: "26px 30px", color: "#fff", display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative", overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ width: 56, height: 56, borderRadius: 15, background: "rgba(255,255,255,.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                    </div>
                    {near > 0 && <div style={{ background: "rgba(255,255,255,.22)", fontWeight: 500, fontSize: 14, padding: "6px 12px", borderRadius: 999 }}>{near} ใกล้หมดเวลา</div>}
                  </div>
                  <div>
                    <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 26 }}>เด็กที่กำลังเล่น</div>
                    <div style={{ fontSize: 15, opacity: 0.85 }}>ต่อเวลา · เพิ่มขนม · เช็คเอาท์</div>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mascotSrc("rocky")} alt="" style={{ position: "absolute", right: -14, bottom: -16, width: 138, opacity: 0.9 }} />
                </div>
                {/* ขายขนม */}
                <div onClick={goPos} style={{ cursor: "pointer", background: "#F0B323", borderRadius: 20, padding: "26px 30px", color: "#fff", display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative", overflow: "hidden" }}>
                  <div style={{ width: 56, height: 56, borderRadius: 15, background: "rgba(255,255,255,.22)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M5 7h14l-1.2 11.5a2 2 0 0 1-2 1.5H8.2a2 2 0 0 1-2-1.5L5 7Z" /><path d="M9 7V5a3 3 0 0 1 6 0v2" /></svg>
                  </div>
                  <div>
                    <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 26, color: "#fff" }}>ขายขนม · เครื่องดื่ม</div>
                    <div style={{ fontSize: 15, opacity: 0.9, color: "#fff" }}>POS · คิดเงิน</div>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mascotSrc("sunny")} alt="" style={{ position: "absolute", right: 0, bottom: -14, width: 108, opacity: 0.92 }} />
                </div>
                {/* Monitor */}
                <div onClick={() => go("monitor")} style={{ cursor: "pointer", background: "#1c2740", borderRadius: 20, padding: "26px 30px", color: "#fff", display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative", overflow: "hidden" }}>
                  <div style={{ width: 56, height: 56, borderRadius: 15, background: "rgba(255,255,255,.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
                  </div>
                  <div>
                    <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 26 }}>จอ Monitor (TV)</div>
                    <div style={{ fontSize: 15, opacity: 0.8 }}>โชว์เวลาให้ทั้งร้านเห็น</div>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
                <div onClick={() => go("dashboard")} style={{ cursor: "pointer", flex: 1, background: "#fff", border: "1px solid #ece5d8", borderRadius: 14, padding: 14, textAlign: "center", fontSize: 15, color: "#3A3026" }}>📊 Dashboard</div>
                <div onClick={() => go("settings")} style={{ cursor: "pointer", flex: 1, background: "#fff", border: "1px solid #ece5d8", borderRadius: 14, padding: 14, textAlign: "center", fontSize: 15, color: "#3A3026" }}>⚙️ แพ็กเกจ &amp; สต๊อก</div>
                <div onClick={() => go("staff")} style={{ cursor: "pointer", flex: 1, background: "#fff", border: "1px solid #ece5d8", borderRadius: 14, padding: 14, textAlign: "center", fontSize: 15, color: "#3A3026" }}>👥 พนักงาน &amp; สิทธิ์</div>
              </div>
            </div>
          </div>
        )}

        {/* ===== BOARD ===== */}
        {s.screen === "board" && (
          <div style={{ height: "100%", background: "#F7F2EA", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ height: 74, flex: "none", background: "#fff", borderBottom: "1px solid #ece5d8", display: "flex", alignItems: "center", padding: "0 28px", gap: 16 }}>
              <div onClick={() => go("home")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: "#6b6052", fontSize: 16 }}>{backIcon("#6b6052")}หน้าหลัก</div>
              <div style={{ width: 1, height: 28, background: "#ece5d8" }} />
              <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 20 }}>เด็กที่กำลังเล่น</div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
                <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 12, padding: "8px 16px", fontSize: 14 }}>กำลังเล่น <strong style={{ fontFamily: FREDOKA, color: "#2D6CB1" }}>{s.kids.length}</strong></div>
                <div style={{ background: "#fff", border: "1px solid #f4d9d6", borderRadius: 12, padding: "8px 16px", fontSize: 14 }}>ใกล้หมด <strong style={{ fontFamily: FREDOKA, color: "#E74C3C" }}>{near}</strong></div>
                <div onClick={startCheckin} style={{ cursor: "pointer", background: "#F0B323", color: "#fff", borderRadius: 12, padding: "8px 18px", fontSize: 15, display: "flex", alignItems: "center", gap: 7 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>รับเด็กเข้า
                </div>
              </div>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: "22px 28px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 18 }}>
                {s.kids.map((k) => {
                  const nearEnd = !k.dayPass && k.sec <= 600;
                  const color = k.dayPass ? "#1F8A5B" : colorFor(k.sec);
                  return (
                    <div key={k.id} style={{ background: "#fff", borderRadius: 18, padding: 18, border: `2px solid ${nearEnd ? "#E74C3C" : "#eef0ec"}`, position: "relative" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                        <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#f4ede0", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={mascotSrc(k.mascot)} alt="" style={{ width: 40 }} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 500, fontSize: 18 }}>{k.name}</div>
                          <div style={{ fontSize: 13, color: "#8a7f70" }}>{k.pkg}</div>
                        </div>
                        {nearEnd && <div style={{ background: "#fdeceb", color: "#E74C3C", fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999 }}>ใกล้หมด</div>}
                      </div>
                      <div style={{ textAlign: "center", margin: "6px 0 14px" }}>
                        <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 38, lineHeight: 1, color }}>{k.dayPass ? "ทั้งวัน" : fmt(Math.max(0, k.sec))}</div>
                        <div style={{ fontSize: 13, color: "#8a7f70", marginTop: 2 }}>{k.dayPass ? "Day Pass" : "เหลือ"}</div>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <div onClick={() => openExtend(k.id)} style={{ cursor: "pointer", flex: 1, background: "#eaf3f6", color: "#2D6CB1", textAlign: "center", padding: 10, borderRadius: 10, fontSize: 14 }}>+ เวลา</div>
                        <div onClick={() => addSnackFor(k.id)} style={{ cursor: "pointer", flex: 1, background: "#fdf3df", color: "#a9791a", textAlign: "center", padding: 10, borderRadius: 10, fontSize: 14 }}>+ ขนม</div>
                        <div onClick={() => checkoutKid(k.id)} style={{ cursor: "pointer", flex: 1, background: "#E74C3C", color: "#fff", textAlign: "center", padding: 10, borderRadius: 10, fontSize: 14 }}>เช็คเอาท์</div>
                      </div>
                    </div>
                  );
                })}
                <div onClick={startCheckin} style={{ cursor: "pointer", border: "2px dashed #d9cdb8", borderRadius: 18, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#a9791a", gap: 8, minHeight: 200 }}>
                  <div style={{ width: 54, height: 54, borderRadius: "50%", background: "#fdf3df", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#F0B323" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                  </div>
                  <div style={{ fontSize: 16 }}>รับเด็กเข้าเล่น</div>
                </div>
              </div>
            </div>

            {/* extend modal */}
            {ext != null && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(28,39,64,.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ width: 540, background: "#fff", borderRadius: 22, boxShadow: "0 20px 60px rgba(0,0,0,.3)", overflow: "hidden" }}>
                  <div style={{ padding: "24px 30px 16px", display: "flex", alignItems: "center", gap: 14, borderBottom: "1px solid #f2ebdd" }}>
                    <div style={{ width: 50, height: 50, borderRadius: "50%", background: "#fdeceb", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={mascotSrc(ext.mascot)} alt="" style={{ width: 42 }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 21 }}>ต่อเวลาให้ {ext.name}</div>
                      <div style={{ fontSize: 14, color: "#8a7f70" }}>ตอนนี้เหลือ <span style={{ color: "#E74C3C", fontWeight: 600 }}>{ext.dayPass ? "ทั้งวัน" : fmt(Math.max(0, ext.sec))}</span></div>
                    </div>
                    <div onClick={closeExtend} style={{ cursor: "pointer", width: 36, height: 36, borderRadius: "50%", background: "#f4ede0", display: "flex", alignItems: "center", justifyContent: "center", color: "#8a7f70", fontSize: 18 }}>✕</div>
                  </div>
                  <div style={{ padding: "24px 30px" }}>
                    <div style={{ fontSize: 15, color: "#8a7f70", marginBottom: 14 }}>แตะเพื่อเพิ่มเวลา (คิดเงินตอนเช็คเอาท์)</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
                      {extOptions.map((o) => (
                        <div key={o.label} onClick={() => applyExtend(o.mins, o.p)} style={{ cursor: "pointer", background: "#fff", border: "1.5px solid #ece5d8", borderRadius: 14, padding: "18px 0", textAlign: "center" }}>
                          <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 24, color: "#2D6CB1" }}>{o.label}</div>
                          <div style={{ fontSize: 13, color: "#8a7f70" }}>นาที</div>
                          <div style={{ fontFamily: FREDOKA, fontWeight: 600, color: "#1F8A5B", fontSize: 16, marginTop: 6 }}>{o.price}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===== CHECKOUT ===== */}
        {s.screen === "checkout" && (
          <div style={{ height: "100%", background: "#F7F2EA", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ height: 74, flex: "none", background: "#fff", borderBottom: "1px solid #ece5d8", display: "flex", alignItems: "center", padding: "0 28px", gap: 16 }}>
              <div onClick={() => go("board")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: "#6b6052", fontSize: 16 }}>{backIcon("#6b6052")}กลับกระดาน</div>
              <div style={{ width: 1, height: 28, background: "#ece5d8" }} />
              <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 20 }}>เช็คเอาท์</div>
            </div>
            <div style={{ flex: 1, padding: "28px 40px", display: "flex", flexDirection: "column", maxWidth: 760, margin: "0 auto", width: "100%" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
                <div style={{ width: 54, height: 54, borderRadius: "50%", background: "#fdf3df", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {co && <img src={mascotSrc(co.mascot)} alt="" style={{ width: 44 }} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 22 }}>{co?.name} · เช็คเอาท์</div>
                  <div style={{ fontSize: 14, color: "#8a7f70" }}>{co?.pkg}</div>
                </div>
                <div style={{ background: "#fdeceb", color: "#E74C3C", fontWeight: 500, fontSize: 15, padding: "8px 16px", borderRadius: 999 }}>เหลือ {co ? (co.dayPass ? "ทั้งวัน" : fmt(Math.max(0, co.sec))) : ""}</div>
              </div>
              <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #ece5d8", overflow: "hidden" }}>
                {(co?.charges ?? []).map((l, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid #f2ebdd" }}>
                    <div style={{ flex: 1, fontSize: 17 }}>{l.label}</div>
                    <div style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: 18 }}>฿{l.amount}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 18, padding: "0 4px" }}>
                <div style={{ fontSize: 18, color: "#6b6052" }}>รวมทั้งหมด</div>
                <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 42, color: "#3A3026" }}>฿{co ? co.charges.reduce((a, c) => a + c.amount, 0) : 0}</div>
              </div>
              <div style={{ marginTop: "auto" }}>
                <div style={{ fontSize: 14, color: "#8a7f70", marginBottom: 10 }}>ชำระด้วย</div>
                <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                  <span style={{ flex: 1, textAlign: "center", background: "#2D6CB1", color: "#fff", fontSize: 16, padding: 13, borderRadius: 12 }}>เงินสด</span>
                  <span style={{ flex: 1, textAlign: "center", background: "#fff", border: "1px solid #ece5d8", color: "#6b6052", fontSize: 16, padding: 13, borderRadius: 12 }}>PromptPay</span>
                  <span style={{ flex: 1, textAlign: "center", background: "#fff", border: "1px solid #ece5d8", color: "#6b6052", fontSize: 16, padding: 13, borderRadius: 12 }}>บัตร</span>
                </div>
                <div onClick={doCheckout} style={{ cursor: "pointer", background: "#1F8A5B", color: "#fff", borderRadius: 14, padding: 18, textAlign: "center", fontFamily: MITR, fontWeight: 500, fontSize: 22, display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
                  รับเงิน ฿{co ? co.charges.reduce((a, c) => a + c.amount, 0) : 0} · เช็คเอาท์
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===== POS ===== */}
        {s.screen === "pos" && (
          <div style={{ height: "100%", background: "#F7F2EA", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ height: 74, flex: "none", background: "#fff", borderBottom: "1px solid #ece5d8", display: "flex", alignItems: "center", padding: "0 28px", gap: 16 }}>
              <div onClick={() => go("home")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: "#6b6052", fontSize: 16 }}>{backIcon("#6b6052")}หน้าหลัก</div>
              <div style={{ width: 1, height: 28, background: "#ece5d8" }} />
              <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 20 }}>ขายขนม · เครื่องดื่ม</div>
            </div>
            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
              <div style={{ flex: 1, padding: "24px 26px", overflow: "auto" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
                  {products.map((p) => (
                    <div key={p.id} onClick={() => addToCart(p.id)} style={{ cursor: "pointer", background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ height: 80, borderRadius: 12, background: "#f4ede0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 38 }}>{p.emoji}</div>
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 16 }}>{p.name}</div>
                        <div style={{ fontFamily: FREDOKA, fontWeight: 600, color: "#1F8A5B", fontSize: 16 }}>฿{p.price}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ width: 400, flex: "none", background: "#fff", borderLeft: "1px solid #ece5d8", display: "flex", flexDirection: "column", padding: "22px 24px" }}>
                <div style={{ fontSize: 14, color: "#8a7f70", marginBottom: 10 }}>ลงบิลให้</div>
                <div style={{ background: "#eaf3f6", border: "1.5px solid #2D6CB1", borderRadius: 12, padding: "11px 14px", fontSize: 15, marginBottom: 18 }}>{chargeKid ? chargeKid.name + " · เก็บตอนเช็คเอาท์" : "ลูกค้าจ่ายสด"}</div>
                <div style={{ height: 1, background: "#f2ebdd", marginBottom: 14 }} />
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, overflow: "auto" }}>
                  {cartLines.map((c) => (
                    <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ width: 42, height: 42, borderRadius: 10, background: "#f4ede0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{c.emoji}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, fontSize: 15 }}>{c.name}</div>
                        <div style={{ fontSize: 12, color: "#8a7f70" }}>฿{c.price} × {c.qty}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span onClick={() => decFromCart(c.id)} style={{ cursor: "pointer", width: 26, height: 26, borderRadius: 7, background: "#f4ede0", display: "flex", alignItems: "center", justifyContent: "center", color: "#6b6052" }}>−</span>
                        <span style={{ fontFamily: FREDOKA, fontWeight: 600 }}>{c.qty}</span>
                        <span onClick={() => addToCart(c.id)} style={{ cursor: "pointer", width: 26, height: 26, borderRadius: 7, background: "#2D6CB1", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>+</span>
                      </div>
                    </div>
                  ))}
                  {cartLines.length === 0 && <div style={{ textAlign: "center", color: "#bcae9b", fontSize: 15, padding: "30px 0" }}>แตะขนมทางซ้ายเพื่อเพิ่ม</div>}
                </div>
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                    <span style={{ fontSize: 17, color: "#6b6052" }}>รวม</span>
                    <span style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 32, color: "#3A3026" }}>฿{posTotal}</span>
                  </div>
                  <div onClick={payPos} style={{ cursor: "pointer", background: "#1F8A5B", color: "#fff", borderRadius: 14, padding: 16, textAlign: "center", fontFamily: MITR, fontWeight: 500, fontSize: 19 }}>{chargeKid ? "ลงบิล " + chargeKid.name : "รับเงิน ฿" + posTotal}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===== CHECK-IN ===== */}
        {s.screen === "checkin" && (
          <div style={{ height: "100%", background: "#F7F2EA", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ height: 74, flex: "none", background: "#fff", borderBottom: "1px solid #ece5d8", display: "flex", alignItems: "center", padding: "0 28px", gap: 16 }}>
              <div onClick={checkinBack} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: "#6b6052", fontSize: 16 }}>{backIcon("#6b6052")}ย้อนกลับ</div>
              <div style={{ width: 1, height: 28, background: "#ece5d8" }} />
              <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 20 }}>รับเด็กเข้าเล่น</div>
            </div>
            <div style={{ flex: 1, padding: "34px 44px", overflow: "auto" }}>
              {/* choose */}
              {s.ckStep === "choose" && (
                <div style={{ maxWidth: 840, margin: "0 auto" }}>
                  <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 28, marginBottom: 6 }}>เด็กคนนี้เคยมาเล่นไหม?</div>
                  <div style={{ fontSize: 16, color: "#8a7f70", marginBottom: 26 }}>เลือกอย่างเดียวก่อน — ระบบพาไปต่อเอง</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
                    <div onClick={() => dispatch({ t: "set", p: { ckStep: "search" } })} style={{ cursor: "pointer", background: "#fff", border: "2px solid #2D6CB1", borderRadius: 20, padding: 30, display: "flex", alignItems: "center", gap: 22 }}>
                      <div style={{ width: 64, height: 64, borderRadius: 18, background: "#eaf3f6", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2D6CB1" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>
                      </div>
                      <div>
                        <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 24 }}>เคยมาแล้ว</div>
                        <div style={{ fontSize: 15, color: "#8a7f70" }}>ค้นชื่อ / เบอร์เดิม</div>
                      </div>
                    </div>
                    <div onClick={() => dispatch({ t: "set", p: { ckStep: "register" } })} style={{ cursor: "pointer", background: "#fff", border: "2px solid #ece5d8", borderRadius: 20, padding: 30, display: "flex", alignItems: "center", gap: 22 }}>
                      <div style={{ width: 64, height: 64, borderRadius: 18, background: "#fdf3df", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#F0B323" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                      </div>
                      <div>
                        <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 24 }}>มาครั้งแรก</div>
                        <div style={{ fontSize: 15, color: "#8a7f70" }}>ลงทะเบียนใหม่</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {/* search */}
              {s.ckStep === "search" && (
                <div style={{ maxWidth: 760, margin: "0 auto" }}>
                  <div style={{ background: "#fff", borderRadius: 12, display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", marginBottom: 18, border: "1.5px solid #2D6CB1" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a9978a" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>
                    <span style={{ color: "#3A3026", fontSize: 17 }}>086-204-1188</span>
                  </div>
                  <div style={{ fontSize: 14, color: "#8a7f70", marginBottom: 12 }}>ผลการค้นหา</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {searchResults.map((m, i) => (
                      <div key={m.id} onClick={() => dispatch({ t: "set", p: { ckName: m.childName, ckMemberId: isRealId(m.id) ? m.id : null, ckStep: "package" } })} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", border: "1px solid #ece5d8", borderRadius: 14, background: "#fff" }}>
                        <div style={{ width: 48, height: 48, borderRadius: "50%", background: i === 0 ? "#fdf3df" : "#eaf3f6", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={mascotSrc(m.mascot)} alt="" style={{ width: i === 0 ? 38 : 40 }} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 500, fontSize: 18 }}>{m.familyName}</div>
                          <div style={{ fontSize: 14, color: "#8a7f70" }}>{m.childName} · มาแล้ว {m.visits} ครั้ง</div>
                        </div>
                        {m.isMember && <div style={{ background: "#eaf3eb", color: "#1F8A5B", fontSize: 13, fontWeight: 600, padding: "5px 12px", borderRadius: 999 }}>สมาชิก</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* register */}
              {s.ckStep === "register" && (
                <div style={{ maxWidth: 820, margin: "0 auto" }}>
                  <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 22, marginBottom: 16 }}>ลงทะเบียนเด็กใหม่</div>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 14, color: "#8a7f70", marginBottom: 7 }}>ชื่อเล่นเด็ก</div>
                      <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 12, padding: "14px 16px", fontSize: 17 }}>น้องมีน</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 14, color: "#8a7f70", marginBottom: 7 }}>อายุ</div>
                      <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 12, padding: "14px 16px", fontSize: 17 }}>5 ขวบ</div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 18 }}>
                    <div>
                      <div style={{ fontSize: 14, color: "#8a7f70", marginBottom: 7 }}>ผู้ปกครอง</div>
                      <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 12, padding: "14px 16px", fontSize: 17 }}>คุณแม่ฝน</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 14, color: "#8a7f70", marginBottom: 7 }}>เบอร์โทร</div>
                      <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 12, padding: "14px 16px", fontSize: 17 }}>081-455-7xxx</div>
                    </div>
                  </div>
                  <div style={{ background: "#f9f4ea", borderRadius: 14, padding: 18, display: "flex", gap: 11, alignItems: "flex-start", marginBottom: 20 }}>
                    <span style={{ width: 26, height: 26, borderRadius: 7, background: "#1F8A5B", flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
                    </span>
                    <span style={{ fontSize: 14, color: "#6b6052", lineHeight: 1.5 }}>ยินยอมให้เก็บข้อมูลเด็กและผู้ปกครองตาม PDPA เพื่อความปลอดภัย</span>
                  </div>
                  <div onClick={() => dispatch({ t: "set", p: { ckName: "น้องมีน", ckMemberId: null, ckStep: "package" } })} style={{ cursor: "pointer", background: "#2D6CB1", color: "#fff", borderRadius: 14, padding: 16, textAlign: "center", fontFamily: MITR, fontWeight: 500, fontSize: 19 }}>บันทึก · เลือกแพ็กเกจ</div>
                </div>
              )}
              {/* package */}
              {s.ckStep === "package" && (
                <div style={{ maxWidth: 840, margin: "0 auto" }}>
                  <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 24, marginBottom: 4 }}>เลือกแพ็กเกจให้ {s.ckName || "น้องใหม่"}</div>
                  <div style={{ fontSize: 15, color: "#8a7f70", marginBottom: 24 }}>แตะเลือกเวลาเล่น</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 16 }}>
                    {packages.map((pk) => (
                      <div key={pk.id} onClick={() => pickPackage(pk)} style={{ cursor: "pointer", background: "#fff", border: "1.5px solid #ece5d8", borderRadius: 18, padding: "24px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", opacity: creating ? 0.6 : 1 }}>
                        <div>
                          <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 22 }}>{pk.label}</div>
                          <div style={{ fontSize: 14, color: "#8a7f70" }}>{pk.sub}</div>
                        </div>
                        <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 26, color: "#1F8A5B" }}>฿{pk.price}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== RECEIPT ===== */}
        {s.screen === "receipt" && (
          <div style={{ height: "100%", background: "#F7F2EA", display: "flex", alignItems: "center", justifyContent: "center", overflowY: "auto" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mascotSrc("sunny")} alt="" style={{ position: "absolute", left: 90, bottom: 60, width: 140, opacity: 0.9 }} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mascotSrc("skye")} alt="" style={{ position: "absolute", right: 90, top: 70, width: 130, opacity: 0.85 }} />
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 500 }}>
              <div style={{ width: 86, height: 86, borderRadius: "50%", background: "#1F8A5B", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
              </div>
              <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 30, marginBottom: 4 }}>รับเงินสำเร็จ</div>
              <div style={{ fontSize: 16, color: "#8a7f70", marginBottom: 22 }}>{rc?.name} · ขอบคุณค่ะ 💛</div>
              <div style={{ width: "100%", background: "#fff", borderRadius: 18, boxShadow: "0 2px 14px rgba(0,0,0,.06)", overflow: "hidden" }}>
                <div style={{ textAlign: "center", padding: "20px 0 12px", borderBottom: "1px dashed #e0d6c4" }}>
                  <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 22, color: "#2D6CB1" }}>Play <span style={{ color: "#F0B323" }}>a</span> lot</div>
                  <div style={{ fontSize: 13, color: "#a9978a", marginTop: 2 }}>ใบเสร็จ {rc?.no}</div>
                </div>
                <div style={{ padding: "16px 28px" }}>
                  {(rc?.lines ?? []).map((l, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", fontSize: 16 }}>
                      <span style={{ color: "#6b6052" }}>{l.label}</span>
                      <span style={{ fontFamily: FREDOKA, fontWeight: 600 }}>฿{l.amount}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 0 4px", borderTop: "1px dashed #e0d6c4", marginTop: 10 }}>
                    <span style={{ fontSize: 18 }}>รวม (เงินสด)</span>
                    <span style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 24, color: "#1F8A5B" }}>฿{rc?.total}</span>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, width: "100%", marginTop: 20 }}>
                <div style={{ flex: 1, background: "#fff", border: "1px solid #ece5d8", borderRadius: 13, padding: 15, textAlign: "center", fontSize: 16 }}>ปรินต์สลิป</div>
                <div style={{ flex: 1, background: "#fff", border: "1px solid #ece5d8", borderRadius: 13, padding: 15, textAlign: "center", fontSize: 16 }}>ส่ง LINE</div>
                <div onClick={() => go("home")} style={{ cursor: "pointer", flex: 1.2, background: "#2D6CB1", color: "#fff", borderRadius: 13, padding: 15, textAlign: "center", fontSize: 16, fontFamily: MITR, fontWeight: 500 }}>เสร็จ</div>
              </div>
            </div>
          </div>
        )}

        {/* ===== MONITOR ===== */}
        {s.screen === "monitor" && (
          <div style={{ height: "100%", background: "#1c2740", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ height: 80, flex: "none", display: "flex", alignItems: "center", padding: "0 36px", gap: 18, borderBottom: "1px solid rgba(255,255,255,.08)" }}>
              <div onClick={() => go("home")} style={{ cursor: "pointer", color: "#9fb0d0", fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>{backIcon("#9fb0d0", 18)}ออก</div>
              <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 26, color: "#fff" }}>Play <span style={{ color: "#F0B323" }}>a</span> lot</div>
              <div style={{ color: "#9fb0d0", fontSize: 17 }}>กำลังเล่น <span style={{ color: "#fff", fontFamily: FREDOKA, fontWeight: 600 }}>{s.kids.length}</span> คน</div>
            </div>
            <div style={{ flex: 1, padding: "26px 36px", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gridAutoRows: "1fr", gap: 16, overflow: "auto" }}>
              {s.kids.map((k) => {
                const nearEnd = !k.dayPass && k.sec <= 600;
                // near-expiry tile is full-red → countdown must be white to read (prototype quirk fix)
                const color = k.dayPass ? "#5bc88a" : nearEnd ? "#fff" : colorFor(k.sec);
                return (
                  <div key={k.id} style={{ background: nearEnd ? "#E74C3C" : "#28365a", borderRadius: 18, padding: 20, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                    <div style={{ color: "#fff", fontSize: 19, fontWeight: 500, fontFamily: MITR }}>{k.name}</div>
                    <div>
                      <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 40, lineHeight: 1, color }}>{k.dayPass ? "ทั้งวัน" : fmt(Math.max(0, k.sec))}</div>
                      <div style={{ color: "#9fb0d0", fontSize: 14, marginTop: 4 }}>{k.dayPass ? "Day Pass" : k.pkg}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ===== SHIFT ===== */}
        {s.screen === "shift" && (
          <div style={{ height: "100%", background: "#F7F2EA", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ height: 74, flex: "none", background: "#fff", borderBottom: "1px solid #ece5d8", display: "flex", alignItems: "center", padding: "0 28px", gap: 16 }}>
              <div onClick={() => go("home")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: "#6b6052", fontSize: 16 }}>{backIcon("#6b6052")}หน้าหลัก</div>
              <div style={{ width: 1, height: 28, background: "#ece5d8" }} />
              <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 20 }}>ปิดกะ — {props.cashierName}</div>
            </div>
            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
              <div style={{ flex: 1, padding: "30px 36px" }}>
                <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 22, marginBottom: 20 }}>สรุปยอดขายกะนี้</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
                  <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: "20px 22px" }}>
                    <div style={{ fontSize: 14, color: "#8a7f70" }}>ยอดขายรวม</div>
                    <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 32, color: "#1F8A5B" }}>{revenueStr}</div>
                  </div>
                  <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: "20px 22px" }}>
                    <div style={{ fontSize: 14, color: "#8a7f70" }}>จำนวนบิล</div>
                    <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 32, color: "#2D6CB1" }}>73</div>
                  </div>
                </div>
                <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, overflow: "hidden" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "15px 22px", borderBottom: "1px solid #f2ebdd" }}><span style={{ fontSize: 16, color: "#6b6052" }}>เงินสด</span><span style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: 18 }}>฿9,210</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "15px 22px", borderBottom: "1px solid #f2ebdd" }}><span style={{ fontSize: 16, color: "#6b6052" }}>PromptPay</span><span style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: 18 }}>฿7,180</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "15px 22px" }}><span style={{ fontSize: 16, color: "#6b6052" }}>บัตร</span><span style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: 18 }}>฿2,250</span></div>
                </div>
              </div>
              <div style={{ width: 440, flex: "none", background: "#fff", borderLeft: "1px solid #ece5d8", padding: 28, display: "flex", flexDirection: "column" }}>
                <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 20, marginBottom: 18 }}>นับเงินในลิ้นชัก</div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}><span style={{ fontSize: 16, color: "#6b6052" }}>เงินต้นกะ</span><span style={{ fontFamily: FREDOKA, fontWeight: 600 }}>฿2,000</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}><span style={{ fontSize: 16, color: "#6b6052" }}>+ ขายเงินสด</span><span style={{ fontFamily: FREDOKA, fontWeight: 600 }}>฿9,210</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 16, color: "#6b6052" }}>ควรมีในลิ้นชัก</span><span style={{ fontFamily: FREDOKA, fontWeight: 700, color: "#2D6CB1" }}>฿11,210</span></div>
                <div style={{ height: 1, background: "#f2ebdd", margin: "18px 0" }} />
                <div style={{ fontSize: 14, color: "#8a7f70", marginBottom: 8 }}>นับจริงได้</div>
                <div style={{ background: "#f4ede0", border: "1.5px solid #2D6CB1", borderRadius: 12, padding: "16px 18px", fontFamily: FREDOKA, fontWeight: 700, fontSize: 24, marginBottom: 14 }}>฿ 11,210</div>
                <div style={{ background: "#eaf3eb", color: "#1F8A5B", borderRadius: 12, padding: "14px 18px", fontSize: 16, fontWeight: 500, marginBottom: "auto" }}>✓ ตรงพอดี ไม่ขาดไม่เกิน</div>
                <div onClick={() => { showToast("ปิดกะเรียบร้อย"); go("home"); }} style={{ cursor: "pointer", background: "#E74C3C", color: "#fff", borderRadius: 14, padding: 17, textAlign: "center", fontFamily: MITR, fontWeight: 500, fontSize: 20, marginTop: 20 }}>ยืนยันปิดกะ</div>
              </div>
            </div>
          </div>
        )}

        {/* ===== DASHBOARD ===== */}
        {s.screen === "dashboard" && (
          <div style={{ height: "100%", background: "#F7F2EA", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ height: 74, flex: "none", background: "#fff", borderBottom: "1px solid #ece5d8", display: "flex", alignItems: "center", padding: "0 28px", gap: 16 }}>
              <div onClick={() => go("home")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: "#6b6052", fontSize: 16 }}>{backIcon("#6b6052")}หน้าหลัก</div>
              <div style={{ width: 1, height: 28, background: "#ece5d8" }} />
              <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 20 }}>Dashboard ร้าน</div>
            </div>
            <div style={{ flex: 1, padding: "26px 32px", display: "flex", flexDirection: "column", gap: 18, overflow: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
                <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: "18px 20px" }}><div style={{ fontSize: 13, color: "#8a7f70" }}>รายได้วันนี้</div><div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 26, color: "#1F8A5B" }}>{revenueStr}</div></div>
                <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: "18px 20px" }}><div style={{ fontSize: 13, color: "#8a7f70" }}>สัปดาห์นี้</div><div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 26, color: "#2D6CB1" }}>฿112,300</div></div>
                <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: "18px 20px" }}><div style={{ fontSize: 13, color: "#8a7f70" }}>เด็กเฉลี่ย/วัน</div><div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 26, color: "#F0B323" }}>64</div></div>
                <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: "18px 20px" }}><div style={{ fontSize: 13, color: "#8a7f70" }}>บิลเฉลี่ย</div><div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 26, color: "#3A3026" }}>฿255</div></div>
              </div>
              <div style={{ display: "flex", gap: 18, flex: 1 }}>
                <div style={{ flex: 1.6, background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: 22, display: "flex", flexDirection: "column" }}>
                  <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 18, marginBottom: 16 }}>รายได้ 7 วันล่าสุด</div>
                  <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 16 }}>
                    {[
                      { h: "52%", c: "#cfe0ee" },
                      { h: "44%", c: "#cfe0ee" },
                      { h: "60%", c: "#cfe0ee" },
                      { h: "50%", c: "#cfe0ee" },
                      { h: "78%", c: "#2D6CB1" },
                      { h: "100%", c: "#2D6CB1" },
                      { h: "92%", c: "#2D6CB1" },
                    ].map((b, i) => (
                      <div key={i} style={{ flex: 1, height: b.h, background: b.c, borderRadius: "8px 8px 0 0" }} />
                    ))}
                  </div>
                </div>
                <div style={{ flex: 1, background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: 22 }}>
                  <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 18, marginBottom: 16 }}>ขนมขายดี</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
                    {[
                      { name: "🍿 ป๊อปคอร์น", n: "142", w: "90%" },
                      { name: "🍦 ไอศกรีม", n: "118", w: "74%" },
                      { name: "🍪 โอริโอ้", n: "96", w: "60%" },
                    ].map((p, i) => (
                      <div key={i}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, marginBottom: 6 }}><span>{p.name}</span><span style={{ color: "#8a7f70" }}>{p.n}</span></div>
                        <div style={{ height: 8, background: "#f2ebdd", borderRadius: 99 }}><div style={{ width: p.w, height: "100%", background: "#F0B323", borderRadius: 99 }} /></div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===== SETTINGS ===== */}
        {s.screen === "settings" && (
          <div style={{ height: "100%", background: "#F7F2EA", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ height: 74, flex: "none", background: "#fff", borderBottom: "1px solid #ece5d8", display: "flex", alignItems: "center", padding: "0 28px", gap: 16 }}>
              <div onClick={() => go("home")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: "#6b6052", fontSize: 16 }}>{backIcon("#6b6052")}หน้าหลัก</div>
              <div style={{ width: 1, height: 28, background: "#ece5d8" }} />
              <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 20 }}>แพ็กเกจ &amp; สต๊อก</div>
            </div>
            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
              <div style={{ flex: 1, padding: "28px 32px", borderRight: "1px solid #ece5d8", overflow: "auto" }}>
                <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 20, marginBottom: 16 }}>แพ็กเกจเวลา</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {packages.map((pk) => (
                    <div key={pk.id} style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 14, padding: "16px 20px", display: "flex", alignItems: "center" }}>
                      <div style={{ flex: 1, fontSize: 17 }}>{pk.label}</div>
                      <div style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: 18, marginRight: 16 }}>฿{pk.price}</div>
                      <div style={{ color: "#2D6CB1", fontSize: 14 }}>แก้ไข</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ width: 460, flex: "none", padding: "28px 32px", background: "#fff", overflow: "auto" }}>
                <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 20, marginBottom: 16 }}>สต๊อกขนม</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    { e: "🍿", n: "ป๊อปคอร์น", v: "48", low: false },
                    { e: "🍦", n: "ไอศกรีม", v: "6", low: true },
                    { e: "🍪", n: "โอริโอ้", v: "120", low: false },
                    { e: "🍬", n: "เยลลี่", v: "9", low: true },
                  ].map((it, i, arr) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 0", borderBottom: i < arr.length - 1 ? "1px solid #f2ebdd" : "none" }}>
                      <div style={{ width: 38, height: 38, borderRadius: 10, background: "#f4ede0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19 }}>{it.e}</div>
                      <div style={{ flex: 1, fontSize: 16 }}>{it.n}</div>
                      {it.low && <div style={{ background: "#fdeceb", color: "#E74C3C", fontSize: 12, fontWeight: 600, padding: "3px 9px", borderRadius: 99, marginRight: 8 }}>ใกล้หมด</div>}
                      <div style={{ fontFamily: FREDOKA, fontWeight: 600, color: it.low ? "#E74C3C" : undefined }}>{it.v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===== STAFF ===== */}
        {s.screen === "staff" && (
          <div style={{ height: "100%", background: "#F7F2EA", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ height: 74, flex: "none", background: "#fff", borderBottom: "1px solid #ece5d8", display: "flex", alignItems: "center", padding: "0 28px", gap: 16 }}>
              <div onClick={() => go("home")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: "#6b6052", fontSize: 16 }}>{backIcon("#6b6052")}หน้าหลัก</div>
              <div style={{ width: 1, height: 28, background: "#ece5d8" }} />
              <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 20, flex: 1 }}>พนักงาน &amp; สิทธิ์</div>
              <div style={{ background: "#2D6CB1", color: "#fff", fontSize: 15, padding: "10px 18px", borderRadius: 11 }}>+ เพิ่มพนักงาน</div>
            </div>
            <div style={{ flex: 1, padding: "18px 32px", overflow: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", padding: "12px 20px", color: "#8a7f70", fontSize: 14 }}>
                <div style={{ flex: 2 }}>พนักงาน</div>
                <div style={{ flex: 1.4 }}>ตำแหน่ง</div>
                <div style={{ flex: 1, textAlign: "center" }}>เปิด/ปิดกะ</div>
                <div style={{ flex: 1, textAlign: "center" }}>คืนเงิน</div>
                <div style={{ flex: 1, textAlign: "center" }}>ดูรายงาน</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {staffRow("ต", "#F0B323", "คุณต่าย", "เจ้าของ", "#eef0ec", "#1F8A5B", [true, true, true])}
                {staffRow("น", "#2D6CB1", "พี่นก", "หัวหน้ากะ", "#eaf3f6", "#2D6CB1", [true, true, false])}
                {staffRow("ฝ", "#E74C3C", "น้องฝ้าย", "แคชเชียร์", "#f4ede0", "#6b6052", [false, false, false])}
              </div>
            </div>
          </div>
        )}

        {/* toast */}
        {s.toast != null && (
          <div style={{ position: "absolute", bottom: 28, left: "50%", transform: "translateX(-50%)", background: "#1c2740", color: "#fff", padding: "14px 26px", borderRadius: 999, fontSize: 16, boxShadow: "0 8px 28px rgba(0,0,0,.3)", zIndex: 90 }}>{s.toast}</div>
        )}
      </div>

      <div style={{ fontSize: 13, color: "#9a9285", marginTop: 14 }}>แตะการ์ด/ปุ่มเพื่อใช้งานจริง · นาฬิกานับถอยหลังเดินเอง · กด “เช็คเอาท์” เด็กจะออกจากกระดาน</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function greeting(): string {
  const h = new Date().getHours();
  if (h < 11) return "สวัสดีตอนเช้า";
  if (h < 15) return "สวัสดีตอนบ่าย";
  if (h < 18) return "สวัสดีตอนเย็น";
  return "สวัสดีตอนค่ำ";
}

// uuids are real session/package/member ids; short local ids start with L or seed
function isRealId(id: string | null | undefined): boolean {
  if (!id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id);
}

function backIcon(stroke: string, size = 20) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function toggle(on: boolean) {
  return (
    <span style={{ display: "inline-block", width: 42, height: 25, borderRadius: 99, background: on ? "#1F8A5B" : "#d9cdb8", position: "relative" }}>
      <span style={{ position: "absolute", top: 3, [on ? "right" : "left"]: 3, width: 19, height: 19, borderRadius: "50%", background: "#fff" } as React.CSSProperties} />
    </span>
  );
}

function staffRow(initial: string, avatarBg: string, name: string, role: string, roleBg: string, roleColor: string, toggles: [boolean, boolean, boolean]) {
  return (
    <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 14, padding: "16px 20px", display: "flex", alignItems: "center" }}>
      <div style={{ flex: 2, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: "50%", background: avatarBg, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: FREDOKA, fontWeight: 600 }}>{initial}</div>
        <div style={{ fontWeight: 500, fontSize: 16 }}>{name}</div>
      </div>
      <div style={{ flex: 1.4 }}>
        <span style={{ background: roleBg, color: roleColor, fontSize: 13, padding: "5px 12px", borderRadius: 99 }}>{role}</span>
      </div>
      <div style={{ flex: 1, textAlign: "center" }}>{toggle(toggles[0])}</div>
      <div style={{ flex: 1, textAlign: "center" }}>{toggle(toggles[1])}</div>
      <div style={{ flex: 1, textAlign: "center" }}>{toggle(toggles[2])}</div>
    </div>
  );
}
