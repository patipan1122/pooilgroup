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
  createBooking,
  searchMembersAction,
  openShift,
  closeShift,
  type MemberSearchHit,
} from "@/lib/playland/actions";
import {
  issueWristband,
  lookupWristband,
  activateWristband,
  exitWristband,
  type WristbandLookup,
} from "@/lib/playland/wristband";
import { printWristband } from "@/components/playland/print-wristband";
import { BarcodeScanBox } from "@/components/playland/barcode-scan-box";
import { lookupProductByBarcode } from "@/lib/playland/stock";
import { overtimeFromSec, DEFAULT_OVERTIME_RATE_PER_MIN_CENTS } from "@/lib/playland/overtime";

const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";

// Shared themed input style (keeps the app's inline aesthetic on every new form)
const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#fff",
  border: "1px solid #ece5d8",
  borderRadius: 12,
  padding: "14px 16px",
  fontSize: 17,
  fontFamily: MITR,
  color: "#3A3026",
  outline: "none",
  boxSizing: "border-box",
};

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
  image?: string | null; // resolved R2 public URL (null → emoji/curated fallback)
}
export interface PlaylandMemberVM {
  id: string;
  name: string;
  nickname: string | null;
  phone: string | null;
  memberCode: string | null;
  type: string; // "KID" | "PARENT" | ...
  lastVisit: string | null;
  mascot: string;
}
export interface PlaylandBookingVM {
  id: string;
  code: string;
  customerName: string;
  customerPhone: string;
  slotTime: string; // formatted HH:mm
  slotDate: string; // formatted
  pkgName: string;
  partySize: number;
  amount: number; // baht
  status: string; // PENDING | PAID | CHECKED_IN | CANCELLED | EXPIRED | NO_SHOW
}
export interface PlaylandStats {
  revenue: number; // baht today (total)
  entryRevenue: number;
  productRevenue: number;
  kidsActive: number;
  sessionsToday: number;
  memberCount: number;
  salesCount: number;
  bookingsToday: number;
}
export interface PlaylandShiftVM {
  id: string;
  openingCashCents: number;
  totalSalesCents: number;
  cashSalesCents: number; // เงินสดที่รับจริงในกะ (จากรายการขายจริง) → ใช้คิด "ควรมีในลิ้นชัก"
}
interface Props {
  initialKids: PlaylandKid[];
  packages: PlaylandPackageVM[];
  products: PlaylandProductVM[];
  members?: PlaylandMemberVM[];
  bookings?: PlaylandBookingVM[];
  stats?: PlaylandStats;
  revenue: number; // baht today (kept for back-compat)
  branchId: string;
  branchSlug?: string | null;
  cashierName: string;
  hasOpenShift?: boolean;
  shift?: PlaylandShiftVM | null; // open shift financials → ปิดกะ/เปิดกะ จริง
  overtimeRatePerMinuteCents?: number; // เรตค่าปรับเกินเวลา (สตางค์/นาที) ของสาขา
  initialScreen?: Screen; // deep-link from redirected old routes (?screen=)
}

export type Screen =
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
  | "staff"
  | "members"
  | "wristband"
  | "bookings";
type CkStep = "choose" | "search" | "register" | "package" | "pay";
type PayMethod = "CASH" | "PROMPTPAY" | "CARD";

interface Receipt {
  name: string;
  no: string;
  lines: { label: string; amount: number }[];
  total: number;
  bandCode?: string | null; // when a wristband was printed
  adultCount?: number;
  kind?: "checkin" | "pos" | "checkout"; // controls receipt copy
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
  ckNickname: string;
  ckMemberId: string | null; // real memberId chosen/created for check-in (null = needs createMember)
  ckPkg: PlaylandPackageVM | null; // package chosen, awaiting payment
  ckPay: PayMethod;
  ckAdults: number; // adults coming with the child (0-4)
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
// Module-scope impure helpers (called from event handlers — never during render,
// and the React-compiler lint only flags impure calls *inside* the component body)
function randReceiptNo(): string {
  return "#" + (740 + Math.floor(Math.random() * 60));
}
function randMascot(): string {
  return MASCOTS[Math.floor(Math.random() * 3)];
}
function randBandCode(): string {
  return "PW-" + Math.random().toString(36).slice(2, 11).toUpperCase();
}
function localKidId(): string {
  return "L" + Date.now().toString(36) + Math.floor(Math.random() * 1000);
}

// Curated real-photo fallbacks (stable hotlink-friendly Wikimedia Commons URLs).
// Keyed by name keyword → used when a product has no uploaded image.
// onError in the tile falls back to the emoji tile, so a dead URL never breaks UI.
const PRODUCT_PHOTO_FALLBACKS: { keys: string[]; url: string }[] = [
  { keys: ["โค้ก", "coke", "โคคา", "cola"], url: "https://upload.wikimedia.org/wikipedia/commons/c/ca/Coca-Cola_bottle_cap.jpg" },
  { keys: ["น้ำเปล่า", "น้ำดื่ม", "water", "น้ำ "], url: "https://upload.wikimedia.org/wikipedia/commons/e/e2/Bottle_of_water.jpg" },
  { keys: ["ป๊อป", "popcorn"], url: "https://upload.wikimedia.org/wikipedia/commons/5/51/Popcorn_in_a_bowl.jpg" },
  { keys: ["ไอติม", "ไอศ", "ไอศกรีม", "ice cream", "icecream", "ice"], url: "https://upload.wikimedia.org/wikipedia/commons/0/0e/Ice_Cream_dessert_02.jpg" },
  { keys: ["คุกกี้", "cookie", "โอริ", "oreo"], url: "https://upload.wikimedia.org/wikipedia/commons/2/29/2ChocolateChipCookies.jpg" },
  { keys: ["เยลลี่", "เยลลี", "jelly", "gummy"], url: "https://upload.wikimedia.org/wikipedia/commons/5/56/Gummy_bears.jpg" },
  { keys: ["โดนัท", "donut", "doughnut"], url: "https://upload.wikimedia.org/wikipedia/commons/3/3c/Glazed-Donut.jpg" },
  { keys: ["นม", "milk"], url: "https://upload.wikimedia.org/wikipedia/commons/b/bb/Milk_glass.jpg" },
  { keys: ["น้ำส้ม", "ส้ม", "juice", "orange"], url: "https://upload.wikimedia.org/wikipedia/commons/9/9e/Orange_juice_1.jpg" },
  { keys: ["ช็อก", "choc"], url: "https://upload.wikimedia.org/wikipedia/commons/7/70/Chocolate_%28blue_background%29.jpg" },
  { keys: ["เค้ก", "cake", "คัพ"], url: "https://upload.wikimedia.org/wikipedia/commons/d/d7/Strawberry_cupcakes.jpg" },
];
function curatedPhoto(name: string): string | null {
  const n = name.toLowerCase();
  for (const f of PRODUCT_PHOTO_FALLBACKS) {
    if (f.keys.some((k) => n.includes(k.toLowerCase().trim()))) return f.url;
  }
  return null;
}
// Resolve the best image source for a product tile (uploaded → curated → null)
function productImageSrc(p: PlaylandProductVM): string | null {
  return p.image ?? curatedPhoto(p.name);
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
  | { t: "checkinReceipt"; kid: PlaylandKid; receipt: Receipt }
  | { t: "posReceipt"; receipt: Receipt; total: number };

function reducer(s: State, a: Action): State {
  switch (a.t) {
    case "tick":
      // เวลาเดินต่อแม้ติดลบ = เกินเวลา (overtime) · day pass ไม่นับ · หยุดที่ -24 ชม. กันเลขเพี้ยน
      return { ...s, kids: s.kids.map((k) => (k.dayPass || k.sec <= -86400 ? k : { ...k, sec: k.sec - 1 })) };
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
      // Checkout collects NO money now (everything is pre-paid) → revenue unchanged.
      return {
        ...s,
        receipt: a.receipt,
        kids: s.kids.filter((k) => k.id !== a.kidId),
        coKidId: null,
        screen: "receipt",
      };
    case "addKid":
      return {
        ...s,
        kids: [...s.kids, a.kid],
        ckStep: "choose",
        ckName: "",
        ckNickname: "",
        ckMemberId: null,
        ckPkg: null,
        ckAdults: 1,
      };
    case "checkinReceipt":
      return {
        ...s,
        kids: [...s.kids, a.kid],
        receipt: a.receipt,
        revenue: s.revenue + a.receipt.total,
        ckStep: "choose",
        ckName: "",
        ckNickname: "",
        ckMemberId: null,
        ckPkg: null,
        ckAdults: 1,
        screen: "receipt",
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
  const propMembers = props.members;
  const initialMembers = useMemo(() => propMembers ?? [], [propMembers]);
  const stats = props.stats;

  const [state, dispatch] = useReducer(reducer, {
    screen: props.initialScreen ?? "home",
    kids: props.initialKids,
    revenue: stats?.revenue ?? props.revenue,
    coKidId: null,
    extKidId: null,
    cart: {},
    chargeKidId: null,
    ckStep: "choose",
    ckName: "",
    ckNickname: "",
    ckMemberId: null,
    ckPkg: null,
    ckPay: "CASH",
    ckAdults: 1,
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
  // ยิงบาร์โค้ด (USB/กล้อง) → หาสินค้าจริง → ใส่ตะกร้า
  const scanBarcode = async (code: string) => {
    if (props.products.length === 0) { showToast("เดโม: ยังไม่มีสินค้าจริงให้สแกน"); return; }
    try {
      const res = await lookupProductByBarcode({ branchId: props.branchId, barcode: code });
      if (res.ok) { addToCart(res.data.id); showToast(`+ ${res.data.name} ฿${Math.round(res.data.priceCents / 100)}`); }
      else showToast("❌ " + res.error);
    } catch { showToast("❌ สแกนไม่สำเร็จ · ลองใหม่"); }
  };
  const decFromCart = (id: string) => dispatch({ t: "decCart", id });

  const checkoutKid = (id: string) => dispatch({ t: "set", p: { coKidId: id, screen: "checkout" } });
  const addSnackFor = (id: string) => dispatch({ t: "set", p: { chargeKidId: id, screen: "pos" } });
  const openExtend = (id: string) => dispatch({ t: "set", p: { extKidId: id } });
  const closeExtend = () => dispatch({ t: "set", p: { extKidId: null } });

  // ----- POS pay (immediate paid sale; charges to a kid's session if chosen) -----
  const [posPay, setPosPay] = useState<PayMethod>("CASH");
  const [coPay, setCoPay] = useState<PayMethod>("CASH"); // วิธีจ่ายค่าปรับเกินเวลา (ตอนเช็คเอาท์)
  // กันกดรัว/กดซ้ำ = ขายซ้ำ/เช็คเอาท์ซ้ำ (busyRef กันแบบ sync · busy คุมปุ่ม disabled)
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  // ปิดกะ/เปิดกะ — ต่อ openShift/closeShift จริง
  const [shiftOpening, setShiftOpening] = useState("");
  const [shiftClosing, setShiftClosing] = useState("");
  const [shiftDayClose, setShiftDayClose] = useState(false);
  const [shiftBusy, setShiftBusy] = useState(false);
  const payPos = async () => {
    if (busyRef.current) return; // กันกดรัว = ขายซ้ำ
    const lines = cartLines;
    if (lines.length === 0) {
      showToast("ยังไม่มีรายการ");
      return;
    }
    const total = lines.reduce((a, l) => a + l.price * l.qty, 0);
    const kid = s.chargeKidId != null ? s.kids.find((k) => k.id === s.chargeKidId) : undefined;

    // real createSale when products map to real ids (preset ids are p1..p8)
    const realItems = lines
      .filter((l) => !l.id.startsWith("p") || l.id.length > 3)
      .map((l) => ({ productId: l.id, quantity: l.qty }));
    const usingRealProducts = props.products.length > 0 && realItems.length === lines.length;

    const showReceipt = () =>
      dispatch({
        t: "posReceipt",
        receipt: {
          name: kid ? kid.name : "ลูกค้า",
          no: randReceiptNo(),
          lines: lines.map((l) => ({ label: l.name + " ×" + l.qty, amount: l.price * l.qty })),
          total,
          kind: "pos",
        },
        total,
      });

    if (usingRealProducts) {
      // เก็บเงินจริงก่อน → สำเร็จค่อยโชว์ใบเสร็จ "รับเงินแล้ว" (เดิมโชว์ก่อน await · พังก็เงียบ)
      busyRef.current = true;
      setBusy(true);
      try {
        const res = await createSale({
          branchId: props.branchId,
          items: realItems,
          paymentMethod: PAY_MAP[posPay],
          sessionId: kid && isRealId(kid.id) ? kid.id : undefined,
        });
        if (res.ok) {
          showReceipt();
          showToast("รับเงิน ฿" + total + " แล้ว");
          router.refresh();
        } else {
          showToast("❌ " + res.error);
        }
      } catch {
        showToast("❌ บันทึกการขายไม่สำเร็จ · ยังไม่ได้รับเงิน · ลองใหม่");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    } else {
      // preset/demo products (ไม่มีหลังบ้าน) → optimistic
      showReceipt();
      showToast("รับเงิน ฿" + total + " แล้ว");
    }
  };

  // ----- checkout = ปิดรอบ + เก็บค่าปรับเกินเวลา (ถ้ามี) -----
  const doCheckout = async () => {
    if (busyRef.current) return; // กันกดรัว = เช็คเอาท์/เก็บเงินซ้ำ
    const kid = s.kids.find((k) => k.id === s.coKidId);
    if (!kid) {
      go("board");
      return;
    }
    const kidId = kid.id;
    const baseTotal = kid.charges.reduce((a, c) => a + c.amount, 0);
    const rate = props.overtimeRatePerMinuteCents ?? DEFAULT_OVERTIME_RATE_PER_MIN_CENTS;
    const ot = kid.dayPass ? { minutes: 0, cents: 0 } : overtimeFromSec(kid.sec, rate);
    // ใช้ค่าปรับจาก server เป็นหลัก (authoritative) — ส่ง otCents มาตอน build ใบเสร็จ
    const complete = (otCents: number) => {
      const otBaht = Math.round(otCents / 100);
      const lines = [
        ...kid.charges,
        ...(otBaht > 0 ? [{ label: `ค่าปรับเกินเวลา ${ot.minutes} นาที`, amount: otBaht }] : []),
      ];
      dispatch({
        t: "completeCheckout",
        kidId,
        receipt: { name: kid.name, no: randReceiptNo(), lines, total: baseTotal + otBaht, kind: "checkout" },
      });
      showToast(
        kid.name + " เช็คเอาท์แล้ว" + (otBaht > 0 ? ` · เก็บค่าปรับ ฿${otBaht}` : "") + " · คืนสายรัด",
      );
    };
    // real session ids are uuids; preset/local kids use short numeric ids
    if (isRealId(kidId)) {
      busyRef.current = true;
      setBusy(true);
      try {
        const res = await checkOutSession({ sessionId: kidId, overtimePaymentMethod: PAY_MAP[coPay] });
        if (res.ok) {
          complete(res.data.overtimeCents);
          router.refresh();
        } else {
          showToast("❌ " + res.error);
        }
      } catch {
        showToast("❌ เช็คเอาท์ไม่สำเร็จ · ลองใหม่");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    } else {
      complete(ot.cents); // preset/demo → optimistic
    }
  };

  // ----- extend (paid immediately with chosen method) -----
  const [extPay, setExtPay] = useState<PayMethod>("CASH");
  const [boardQuery, setBoardQuery] = useState(""); // ค้นชื่อเด็กบนกระดาน (หาเร็วตอนเช็คเอาท์)
  const applyExtend = async (opt: { id: string; mins: number; p: number }) => {
    if (busyRef.current) return; // กันกดรัว = ต่อเวลา/เก็บเงินซ้ำ
    const kidId = s.extKidId;
    if (!kidId) return;
    // ใช้แพ็กเกจตามที่กดจริง (id ตรง) → ราคาที่โชว์ = ที่ชาร์จจริง
    const pkg = packages.find((p) => p.id === opt.id) ?? packages.find((p) => p.mins === opt.mins) ?? packages.find((p) => p.mins > 0);
    if (isRealId(kidId) && pkg && isRealId(pkg.id)) {
      busyRef.current = true;
      setBusy(true);
      try {
        const res = await extendSession({ sessionId: kidId, extraPackageId: pkg.id, paymentMethod: PAY_MAP[extPay] });
        if (res.ok) {
          dispatch({ t: "applyExtendLocal", kidId, mins: opt.mins, price: opt.p });
          showToast("ต่อเวลา +" + opt.mins + " นาที · รับเงิน ฿" + opt.p);
          router.refresh();
        } else {
          showToast("❌ " + res.error);
        }
      } catch {
        showToast("❌ ต่อเวลาไม่สำเร็จ · ยังไม่ได้รับเงิน · ลองใหม่");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    } else {
      // preset/demo → optimistic
      dispatch({ t: "applyExtendLocal", kidId, mins: opt.mins, price: opt.p });
      showToast("ต่อเวลา +" + opt.mins + " นาที · รับเงิน ฿" + opt.p);
    }
  };

  // ----- check-in: pick package → goes to PAY step (no timer yet) -----
  const [creating, setCreating] = useState(false);
  const pickPackage = (pkg: PlaylandPackageVM) => {
    dispatch({ t: "set", p: { ckPkg: pkg, ckStep: "pay" } });
  };

  // ----- check-in: confirm payment → createMember? → checkIn → issueWristband → print -----
  const PAY_MAP: Record<PayMethod, "CASH" | "PROMPTPAY" | "STRIPE" | "CHARGE_TO_MEMBER"> = {
    CASH: "CASH",
    PROMPTPAY: "PROMPTPAY",
    CARD: "STRIPE",
  };
  const confirmCheckin = async () => {
    if (creating) return;
    const pkg = s.ckPkg;
    if (!pkg) return;
    const name = s.ckName || "น้องใหม่";
    const mascot = randMascot();
    const adults = s.ckAdults;
    const payMethod = PAY_MAP[s.ckPay];

    const buildReceipt = (bandCode: string | null): Receipt => ({
      name,
      no: randReceiptNo(),
      lines: [{ label: "ค่าเล่น " + pkg.label, amount: pkg.price }],
      total: pkg.price,
      bandCode,
      adultCount: adults,
      kind: "checkin",
    });

    // Real wiring: ensure member → check in (เก็บเงิน) → issue wristband + บังคับปริ้น
    if (props.branchId && isRealId(pkg.id)) {
      setCreating(true);
      try {
        let memberId = s.ckMemberId;
        if (!memberId) {
          const cm = await createMember({
            branchId: props.branchId,
            type: "KID",
            name,
            nickname: s.ckNickname || name,
            consentGiven: true,
            newFamilyGroupName: `ครอบครัว ${name}`,
          });
          if (cm.ok) memberId = cm.data.memberId;
          else { showToast("❌ " + cm.error); return; }
        }
        const ci = await checkInSession({
          branchId: props.branchId,
          memberId,
          packageId: pkg.id,
          paymentMethod: payMethod,
        });
        // เก็บเงินไม่สำเร็จ → แจ้ง error + หยุด · ห้ามตกไป optimistic แล้วโชว์ "รับเงินแล้ว" (เงินหายเงียบ)
        if (!ci.ok) { showToast("❌ " + ci.error + " · ยังไม่ได้รับเงิน"); return; }

        // Issue wristband (best-effort; requires open shift + cashier role)
        let bandCode: string | null = null;
        try {
          const wb = await issueWristband({ branchId: props.branchId, memberId });
          if (wb.ok) bandCode = wb.data.code;
        } catch {
          /* wristband optional — proceed */
        }
        if (bandCode) {
          // CEO: หลังคิดเงินเสร็จ "บังคับ" ปริ้นสายรัด · ถ้า popup ถูกบล็อก แจ้งให้กดพิมพ์ซ้ำ
          const printed = printWristband({ code: bandCode, memberName: name, nickname: s.ckNickname || null, adultCount: adults });
          if (!printed) showToast("⚠️ เบราว์เซอร์บล็อกการพิมพ์ · กด 'พิมพ์สายรัดซ้ำ' ที่ใบเสร็จ");
        }
        dispatch({
          t: "checkinReceipt",
          kid: {
            id: ci.data.sessionId,
            name,
            mascot,
            pkg: pkg.label,
            sec: pkg.mins * 60,
            dayPass: pkg.mins === 0,
            charges: [{ label: "ค่าเล่น " + pkg.label, amount: pkg.price }],
          },
          receipt: buildReceipt(bandCode),
        });
        showToast("รับเงินแล้ว · เริ่มเวลา " + name);
        router.refresh();
        return;
      } catch {
        showToast("❌ เช็คอินไม่สำเร็จ · ยังไม่ได้รับเงิน · ลองใหม่");
        return;
      } finally {
        setCreating(false);
      }
    }

    // Optimistic fallback — เฉพาะ preset/demo (ไม่มีสาขาจริง · ไม่มีหลังบ้าน)
    const localCode = randBandCode();
    const printedLocal = printWristband({ code: localCode, memberName: name, nickname: s.ckNickname || null, adultCount: adults });
    if (!printedLocal) showToast("⚠️ เบราว์เซอร์บล็อกการพิมพ์ · กด 'พิมพ์สายรัดซ้ำ' ที่ใบเสร็จ");
    dispatch({
      t: "checkinReceipt",
      kid: {
        id: localKidId(),
        name,
        mascot,
        pkg: pkg.label,
        sec: pkg.mins * 60,
        dayPass: pkg.mins === 0,
        charges: [{ label: "ค่าเล่น " + pkg.label, amount: pkg.price }],
      },
      receipt: buildReceipt(localCode),
    });
    showToast("รับเงินแล้ว · เริ่มเวลา " + name);
  };

  const reprintBand = () => {
    const r = s.receipt;
    if (!r || !r.bandCode) return;
    const ok = printWristband({ code: r.bandCode, memberName: r.name, adultCount: r.adultCount ?? 0 });
    if (!ok) showToast("เบราว์เซอร์บล็อก popup · อนุญาต popup แล้วลองใหม่");
  };

  // พิมพ์สลิป/ใบเสร็จ 58mm จากข้อมูลใบเสร็จที่กำลังโชว์ (ก่อนหน้านี้ปุ่ม "ปรินต์สลิป" เป็นปุ่มตาย กดแล้วเงียบ)
  const printSlip = () => {
    const r = s.receipt;
    if (!r) return;
    const esc = (x: string) => x.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
    const title = r.kind === "checkout" ? "สรุปการเล่น" : "ใบเสร็จ";
    const totalLabel = r.kind === "checkout" ? "ยอดที่จ่ายแล้ว (พรีเพด)" : "รวม";
    const dateStr = new Date().toLocaleString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const rows = (r.lines ?? []).map((l) => `<div class="ln"><span>${esc(l.label)}</span><span>฿${l.amount}</span></div>`).join("");
    const band = r.bandCode ? `<div class="band">รหัสสายรัด<br><b>${esc(r.bandCode)}</b></div>` : "";
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} ${esc(r.no)}</title>
<style>
  @page { size: 58mm auto; margin: 0; }
  @media print { @page { size: 58mm auto; margin: 0; } body { margin: 0; } }
  html,body { margin:0; padding:0; font-family: ui-sans-serif, system-ui, "IBM Plex Sans Thai", sans-serif; color:#000; }
  .slip { width:58mm; padding:4mm 3mm; box-sizing:border-box; }
  .brand { text-align:center; font-weight:700; font-size:13pt; }
  .sub { text-align:center; font-size:8pt; color:#555; margin-bottom:2mm; }
  .who { text-align:center; font-size:10pt; font-weight:600; margin-bottom:2mm; }
  .ln { display:flex; justify-content:space-between; font-size:9.5pt; padding:0.6mm 0; }
  .tot { display:flex; justify-content:space-between; font-size:11pt; font-weight:700; border-top:1px dashed #999; margin-top:2mm; padding-top:2mm; }
  .band { text-align:center; font-size:8.5pt; border-top:1px dashed #999; margin-top:2mm; padding-top:2mm; }
  .ft { text-align:center; font-size:7.5pt; color:#888; margin-top:3mm; }
  @media screen { body { background:#eee; padding:20px; } .slip { background:#fff; margin:0 auto; box-shadow:0 2px 12px rgba(0,0,0,.15); } }
</style></head><body>
<div class="slip">
  <div class="brand">PLAY A LOT</div>
  <div class="sub">${esc(title)} ${esc(r.no)} · ${esc(dateStr)}</div>
  <div class="who">${esc(r.name)}</div>
  ${rows}
  <div class="tot"><span>${esc(totalLabel)}</span><span>฿${r.total}</span></div>
  ${band}
  <div class="ft">ขอบคุณที่มาเล่นกับเรา 💛</div>
</div>
<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},200);window.addEventListener("afterprint",function(){setTimeout(function(){window.close();},300);});});</script>
</body></html>`;
    const w = window.open("", "_blank", "width=420,height=720");
    if (!w) { showToast("เบราว์เซอร์บล็อก popup · อนุญาต popup แล้วลองใหม่"); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  // ----- start check-in for an existing member (from members/search screens) -----
  const startCheckinForMember = (m: { id: string; name: string; nickname: string | null }) => {
    dispatch({
      t: "set",
      p: {
        screen: "checkin",
        ckStep: "package",
        ckName: m.nickname || m.name,
        ckNickname: m.nickname ?? "",
        ckMemberId: isRealId(m.id) ? m.id : null,
      },
    });
  };

  // =========================== MEMBERS screen state ===========================
  // Seed with the recent members the server shell passed (so the list isn't empty on open).
  const seededMembers: MemberSearchHit[] = useMemo(
    () => initialMembers.map((m) => ({ id: m.id, name: m.name, nickname: m.nickname, phone: m.phone, memberCode: m.memberCode, type: m.type, lastVisitAt: m.lastVisit })),
    [initialMembers],
  );
  const [memQuery, setMemQuery] = useState("");
  const [memResults, setMemResults] = useState<MemberSearchHit[]>(seededMembers);
  const [memSearching, setMemSearching] = useState(false);
  const [memTab, setMemTab] = useState<"search" | "register">("search");
  // register form
  const [regName, setRegName] = useState("");
  const [regNick, setRegNick] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regType, setRegType] = useState<"KID" | "PARENT">("KID");
  const [regConsent, setRegConsent] = useState(false);
  const [regBusy, setRegBusy] = useState(false);
  const [regNewCode, setRegNewCode] = useState<string | null>(null);

  const runMemberSearch = async () => {
    const q = memQuery.trim();
    if (q.length < 1) return;
    setMemSearching(true);
    try {
      const res = await searchMembersAction({ branchId: props.branchId, query: q });
      if (res.ok) setMemResults(res.data);
      else showToast(res.error);
    } catch {
      showToast("ค้นหาไม่สำเร็จ");
    }
    setMemSearching(false);
  };

  const submitRegister = async () => {
    if (regBusy) return;
    if (!regName.trim()) { showToast("กรอกชื่อก่อน"); return; }
    if (!regConsent) { showToast("ต้องยินยอม PDPA ก่อนลงทะเบียน"); return; }
    setRegBusy(true);
    setRegNewCode(null);
    try {
      const res = await createMember({
        branchId: props.branchId,
        type: regType,
        name: regName.trim(),
        nickname: regNick.trim() || undefined,
        phone: regPhone.trim() || undefined,
        consentGiven: true,
        newFamilyGroupName: `ครอบครัว ${regName.trim()}`,
      });
      if (res.ok) {
        showToast("ลงทะเบียนสำเร็จ");
        // fetch the new member's code by searching the name
        try {
          const sr = await searchMembersAction({ branchId: props.branchId, query: regName.trim() });
          if (sr.ok) {
            const hit = sr.data.find((m) => m.id === res.data.memberId);
            setRegNewCode(hit?.memberCode ?? "บันทึกแล้ว");
          }
        } catch { setRegNewCode("บันทึกแล้ว"); }
        setRegName(""); setRegNick(""); setRegPhone(""); setRegConsent(false);
        router.refresh();
      } else {
        showToast(res.error);
      }
    } catch {
      showToast("ลงทะเบียนไม่สำเร็จ");
    }
    setRegBusy(false);
  };

  // =========================== WRISTBAND screen state ===========================
  const [wbCode, setWbCode] = useState("");
  const [wbBusy, setWbBusy] = useState(false);
  const [wbLookup, setWbLookup] = useState<WristbandLookup | null>(null);
  const [wbActPay, setWbActPay] = useState<PayMethod>("CASH");
  const [wbActPkg, setWbActPkg] = useState<string | null>(null);

  const runWbLookup = async () => {
    const code = wbCode.trim();
    if (!code) return;
    setWbBusy(true);
    setWbLookup(null);
    try {
      const res = await lookupWristband(code);
      if (res.ok) { setWbLookup(res.data); setWbActPkg(packages.find((p) => isRealId(p.id))?.id ?? null); }
      else showToast(res.error);
    } catch {
      showToast("สแกนไม่สำเร็จ");
    }
    setWbBusy(false);
  };

  const wbActivate = async () => {
    if (!wbLookup || !wbActPkg) { showToast("เลือกแพ็กเกจก่อน"); return; }
    setWbBusy(true);
    try {
      const res = await activateWristband({
        code: wbLookup.wristband.code,
        packageId: wbActPkg,
        paymentMethod: wbActPay === "CARD" ? "STRIPE" : wbActPay,
      });
      if (res.ok) { showToast("เปิด gate · เริ่มเวลาเล่นแล้ว"); setWbLookup(null); setWbCode(""); router.refresh(); }
      else showToast(res.error);
    } catch { showToast("activate ไม่สำเร็จ"); }
    setWbBusy(false);
  };

  const wbExit = async () => {
    if (!wbLookup) return;
    setWbBusy(true);
    try {
      const res = await exitWristband(wbLookup.wristband.code);
      if (res.ok) { showToast("ออกแล้ว · คืนสายรัด"); setWbLookup(null); setWbCode(""); router.refresh(); }
      else showToast(res.error);
    } catch { showToast("ออกไม่สำเร็จ"); }
    setWbBusy(false);
  };

  const wbPosCharge = () => {
    // route POS charge to the kid's open session via the board flow
    if (wbLookup?.session) {
      dispatch({ t: "set", p: { chargeKidId: wbLookup.session.id, screen: "pos" } });
    } else {
      goPos();
    }
  };

  // issue a brand-new wristband from this screen (member must be looked up/selected)
  const [wbIssueMemberId, setWbIssueMemberId] = useState("");
  const wbIssue = async () => {
    const memberId = wbIssueMemberId.trim() || (memResults[0]?.id ?? "");
    if (!isRealId(memberId)) { showToast("เลือกสมาชิกจริงก่อน (ค้นหาในหน้าสมาชิก)"); return; }
    setWbBusy(true);
    try {
      const res = await issueWristband({ branchId: props.branchId, memberId });
      if (res.ok) {
        const m = memResults.find((x) => x.id === memberId);
        printWristband({ code: res.data.code, memberName: m?.name ?? "สมาชิก", nickname: m?.nickname ?? null });
        showToast("ออกสายรัด " + res.data.code + " · พิมพ์แล้ว");
        router.refresh();
      } else showToast(res.error);
    } catch { showToast("ออกสายรัดไม่สำเร็จ"); }
    setWbBusy(false);
  };

  // =========================== BOOKINGS screen state ===========================
  const [bkForm, setBkForm] = useState(false);
  const [bkName, setBkName] = useState("");
  const [bkPhone, setBkPhone] = useState("");
  const [bkPkg, setBkPkg] = useState<string | null>(null);
  const [bkDate, setBkDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [bkHour, setBkHour] = useState(14);
  const [bkParty, setBkParty] = useState(2);
  const [bkBusy, setBkBusy] = useState(false);
  const bookings = props.bookings ?? [];

  const submitBooking = async () => {
    if (bkBusy) return;
    const pkgId = bkPkg ?? packages.find((p) => isRealId(p.id))?.id ?? null;
    if (!bkName.trim()) { showToast("กรอกชื่อลูกค้า"); return; }
    if (!pkgId || !isRealId(pkgId)) { showToast("เลือกแพ็กเกจ (ต้องมีแพ็กเกจจริงในระบบ)"); return; }
    setBkBusy(true);
    try {
      const res = await createBooking({
        branchId: props.branchId,
        packageId: pkgId,
        customerName: bkName.trim(),
        customerPhone: bkPhone.trim(),
        partySize: bkParty,
        slotDate: bkDate,
        slotHour: bkHour,
        paymentMethod: "CASH",
      });
      if (res.ok) {
        showToast("จองสำเร็จ " + res.data.bookingCode);
        setBkForm(false); setBkName(""); setBkPhone(""); setBkParty(2);
        router.refresh();
      } else showToast(res.error);
    } catch { showToast("จองไม่สำเร็จ"); }
    setBkBusy(false);
  };

  const checkinBack = () => {
    if (s.ckStep === "choose") go("home");
    else if (s.ckStep === "pay") dispatch({ t: "set", p: { ckStep: "package" } });
    else dispatch({ t: "set", p: { ckStep: "choose" } });
  };

  // ----- derived render values -----
  const near = s.kids.filter((k) => !k.dayPass && k.sec <= 600).length;
  const revenueStr = "฿" + s.revenue.toLocaleString();

  // ----- ปิดกะ: ควรมีในลิ้นชัก = เงินต้นกะ + "เงินสดที่รับจริง" เท่านั้น (โอน/บัตร ไม่เข้าลิ้นชัก) -----
  const shift = props.shift ?? null;
  const baht = (cents: number) => "฿" + Math.round(cents / 100).toLocaleString();
  const shExpectedCents = shift ? shift.openingCashCents + shift.cashSalesCents : 0;
  const shCountedCents = Math.round((parseFloat(shiftClosing || "0") || 0) * 100);
  const shVarCents = shCountedCents - shExpectedCents;
  const doOpenShift = async () => {
    if (shiftBusy) return;
    setShiftBusy(true);
    try {
      const res = await openShift(props.branchId, Math.round((parseFloat(shiftOpening || "0") || 0) * 100));
      if (res?.ok) { showToast("เปิดกะแล้ว"); router.refresh(); }
      else showToast(res?.error || "เปิดกะไม่สำเร็จ");
    } catch { showToast("เปิดกะไม่สำเร็จ"); }
    finally { setShiftBusy(false); }
  };
  const doCloseShift = async () => {
    if (shiftBusy || !shift) return;
    if (!shiftClosing.trim()) { showToast("กรอกยอดเงินที่นับได้ก่อน"); return; }
    setShiftBusy(true);
    try {
      const res = await closeShift({ shiftId: shift.id, closingCashCents: shCountedCents, isDayClose: shiftDayClose });
      if (res?.ok) {
        const v = res.data.varianceCents;
        const msg = v === 0 ? "ตรงพอดี" : v > 0 ? `เกิน ${baht(v)}` : `ขาด ${baht(Math.abs(v))}`;
        showToast(`${shiftDayClose ? "ปิดวัน" : "ปิดกะ"}แล้ว · ${msg}`);
        go("home"); router.refresh();
      } else showToast(res?.error || "ปิดกะไม่สำเร็จ");
    } catch { showToast("ปิดกะไม่สำเร็จ"); }
    finally { setShiftBusy(false); }
  };
  const co = s.kids.find((k) => k.id === s.coKidId);
  const ext = s.kids.find((k) => k.id === s.extKidId);
  // ค่าปรับเกินเวลาของคนที่กำลังเช็คเอาท์ (โชว์ให้แคชเชียร์เห็นก่อนกดเก็บเงิน)
  const otRate = props.overtimeRatePerMinuteCents ?? DEFAULT_OVERTIME_RATE_PER_MIN_CENTS;
  const coOt = co && !co.dayPass ? overtimeFromSec(co.sec, otRate) : { minutes: 0, cents: 0 };
  const coOtBaht = Math.round(coOt.cents / 100);
  const chargeKid = s.kids.find((k) => k.id === s.chargeKidId);
  const posTotal = cartLines.reduce((a, l) => a + l.price * l.qty, 0);
  const rc = s.receipt;

  // check-in "เคยมาแล้ว" search results — live member search (fallback to seeded list)
  const ckSearchResults: MemberSearchHit[] = memResults;

  // กระดาน: กรองตามชื่อ + เรียง "ใกล้หมด/เกินเวลาก่อน" (เวลาน้อยขึ้นก่อน · day pass ท้ายสุด)
  const boardKids = (() => {
    const q = boardQuery.trim().toLowerCase();
    const list = q ? s.kids.filter((k) => k.name.toLowerCase().includes(q)) : s.kids;
    return [...list].sort((a, b) => (a.dayPass ? 1e9 : a.sec) - (b.dayPass ? 1e9 : b.sec));
  })();

  // ต่อเวลา = ใช้ "แพ็กเกจจริง" ในระบบ (ราคาที่โชว์ = ที่เก็บเงินจริง · กันโชว์ ฿30 แต่หักคนละราคา)
  const extSource = packages.filter((p) => p.mins > 0);
  const extOptions = (extSource.length > 0 ? extSource : PRESET_PACKAGES.filter((p) => p.mins > 0)).map((p) => ({
    id: p.id, label: "+" + p.mins, price: "฿" + p.price, mins: p.mins, p: p.price,
  }));

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------
  return (
    <div
      style={{
        // FULL-SCREEN kiosk: covers the admin sidebar + the blue approval bar.
        position: "fixed",
        inset: 0,
        zIndex: 40,
        fontFamily: MITR,
        color: "#3A3026",
        background: "#F7F2EA",
        overflowY: "auto",
      }}
    >
      {/* keyframes for pulse (matches prototype <style>) */}
      <style>{`@keyframes pulseRed{0%,100%{box-shadow:0 0 0 0 rgba(231,76,60,.0)}50%{box-shadow:0 0 0 5px rgba(231,76,60,.25)}}`}</style>

      {/* max-width centered column — looks good on big screens, fills small/tablet */}
      <div
        id="plFrame"
        style={{
          width: "100%",
          maxWidth: 1180,
          minHeight: "100dvh",
          margin: "0 auto",
          background: "#fff",
          overflow: "hidden",
          position: "relative",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* ===== HOME ===== */}
        {s.screen === "home" && (
          <div style={{ flex: 1, minHeight: 0, background: "#F7F2EA", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ height: 74, flex: "none", background: "#fff", borderBottom: "1px solid #ece5d8", display: "flex", alignItems: "center", padding: "0 28px", gap: 18 }}>
              <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 24, color: "#2D6CB1" }}>
                Play <span style={{ color: "#F0B323" }}>a</span> lot
              </div>
              <div style={{ width: 1, height: 28, background: "#ece5d8" }} />
              {props.hasOpenShift !== false ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#eaf3eb", color: "#1F8A5B", padding: "8px 14px", borderRadius: 999, fontSize: 14 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#1F8A5B", display: "inline-block" }} />
                  กะเปิดอยู่
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#fdf3df", color: "#a9791a", padding: "8px 14px", borderRadius: 999, fontSize: 14 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#F0B323", display: "inline-block" }} />
                  ยังไม่เปิดกะ
                </div>
              )}
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
                <div onClick={() => go("shift")} style={{ cursor: "pointer", fontSize: 14, color: "#6b6052", padding: "8px 14px", borderRadius: 10, background: "#f4ede0" }}>ปิดกะ</div>
                <div onClick={() => router.push("/playland/office")} title="กลับหลังบ้าน (ภาพรวมร้าน)" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: "#8a7f70", padding: "8px 14px", borderRadius: 10, background: "#f7f2ea", border: "1px solid #ece5d8" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8a7f70" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></svg>
                  กลับหลังบ้าน
                </div>
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
              {/* ── หน้าร้าน ── */}
              <div style={{ fontSize: 13, fontWeight: 600, color: "#a9978a", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 12 }}>หน้าร้าน</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {/* รับเด็กเข้าเล่น */}
                <div onClick={startCheckin} style={{ cursor: "pointer", background: "#2D6CB1", borderRadius: 20, padding: "24px 28px", color: "#fff", display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative", overflow: "hidden", minHeight: 150 }}>
                  <div style={{ width: 54, height: 54, borderRadius: 15, background: "rgba(255,255,255,.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" /></svg>
                  </div>
                  <div>
                    <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 25 }}>รับเด็กเข้าเล่น</div>
                    <div style={{ fontSize: 15, opacity: 0.85 }}>ลงทะเบียน · จ่าย · พิมพ์สายรัด</div>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mascotSrc("skye")} alt="" style={{ position: "absolute", right: -10, bottom: -14, width: 120, opacity: 0.9 }} />
                </div>
                {/* เด็กที่กำลังเล่น */}
                <div onClick={() => go("board")} style={{ cursor: "pointer", background: "#E74C3C", borderRadius: 20, padding: "24px 28px", color: "#fff", display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative", overflow: "hidden", minHeight: 150 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ width: 54, height: 54, borderRadius: 15, background: "rgba(255,255,255,.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                    </div>
                    {near > 0 && <div style={{ background: "rgba(255,255,255,.22)", fontWeight: 500, fontSize: 14, padding: "6px 12px", borderRadius: 999 }}>{near} ใกล้หมดเวลา</div>}
                  </div>
                  <div>
                    <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 25 }}>เด็กที่กำลังเล่น <span style={{ fontFamily: FREDOKA, fontWeight: 700 }}>{s.kids.length}</span></div>
                    <div style={{ fontSize: 15, opacity: 0.85 }}>ต่อเวลา · เพิ่มขนม · เช็คเอาท์</div>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mascotSrc("rocky")} alt="" style={{ position: "absolute", right: -14, bottom: -16, width: 128, opacity: 0.9 }} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginTop: 16 }}>
                {/* ขายขนม */}
                <div onClick={goPos} style={{ cursor: "pointer", background: "#F0B323", borderRadius: 18, padding: "22px 24px", color: "#fff", display: "flex", flexDirection: "column", gap: 14, position: "relative", overflow: "hidden", minHeight: 120 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 13, background: "rgba(255,255,255,.22)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M5 7h14l-1.2 11.5a2 2 0 0 1-2 1.5H8.2a2 2 0 0 1-2-1.5L5 7Z" /><path d="M9 7V5a3 3 0 0 1 6 0v2" /></svg>
                  </div>
                  <div>
                    <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 20, color: "#fff" }}>ขายขนม</div>
                    <div style={{ fontSize: 14, opacity: 0.9, color: "#fff" }}>POS · คิดเงิน</div>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mascotSrc("sunny")} alt="" style={{ position: "absolute", right: -6, bottom: -12, width: 86, opacity: 0.9 }} />
                </div>
                {/* สายรัด · สแกน */}
                {hubCard({ onClick: () => go("wristband"), bg: "#1F8A5B", title: "สายรัด · สแกน", sub: "ออก/สแกน band", icon: (
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM21 14v7M17 21h4" /></svg>
                ) })}
                {/* จองล่วงหน้า */}
                {hubCard({ onClick: () => go("bookings"), bg: "#2D6CB1", title: "จองล่วงหน้า", sub: (props.stats?.bookingsToday ?? bookings.length) + " วันนี้", icon: (
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
                ) })}
              </div>

              {/* ── จัดการ ── */}
              <div style={{ fontSize: 13, fontWeight: 600, color: "#a9978a", letterSpacing: "0.06em", textTransform: "uppercase", margin: "22px 0 12px" }}>จัดการ</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16 }}>
                {hubCard({ onClick: () => go("monitor"), bg: "#1c2740", title: "จอ Monitor", sub: "โชว์เวลาทั้งร้าน", icon: (
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
                ) })}
                {hubCard({ onClick: () => go("members"), bg: "#7a5cc4", title: "สมาชิก", sub: (props.stats?.memberCount ?? 0) + " คน", icon: (
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                ) })}
                {hubCard({ onClick: () => go("dashboard"), bg: "#0f9b8e", title: "Dashboard", sub: "รายได้ · สถิติ", icon: (
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></svg>
                ) })}
                {hubCard({ onClick: () => router.push("/playland/settings"), bg: "#6b6052", title: "ตั้งค่า", sub: "แพ็กเกจ · สต๊อก · พนักงาน", icon: (
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                ) })}
                {hubCard({ onClick: () => router.push("/playland/repairs"), bg: "#a9791a", title: "ซ่อม · อะไหล่", sub: "บันทึกซ่อม · เบิกของ", icon: (
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.3 2.3-2-2 2.3-2.3Z" /></svg>
                ) })}
              </div>
            </div>
          </div>
        )}

        {/* ===== BOARD ===== */}
        {s.screen === "board" && (
          <div style={{ flex: 1, minHeight: 0, background: "#F7F2EA", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ height: 74, flex: "none", background: "#fff", borderBottom: "1px solid #ece5d8", display: "flex", alignItems: "center", padding: "0 28px", gap: 16 }}>
              <div onClick={() => go("home")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: "#6b6052", fontSize: 16 }}>{backIcon("#6b6052")}หน้าหลัก</div>
              <div style={{ width: 1, height: 28, background: "#ece5d8" }} />
              <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 20 }}>เด็กที่กำลังเล่น</div>
              <input value={boardQuery} onChange={(e) => setBoardQuery(e.target.value)} placeholder="🔍 ค้นชื่อเด็ก…" style={{ marginLeft: 18, flex: "0 1 200px", minWidth: 0, border: "1px solid #ece5d8", borderRadius: 999, padding: "8px 16px", fontSize: 14, fontFamily: MITR, color: "#3A3026", outline: "none", background: "#F7F2EA" }} />
              <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
                <div style={{ background: "#fff", border: "1px solid #f4d9d6", borderRadius: 12, padding: "8px 16px", fontSize: 14 }}>ใกล้หมด <strong style={{ fontFamily: FREDOKA, color: "#E74C3C" }}>{near}</strong></div>
                <div onClick={() => go("wristband")} style={{ cursor: "pointer", background: "#1F8A5B", color: "#fff", borderRadius: 12, padding: "8px 16px", fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>🔳 สแกนสายรัด</div>
                <div onClick={startCheckin} style={{ cursor: "pointer", background: "#F0B323", color: "#fff", borderRadius: 12, padding: "8px 18px", fontSize: 15, display: "flex", alignItems: "center", gap: 7 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>รับเด็กเข้า
                </div>
              </div>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: "22px 28px" }}>
              <div className="pl-grid-3" style={{ gap: 18 }}>
                {boardKids.map((k) => {
                  const over = !k.dayPass && k.sec < 0; // เกินเวลาแล้ว — เวลาเดินต่อ เก็บค่าปรับตอนเช็คเอาท์
                  const nearEnd = !k.dayPass && k.sec >= 0 && k.sec <= 600;
                  const color = k.dayPass ? "#1F8A5B" : over ? "#E74C3C" : colorFor(k.sec);
                  return (
                    <div key={k.id} style={{ background: "#fff", borderRadius: 18, padding: 18, border: `2px solid ${over || nearEnd ? "#E74C3C" : "#eef0ec"}`, position: "relative" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                        <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#f4ede0", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={mascotSrc(k.mascot)} alt="" style={{ width: 40 }} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 500, fontSize: 18 }}>{k.name}</div>
                          <div style={{ fontSize: 13, color: "#8a7f70" }}>{k.pkg}</div>
                        </div>
                        {over ? <div style={{ background: "#E74C3C", color: "#fff", fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 999 }}>เกินเวลา</div>
                          : nearEnd ? <div style={{ background: "#fdeceb", color: "#E74C3C", fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999 }}>ใกล้หมด</div> : null}
                      </div>
                      <div style={{ textAlign: "center", margin: "6px 0 14px" }}>
                        <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 38, lineHeight: 1, color }}>{k.dayPass ? "ทั้งวัน" : over ? "+" + fmt(-k.sec) : fmt(Math.max(0, k.sec))}</div>
                        <div style={{ fontSize: 13, color: over ? "#E74C3C" : "#8a7f70", marginTop: 2, fontWeight: over ? 600 : 400 }}>{k.dayPass ? "Day Pass" : over ? "เกินเวลา · เก็บค่าปรับ" : "เหลือ"}</div>
                      </div>
                      {/* +เวลา/+ขนม อยู่แถวบน · เช็คเอาท์ (จบรอบ ย้อนยาก) แยกแถวล่าง + ปุ่มใหญ่ กันกดพลาด */}
                      <div style={{ display: "flex", gap: 8 }}>
                        <div onClick={() => openExtend(k.id)} style={{ cursor: "pointer", flex: 1, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center", background: "#eaf3f6", color: "#2D6CB1", textAlign: "center", padding: 10, borderRadius: 10, fontSize: 15 }}>+ เวลา</div>
                        <div onClick={() => addSnackFor(k.id)} style={{ cursor: "pointer", flex: 1, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center", background: "#fdf3df", color: "#a9791a", textAlign: "center", padding: 10, borderRadius: 10, fontSize: 15 }}>+ ขนม</div>
                      </div>
                      <div onClick={() => checkoutKid(k.id)} style={{ cursor: "pointer", marginTop: 10, minHeight: 48, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, background: "#fff", color: "#E74C3C", border: "2px solid #E74C3C", textAlign: "center", padding: "12px 10px", borderRadius: 12, fontSize: 16, fontWeight: 600 }}>
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#E74C3C" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></svg>
                        เช็คเอาท์ · จบรอบ
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
                <div style={{ width: 540, maxWidth: "calc(100vw - 32px)", background: "#fff", borderRadius: 22, boxShadow: "0 20px 60px rgba(0,0,0,.3)", overflow: "hidden" }}>
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
                    <div style={{ fontSize: 14, color: "#8a7f70", marginBottom: 8 }}>รับเงินด้วย</div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                      {payButtons(extPay, setExtPay)}
                    </div>
                    <div style={{ fontSize: 15, color: "#8a7f70", marginBottom: 14 }}>แตะเพื่อต่อเวลา · รับเงินทันที</div>
                    <div className="pl-grid-3" style={{ gap: 12 }}>
                      {extOptions.map((o) => (
                        <div key={o.id} onClick={() => applyExtend(o)} style={{ cursor: "pointer", background: "#fff", border: "1.5px solid #ece5d8", borderRadius: 14, padding: "18px 0", textAlign: "center" }}>
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
          <div style={{ flex: 1, minHeight: 0, background: "#F7F2EA", display: "flex", flexDirection: "column", overflowY: "auto" }}>
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
                <div style={{ background: coOt.minutes > 0 ? "#fdeceb" : "#eaf3eb", color: coOt.minutes > 0 ? "#E74C3C" : "#1F8A5B", fontWeight: 600, fontSize: 15, padding: "8px 16px", borderRadius: 999 }}>{co ? (co.dayPass ? "ทั้งวัน" : coOt.minutes > 0 ? `เกินเวลา +${coOt.minutes} นาที` : "เหลือ " + fmt(Math.max(0, co.sec))) : ""}</div>
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
                <div style={{ fontSize: 18, color: "#6b6052" }}>จ่ายแล้ววันนี้ (พรีเพด)</div>
                <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 36, color: "#1F8A5B" }}>฿{co ? co.charges.reduce((a, c) => a + c.amount, 0) : 0}</div>
              </div>
              <div style={{ marginTop: "auto" }}>
                {coOt.minutes > 0 ? (
                  <>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fdf3df", border: "1px solid #f0d9a0", borderRadius: 12, padding: "14px 18px", marginBottom: 14 }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 16, color: "#a9791a" }}>ค่าปรับเกินเวลา {coOt.minutes} นาที</div>
                        <div style={{ fontSize: 13, color: "#8a7f70", marginTop: 2 }}>{baht(otRate)}/นาที · เก็บเพิ่มตอนเช็คเอาท์</div>
                      </div>
                      <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 28, color: "#E74C3C" }}>฿{coOtBaht}</div>
                    </div>
                    <div style={{ fontSize: 13, color: "#8a7f70", marginBottom: 8 }}>รับค่าปรับด้วย</div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>{payButtons(coPay, setCoPay)}</div>
                    <div onClick={doCheckout} style={{ cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, background: "#E74C3C", color: "#fff", borderRadius: 14, padding: 18, textAlign: "center", fontFamily: MITR, fontWeight: 500, fontSize: 22 }}>
                      {busy ? "กำลังเช็คเอาท์..." : `เก็บค่าปรับ ฿${coOtBaht} · เช็คเอาท์`}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ background: "#eaf3eb", color: "#1F8A5B", borderRadius: 12, padding: "12px 16px", fontSize: 15, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1F8A5B" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
                      จ่ายครบแล้วตอนเข้าเล่น · เช็คเอาท์ไม่เก็บเงินเพิ่ม
                    </div>
                    <div onClick={doCheckout} style={{ cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, background: "#E74C3C", color: "#fff", borderRadius: 14, padding: 18, textAlign: "center", fontFamily: MITR, fontWeight: 500, fontSize: 22, display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
                      {busy ? "กำลังเช็คเอาท์..." : "เช็คเอาท์ · คืนสายรัด · จบรอบ"}
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ===== POS ===== */}
        {s.screen === "pos" && (
          <div style={{ flex: 1, minHeight: 0, background: "#F7F2EA", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ height: 74, flex: "none", background: "#fff", borderBottom: "1px solid #ece5d8", display: "flex", alignItems: "center", padding: "0 28px", gap: 16 }}>
              <div onClick={() => go("home")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: "#6b6052", fontSize: 16 }}>{backIcon("#6b6052")}หน้าหลัก</div>
              <div style={{ width: 1, height: 28, background: "#ece5d8" }} />
              <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 20 }}>ขายขนม · เครื่องดื่ม</div>
            </div>
            <div className="pl-pos-row">
              <div style={{ flex: 1, padding: "24px 26px", overflow: "auto" }}>
                {/* ยิงบาร์โค้ด (Harborland-style) — เครื่องยิง USB พิมพ์โค้ด+Enter · หรือกล้อง */}
                <div style={{ marginBottom: 16 }}><BarcodeScanBox onScan={scanBarcode} placeholder="ยิงบาร์โค้ดขนม/น้ำ แล้วกด Enter…" /></div>
                <div className="pl-grid-4" style={{ gap: 14 }}>
                  {products.map((p) => {
                    const img = productImageSrc(p);
                    return (
                      <div key={p.id} onClick={() => addToCart(p.id)} style={{ cursor: "pointer", background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={img}
                            alt={p.name}
                            style={{ height: 80, width: "100%", objectFit: "cover", borderRadius: 12, background: "#f4ede0" }}
                            onError={(e) => {
                              // fall back to the emoji tile so we never show a broken image
                              const el = e.currentTarget;
                              const fb = el.nextElementSibling as HTMLElement | null;
                              el.style.display = "none";
                              if (fb) fb.style.display = "flex";
                            }}
                          />
                        ) : null}
                        <div style={{ height: 80, borderRadius: 12, background: "#f4ede0", display: img ? "none" : "flex", alignItems: "center", justifyContent: "center", fontSize: 38 }}>{p.emoji}</div>
                        <div>
                          <div style={{ fontWeight: 500, fontSize: 16 }}>{p.name}</div>
                          <div style={{ fontFamily: FREDOKA, fontWeight: 600, color: "#1F8A5B", fontSize: 16 }}>฿{p.price}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="pl-pos-cart" style={{ background: "#fff", borderLeft: "1px solid #ece5d8", display: "flex", flexDirection: "column", padding: "22px 24px" }}>
                <div style={{ fontSize: 14, color: "#8a7f70", marginBottom: 10 }}>{chargeKid ? "ขายให้" : "ลูกค้า"}</div>
                <div style={{ background: "#eaf3f6", border: "1.5px solid #2D6CB1", borderRadius: 12, padding: "11px 14px", fontSize: 15, marginBottom: 14 }}>{chargeKid ? chargeKid.name + " · คิดเงินทันที" : "ลูกค้าทั่วไป · จ่ายทันที"}</div>
                <div style={{ fontSize: 13, color: "#8a7f70", marginBottom: 8 }}>รับเงินด้วย</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>{payButtons(posPay, setPosPay)}</div>
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
                  <div onClick={payPos} style={{ cursor: "pointer", background: "#1F8A5B", color: "#fff", borderRadius: 14, padding: 16, textAlign: "center", fontFamily: MITR, fontWeight: 500, fontSize: 19 }}>รับเงิน ฿{posTotal}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===== CHECK-IN ===== */}
        {s.screen === "checkin" && (
          <div style={{ flex: 1, minHeight: 0, background: "#F7F2EA", display: "flex", flexDirection: "column", overflowY: "auto" }}>
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
              {/* search (live member search) */}
              {s.ckStep === "search" && (
                <div style={{ maxWidth: 760, margin: "0 auto" }}>
                  <div style={{ background: "#fff", borderRadius: 12, display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", marginBottom: 18, border: "1.5px solid #2D6CB1" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a9978a" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>
                    <input
                      value={memQuery}
                      onChange={(e) => setMemQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") runMemberSearch(); }}
                      placeholder="ชื่อ · เบอร์โทร · รหัสสมาชิก"
                      autoFocus
                      style={{ flex: 1, border: "none", outline: "none", color: "#3A3026", fontSize: 17, fontFamily: MITR, background: "transparent" }}
                    />
                    <span onClick={runMemberSearch} style={{ cursor: "pointer", background: "#2D6CB1", color: "#fff", fontSize: 14, padding: "8px 16px", borderRadius: 9 }}>{memSearching ? "..." : "ค้นหา"}</span>
                  </div>
                  <div style={{ fontSize: 14, color: "#8a7f70", marginBottom: 12 }}>ผลการค้นหา</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {ckSearchResults.length === 0 && <div style={{ textAlign: "center", color: "#bcae9b", fontSize: 15, padding: "26px 0" }}>{memSearching ? "กำลังค้นหา..." : "พิมพ์ชื่อหรือเบอร์ แล้วกดค้นหา"}</div>}
                    {ckSearchResults.map((m, i) => (
                      <div key={m.id} onClick={() => dispatch({ t: "set", p: { ckName: m.nickname || m.name, ckNickname: m.nickname ?? "", ckMemberId: isRealId(m.id) ? m.id : null, ckStep: "package" } })} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", border: "1px solid #ece5d8", borderRadius: 14, background: "#fff" }}>
                        <div style={{ width: 48, height: 48, borderRadius: "50%", background: i === 0 ? "#fdf3df" : "#eaf3f6", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={mascotSrc(MASCOTS[i % 3])} alt="" style={{ width: 40 }} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 500, fontSize: 18 }}>{m.nickname || m.name}</div>
                          <div style={{ fontSize: 14, color: "#8a7f70" }}>{m.name}{m.phone ? " · " + m.phone : ""}{m.memberCode ? " · " + m.memberCode : ""}</div>
                        </div>
                        <div style={{ background: m.type === "KID" ? "#eaf3f6" : "#fdf3df", color: m.type === "KID" ? "#2D6CB1" : "#a9791a", fontSize: 13, fontWeight: 600, padding: "5px 12px", borderRadius: 999 }}>{m.type === "KID" ? "เด็ก" : "ผู้ใหญ่"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* register (real fields; member is created on confirm in pay step) */}
              {s.ckStep === "register" && (
                <div style={{ maxWidth: 820, margin: "0 auto" }}>
                  <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 22, marginBottom: 16 }}>ลงทะเบียนเด็กใหม่</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 14, color: "#8a7f70", marginBottom: 7 }}>ชื่อ-นามสกุลเด็ก *</div>
                      <input value={s.ckName} onChange={(e) => dispatch({ t: "set", p: { ckName: e.target.value } })} placeholder="เช่น เด็กหญิงมีนา ใจดี" style={inputStyle} />
                    </div>
                    <div>
                      <div style={{ fontSize: 14, color: "#8a7f70", marginBottom: 7 }}>ชื่อเล่น</div>
                      <input value={s.ckNickname} onChange={(e) => dispatch({ t: "set", p: { ckNickname: e.target.value } })} placeholder="เช่น น้องมีน" style={inputStyle} />
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 18 }}>
                    <div>
                      <div style={{ fontSize: 14, color: "#8a7f70", marginBottom: 7 }}>เบอร์โทรผู้ปกครอง</div>
                      <input value={regPhone} onChange={(e) => setRegPhone(e.target.value)} placeholder="0812345678" inputMode="tel" style={inputStyle} />
                    </div>
                    <div />
                  </div>
                  <div onClick={() => setRegConsent(!regConsent)} style={{ cursor: "pointer", background: "#f9f4ea", borderRadius: 14, padding: 18, display: "flex", gap: 11, alignItems: "flex-start", marginBottom: 20 }}>
                    <span style={{ width: 26, height: 26, borderRadius: 7, background: regConsent ? "#1F8A5B" : "#fff", border: regConsent ? "none" : "1.5px solid #d9cdb8", flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {regConsent && <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>}
                    </span>
                    <span style={{ fontSize: 14, color: "#6b6052", lineHeight: 1.5 }}>ยินยอมให้เก็บข้อมูลเด็กและผู้ปกครองตาม PDPA เพื่อความปลอดภัย (จำเป็น)</span>
                  </div>
                  <div
                    onClick={() => {
                      if (!s.ckName.trim()) { showToast("กรอกชื่อเด็กก่อน"); return; }
                      if (!regConsent) { showToast("ต้องยินยอม PDPA ก่อน"); return; }
                      // new registration → memberId stays null; createMember runs at confirm
                      dispatch({ t: "set", p: { ckMemberId: null, ckStep: "package" } });
                    }}
                    style={{ cursor: "pointer", background: "#2D6CB1", color: "#fff", borderRadius: 14, padding: 16, textAlign: "center", fontFamily: MITR, fontWeight: 500, fontSize: 19 }}
                  >
                    ต่อไป · เลือกแพ็กเกจ
                  </div>
                </div>
              )}
              {/* package */}
              {s.ckStep === "package" && (
                <div style={{ maxWidth: 840, margin: "0 auto" }}>
                  <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 24, marginBottom: 4 }}>เลือกแพ็กเกจให้ {s.ckName || "น้องใหม่"}</div>
                  <div style={{ fontSize: 15, color: "#8a7f70", marginBottom: 24 }}>แตะเลือกเวลาเล่น</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 16 }}>
                    {packages.map((pk) => (
                      <div key={pk.id} onClick={() => pickPackage(pk)} style={{ cursor: "pointer", background: "#fff", border: "1.5px solid #ece5d8", borderRadius: 18, padding: "24px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
              {/* PAY — collect payment BEFORE starting the timer */}
              {s.ckStep === "pay" && s.ckPkg && (
                <div style={{ maxWidth: 720, margin: "0 auto" }}>
                  <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 24, marginBottom: 4 }}>รับเงิน · {s.ckName || "น้องใหม่"}</div>
                  <div style={{ fontSize: 15, color: "#8a7f70", marginBottom: 22 }}>{s.ckPkg.label} · {s.ckPkg.sub}</div>

                  <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 18, padding: "26px 28px", marginBottom: 18, textAlign: "center" }}>
                    <div style={{ fontSize: 15, color: "#8a7f70" }}>ยอดที่ต้องเก็บ</div>
                    <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 56, color: "#1F8A5B", lineHeight: 1.1 }}>฿{s.ckPkg.price}</div>
                  </div>

                  <div style={{ fontSize: 14, color: "#8a7f70", marginBottom: 8 }}>รับเงินด้วย</div>
                  <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                    {payButtons(s.ckPay, (m) => dispatch({ t: "set", p: { ckPay: m } }))}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fff", border: "1px solid #ece5d8", borderRadius: 14, padding: "16px 20px", marginBottom: 24 }}>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 17 }}>ผู้ใหญ่ที่มาด้วย</div>
                      <div style={{ fontSize: 13, color: "#8a7f70" }}>พิมพ์สายรัด “ผู้ปกครอง” ให้ด้วย</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <span onClick={() => dispatch({ t: "set", p: { ckAdults: Math.max(0, s.ckAdults - 1) } })} style={{ cursor: "pointer", width: 40, height: 40, borderRadius: 10, background: "#f4ede0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, color: "#6b6052" }}>−</span>
                      <span style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 26, minWidth: 28, textAlign: "center" }}>{s.ckAdults}</span>
                      <span onClick={() => dispatch({ t: "set", p: { ckAdults: Math.min(4, s.ckAdults + 1) } })} style={{ cursor: "pointer", width: 40, height: 40, borderRadius: 10, background: "#2D6CB1", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, color: "#fff" }}>+</span>
                    </div>
                  </div>

                  <div onClick={confirmCheckin} style={{ cursor: creating ? "default" : "pointer", opacity: creating ? 0.6 : 1, background: "#1F8A5B", color: "#fff", borderRadius: 14, padding: 18, textAlign: "center", fontFamily: MITR, fontWeight: 500, fontSize: 21, display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
                    {creating ? "กำลังบันทึก..." : `รับเงิน ฿${s.ckPkg.price} · พิมพ์สายรัด · เริ่มเล่น`}
                    {!creating && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>}
                  </div>
                  <div style={{ fontSize: 13, color: "#a9978a", textAlign: "center", marginTop: 12 }}>เริ่มจับเวลาหลังกดยืนยันเท่านั้น · สายรัด 1 (เด็ก) + {s.ckAdults} (ผู้ปกครอง)</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== RECEIPT ===== */}
        {s.screen === "receipt" && (
          <div style={{ flex: 1, minHeight: 0, background: "#F7F2EA", display: "flex", alignItems: "center", justifyContent: "center", overflowY: "auto", position: "relative" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mascotSrc("sunny")} alt="" style={{ position: "absolute", left: 90, bottom: 60, width: 140, opacity: 0.9 }} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mascotSrc("skye")} alt="" style={{ position: "absolute", right: 90, top: 70, width: 130, opacity: 0.85 }} />
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 500, maxWidth: "100%", padding: "0 16px", boxSizing: "border-box" }}>
              <div style={{ width: 86, height: 86, borderRadius: "50%", background: "#1F8A5B", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
              </div>
              <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 30, marginBottom: 4 }}>
                {rc?.kind === "checkout" ? "เช็คเอาท์เรียบร้อย" : rc?.kind === "checkin" ? "รับเงินแล้ว · เริ่มเล่น" : "รับเงินสำเร็จ"}
              </div>
              <div style={{ fontSize: 16, color: "#8a7f70", marginBottom: 22 }}>
                {rc?.kind === "checkout"
                  ? `${rc?.name} · คืนสายรัดให้ทางร้าน 💛`
                  : rc?.kind === "checkin"
                    ? `${rc?.name} · พิมพ์สายรัด ${1 + (rc?.adultCount ?? 0)} ใบ · เริ่มเวลาแล้ว`
                    : `${rc?.name} · ขอบคุณค่ะ 💛`}
              </div>
              <div style={{ width: "100%", background: "#fff", borderRadius: 18, boxShadow: "0 2px 14px rgba(0,0,0,.06)", overflow: "hidden" }}>
                <div style={{ textAlign: "center", padding: "20px 0 12px", borderBottom: "1px dashed #e0d6c4" }}>
                  <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 22, color: "#2D6CB1" }}>Play <span style={{ color: "#F0B323" }}>a</span> lot</div>
                  <div style={{ fontSize: 13, color: "#a9978a", marginTop: 2 }}>{rc?.kind === "checkout" ? "สรุปการเล่นวันนี้" : "ใบเสร็จ"} {rc?.no}</div>
                </div>
                <div style={{ padding: "16px 28px" }}>
                  {(rc?.lines ?? []).map((l, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", fontSize: 16 }}>
                      <span style={{ color: "#6b6052" }}>{l.label}</span>
                      <span style={{ fontFamily: FREDOKA, fontWeight: 600 }}>฿{l.amount}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 0 4px", borderTop: "1px dashed #e0d6c4", marginTop: 10 }}>
                    <span style={{ fontSize: 18 }}>{rc?.kind === "checkout" ? "ยอดที่จ่ายแล้ว (พรีเพด)" : "รวม"}</span>
                    <span style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 24, color: "#1F8A5B" }}>฿{rc?.total}</span>
                  </div>
                  {rc?.bandCode && (
                    <div style={{ marginTop: 12, padding: "10px 0 2px", borderTop: "1px dashed #e0d6c4", textAlign: "center" }}>
                      <span style={{ fontSize: 13, color: "#8a7f70" }}>รหัสสายรัด</span>
                      <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 18, letterSpacing: "0.05em", color: "#3A3026" }}>{rc.bandCode}</div>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, width: "100%", marginTop: 20 }}>
                {rc?.kind === "checkin" && rc?.bandCode ? (
                  <div onClick={reprintBand} style={{ cursor: "pointer", flex: 1, background: "#fff", border: "1px solid #ece5d8", borderRadius: 13, padding: 15, textAlign: "center", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b6052" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v8H6z" /></svg>
                    พิมพ์สายรัดซ้ำ
                  </div>
                ) : (
                  <div onClick={printSlip} style={{ cursor: "pointer", flex: 1, background: "#fff", border: "1px solid #ece5d8", borderRadius: 13, padding: 15, textAlign: "center", fontSize: 16, color: "#6b6052", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b6052" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v8H6z" /></svg>
                    ปรินต์สลิป
                  </div>
                )}
                <div onClick={() => go("home")} style={{ cursor: "pointer", flex: 1.2, background: "#2D6CB1", color: "#fff", borderRadius: 13, padding: 15, textAlign: "center", fontSize: 16, fontFamily: MITR, fontWeight: 500 }}>เสร็จ</div>
              </div>
            </div>
          </div>
        )}

        {/* ===== MONITOR ===== */}
        {s.screen === "monitor" && (
          <div style={{ flex: 1, minHeight: 0, background: "#1c2740", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ height: 80, flex: "none", display: "flex", alignItems: "center", padding: "0 36px", gap: 18, borderBottom: "1px solid rgba(255,255,255,.08)" }}>
              <div onClick={() => go("home")} style={{ cursor: "pointer", color: "#9fb0d0", fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>{backIcon("#9fb0d0", 18)}ออก</div>
              <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 26, color: "#fff" }}>Play <span style={{ color: "#F0B323" }}>a</span> lot</div>
              <div style={{ color: "#9fb0d0", fontSize: 17 }}>กำลังเล่น <span style={{ color: "#fff", fontFamily: FREDOKA, fontWeight: 600 }}>{s.kids.length}</span> คน</div>
            </div>
            <div className="pl-grid-4" style={{ flex: 1, padding: "26px 36px", gridAutoRows: "1fr", gap: 16, overflow: "auto" }}>
              {s.kids.map((k) => {
                const over = !k.dayPass && k.sec < 0; // เกินเวลา
                const nearEnd = !k.dayPass && k.sec >= 0 && k.sec <= 600;
                // near-expiry/overtime tile is full-red → countdown must be white to read (prototype quirk fix)
                const color = k.dayPass ? "#5bc88a" : over || nearEnd ? "#fff" : colorFor(k.sec);
                return (
                  <div key={k.id} style={{ background: over || nearEnd ? "#E74C3C" : "#28365a", borderRadius: 18, padding: 20, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                    <div style={{ color: "#fff", fontSize: 19, fontWeight: 500, fontFamily: MITR }}>{k.name}</div>
                    <div>
                      <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 40, lineHeight: 1, color }}>{k.dayPass ? "ทั้งวัน" : over ? "+" + fmt(-k.sec) : fmt(Math.max(0, k.sec))}</div>
                      <div style={{ color: over ? "#ffe1de" : "#9fb0d0", fontSize: 14, marginTop: 4 }}>{k.dayPass ? "Day Pass" : over ? "เกินเวลา · เก็บค่าปรับ" : k.pkg}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ===== SHIFT (เปิด/ปิดกะ จริง — openShift/closeShift) ===== */}
        {s.screen === "shift" && (
          <div style={{ flex: 1, minHeight: 0, background: "#F7F2EA", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ height: 74, flex: "none", background: "#fff", borderBottom: "1px solid #ece5d8", display: "flex", alignItems: "center", padding: "0 28px", gap: 16 }}>
              <div onClick={() => go("home")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: "#6b6052", fontSize: 16 }}>{backIcon("#6b6052")}หน้าหลัก</div>
              <div style={{ width: 1, height: 28, background: "#ece5d8" }} />
              <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 20 }}>{shift ? "ปิดกะ" : "เปิดกะ"} — {props.cashierName}</div>
            </div>
            <div style={{ flex: 1, padding: "30px 36px", overflow: "auto", maxWidth: 680, margin: "0 auto", width: "100%" }}>
              {shift ? (
                <>
                  <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 22, marginBottom: 18 }}>สรุปกะนี้</div>
                  <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, overflow: "hidden", marginBottom: 22 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "16px 22px", borderBottom: "1px solid #f2ebdd" }}><span style={{ fontSize: 16, color: "#6b6052" }}>เงินต้นกะ</span><span style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: 18 }}>{baht(shift.openingCashCents)}</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "16px 22px", borderBottom: "1px solid #f2ebdd" }}><span style={{ fontSize: 16, color: "#6b6052" }}>+ เงินสดที่รับ (ค่าเข้า·ขนม·ต่อเวลา)</span><span style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: 18 }}>{baht(shift.cashSalesCents)}</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "16px 22px", background: "#f9f4ea" }}><span style={{ fontSize: 16, color: "#3A3026", fontWeight: 500 }}>ควรมีในลิ้นชัก</span><span style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 22, color: "#2D6CB1" }}>{baht(shExpectedCents)}</span></div>
                  </div>
                  <div style={{ fontSize: 13, color: "#a89c8b", margin: "-12px 4px 16px" }}>โอน/พร้อมเพย์/บัตร แยกต่างหาก ไม่นับเข้าลิ้นชัก · ยอดขายรวมทุกช่องทางดูได้ในรายงาน</div>
                  <div style={{ fontSize: 15, color: "#8a7f70", marginBottom: 8 }}>นับเงินจริงในลิ้นชัก (บาท)</div>
                  <input value={shiftClosing} onChange={(e) => setShiftClosing(e.target.value)} placeholder="เช่น 11210" inputMode="decimal" autoFocus style={{ ...inputStyle, fontFamily: FREDOKA, fontWeight: 700, fontSize: 22, marginBottom: 14 }} />
                  {shiftClosing.trim() !== "" && (
                    <div style={{ borderRadius: 12, padding: "14px 18px", fontSize: 16, fontWeight: 500, marginBottom: 18, background: shVarCents === 0 ? "#eaf3eb" : "#fdecea", color: shVarCents === 0 ? "#1F8A5B" : "#c0392b" }}>
                      {shVarCents === 0 ? "✓ ตรงพอดี ไม่ขาดไม่เกิน" : shVarCents > 0 ? `เกิน ${baht(shVarCents)} (เงินในลิ้นชักมากกว่ายอดขาย)` : `ขาด ${baht(Math.abs(shVarCents))} (เงินในลิ้นชักน้อยกว่าที่ควรมี)`}
                    </div>
                  )}
                  <div onClick={() => setShiftDayClose(!shiftDayClose)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
                    <span style={{ width: 24, height: 24, borderRadius: 6, background: shiftDayClose ? "#E74C3C" : "#fff", border: shiftDayClose ? "none" : "1.5px solid #d9cdb8", flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {shiftDayClose && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>}
                    </span>
                    <span style={{ fontSize: 15, color: "#6b6052" }}>ปิดวันด้วย (กะสุดท้ายของวัน)</span>
                  </div>
                  <div onClick={doCloseShift} style={{ cursor: shiftBusy ? "default" : "pointer", opacity: shiftBusy ? 0.6 : 1, background: "#E74C3C", color: "#fff", borderRadius: 14, padding: 17, textAlign: "center", fontFamily: MITR, fontWeight: 500, fontSize: 20 }}>{shiftBusy ? "กำลังปิดกะ..." : shiftDayClose ? "ยืนยันปิดวัน" : "ยืนยันปิดกะ"}</div>
                </>
              ) : (
                <>
                  <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: "26px 28px", textAlign: "center", marginBottom: 22 }}>
                    <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 20, marginBottom: 8 }}>ยังไม่มีกะเปิดอยู่</div>
                    <div style={{ fontSize: 15, color: "#8a7f70" }}>เปิดกะก่อนเริ่มรับเงิน — ระบบจะนับยอดขายเข้ากะนี้</div>
                  </div>
                  <div style={{ fontSize: 15, color: "#8a7f70", marginBottom: 8 }}>เงินตั้งต้นในลิ้นชัก (บาท)</div>
                  <input value={shiftOpening} onChange={(e) => setShiftOpening(e.target.value)} placeholder="เช่น 2000" inputMode="decimal" autoFocus style={{ ...inputStyle, fontFamily: FREDOKA, fontWeight: 700, fontSize: 22, marginBottom: 18 }} />
                  <div onClick={doOpenShift} style={{ cursor: shiftBusy ? "default" : "pointer", opacity: shiftBusy ? 0.6 : 1, background: "#1F8A5B", color: "#fff", borderRadius: 14, padding: 17, textAlign: "center", fontFamily: MITR, fontWeight: 500, fontSize: 20 }}>{shiftBusy ? "กำลังเปิดกะ..." : "เปิดกะ"}</div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ===== DASHBOARD ===== */}
        {s.screen === "dashboard" && (
          <div style={{ flex: 1, minHeight: 0, background: "#F7F2EA", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ height: 74, flex: "none", background: "#fff", borderBottom: "1px solid #ece5d8", display: "flex", alignItems: "center", padding: "0 28px", gap: 16 }}>
              <div onClick={() => go("home")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: "#6b6052", fontSize: 16 }}>{backIcon("#6b6052")}หน้าหลัก</div>
              <div style={{ width: 1, height: 28, background: "#ece5d8" }} />
              <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 20 }}>Dashboard ร้าน</div>
            </div>
            <div style={{ flex: 1, padding: "26px 32px", display: "flex", flexDirection: "column", gap: 18, overflow: "auto" }}>
              <div className="pl-kpi-row" style={{ gap: 16 }}>
                <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: "18px 20px" }}><div style={{ fontSize: 13, color: "#8a7f70" }}>รายได้วันนี้</div><div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 26, color: "#1F8A5B" }}>{revenueStr}</div></div>
                <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: "18px 20px" }}><div style={{ fontSize: 13, color: "#8a7f70" }}>ค่าเข้าเล่น</div><div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 26, color: "#2D6CB1" }}>฿{(stats?.entryRevenue ?? 0).toLocaleString()}</div></div>
                <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: "18px 20px" }}><div style={{ fontSize: 13, color: "#8a7f70" }}>ขายขนม</div><div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 26, color: "#F0B323" }}>฿{(stats?.productRevenue ?? 0).toLocaleString()}</div></div>
                <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: "18px 20px" }}><div style={{ fontSize: 13, color: "#8a7f70" }}>เด็กเข้าวันนี้</div><div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 26, color: "#3A3026" }}>{stats?.sessionsToday ?? s.kids.length}</div></div>
              </div>
              <div className="pl-kpi-row" style={{ gap: 16 }}>
                <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: "18px 20px" }}><div style={{ fontSize: 13, color: "#8a7f70" }}>กำลังเล่นตอนนี้</div><div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 26, color: "#E74C3C" }}>{s.kids.length}</div></div>
                <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: "18px 20px" }}><div style={{ fontSize: 13, color: "#8a7f70" }}>บิลขนมวันนี้</div><div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 26, color: "#2D6CB1" }}>{stats?.salesCount ?? 0}</div></div>
                <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: "18px 20px" }}><div style={{ fontSize: 13, color: "#8a7f70" }}>สมาชิกทั้งหมด</div><div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 26, color: "#7a5cc4" }}>{stats?.memberCount ?? 0}</div></div>
                <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: "18px 20px" }}><div style={{ fontSize: 13, color: "#8a7f70" }}>จองวันนี้</div><div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 26, color: "#0f9b8e" }}>{stats?.bookingsToday ?? bookings.length}</div></div>
              </div>
              <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: 22 }}>
                <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 18, marginBottom: 6 }}>รายงานเชิงลึก</div>
                <div style={{ fontSize: 14, color: "#8a7f70", marginBottom: 14 }}>กราฟยอดขายย้อนหลัง · ขนมขายดี · สรุปกะ — อยู่ในหน้ารายงานเต็ม</div>
                <div onClick={() => router.push("/playland/reports")} style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8, background: "#2D6CB1", color: "#fff", borderRadius: 12, padding: "12px 20px", fontSize: 15, fontFamily: MITR, fontWeight: 500 }}>
                  เปิดรายงานเต็ม
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M7 7h10v10" /></svg>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===== SETTINGS (honest hub → links to real config pages) ===== */}
        {(s.screen === "settings" || s.screen === "staff") && (
          <div style={{ flex: 1, minHeight: 0, background: "#F7F2EA", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ height: 74, flex: "none", background: "#fff", borderBottom: "1px solid #ece5d8", display: "flex", alignItems: "center", padding: "0 28px", gap: 16 }}>
              <div onClick={() => go("home")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: "#6b6052", fontSize: 16 }}>{backIcon("#6b6052")}หน้าหลัก</div>
              <div style={{ width: 1, height: 28, background: "#ece5d8" }} />
              <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 20 }}>ตั้งค่า</div>
            </div>
            <div style={{ flex: 1, padding: "30px 36px", overflow: "auto", maxWidth: 980, margin: "0 auto", width: "100%" }}>
              <div style={{ fontSize: 16, color: "#8a7f70", marginBottom: 22 }}>เปิดหน้าตั้งค่าจริงของแต่ละส่วน — ปลอดภัย มีบันทึก audit</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {settingsLink({ onClick: () => router.push("/playland/settings/packages"), color: "#2D6CB1", title: "แพ็กเกจเวลา", sub: packages.length + " แพ็กเกจ · ตั้งราคา/เวลา" })}
                {settingsLink({ onClick: () => router.push("/playland/settings/products"), color: "#F0B323", title: "ขนม · เครื่องดื่ม", sub: products.length + " รายการ · ราคา/รูป" })}
                {settingsLink({ onClick: () => router.push("/playland/settings/stock-count"), color: "#1F8A5B", title: "สต๊อก · นับของ", sub: "ปรับ/นับสต๊อกขนม" })}
                {settingsLink({ onClick: () => router.push("/playland/settings/branches"), color: "#7a5cc4", title: "สาขา", sub: "ข้อมูลสาขา · ที่อยู่" })}
                {settingsLink({ onClick: () => router.push("/playland/settings/devices"), color: "#0f9b8e", title: "อุปกรณ์ · เครื่องสแกน", sub: "ประตู/กล้องจดจำใบหน้า" })}
                {settingsLink({ onClick: () => router.push("/playland/settings/promos"), color: "#E74C3C", title: "โปรโมชั่น", sub: "ส่วนลด · แคมเปญ" })}
                {settingsLink({ onClick: () => router.push("/playland/settings"), color: "#6b6052", title: "ตั้งค่าทั้งหมด · พนักงาน", sub: "สิทธิ์พนักงาน · ตั้งค่าระบบ" })}
                {settingsLink({ onClick: () => router.push("/playland/reports"), color: "#1c2740", title: "รายงาน", sub: "ยอดขาย · กะ · สถิติ" })}
              </div>
            </div>
          </div>
        )}

        {/* ===== MEMBERS (search + register, real data) ===== */}
        {s.screen === "members" && (
          <div style={{ flex: 1, minHeight: 0, background: "#F7F2EA", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ height: 74, flex: "none", background: "#fff", borderBottom: "1px solid #ece5d8", display: "flex", alignItems: "center", padding: "0 28px", gap: 16 }}>
              <div onClick={() => go("home")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: "#6b6052", fontSize: 16 }}>{backIcon("#6b6052")}หน้าหลัก</div>
              <div style={{ width: 1, height: 28, background: "#ece5d8" }} />
              <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 20, flex: 1 }}>สมาชิก</div>
              <div style={{ display: "flex", gap: 8 }}>
                <div onClick={() => setMemTab("search")} style={{ cursor: "pointer", background: memTab === "search" ? "#2D6CB1" : "#f4ede0", color: memTab === "search" ? "#fff" : "#6b6052", fontSize: 14, padding: "8px 16px", borderRadius: 10 }}>ค้นหา</div>
                <div onClick={() => setMemTab("register")} style={{ cursor: "pointer", background: memTab === "register" ? "#2D6CB1" : "#f4ede0", color: memTab === "register" ? "#fff" : "#6b6052", fontSize: 14, padding: "8px 16px", borderRadius: 10 }}>ลงทะเบียนใหม่</div>
              </div>
            </div>
            <div style={{ flex: 1, padding: "26px 36px", overflow: "auto", maxWidth: 880, margin: "0 auto", width: "100%" }}>
              {memTab === "search" ? (
                <>
                  <div style={{ background: "#fff", borderRadius: 12, display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", marginBottom: 18, border: "1.5px solid #2D6CB1" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a9978a" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>
                    <input value={memQuery} onChange={(e) => setMemQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") runMemberSearch(); }} placeholder="ค้นชื่อ · เบอร์โทร · รหัสสมาชิก" autoFocus style={{ flex: 1, border: "none", outline: "none", color: "#3A3026", fontSize: 17, fontFamily: MITR, background: "transparent" }} />
                    <span onClick={runMemberSearch} style={{ cursor: "pointer", background: "#2D6CB1", color: "#fff", fontSize: 14, padding: "8px 16px", borderRadius: 9 }}>{memSearching ? "..." : "ค้นหา"}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {memResults.length === 0 && <div style={{ textAlign: "center", color: "#bcae9b", fontSize: 15, padding: "40px 0" }}>{memSearching ? "กำลังค้นหา..." : "พิมพ์ชื่อ/เบอร์แล้วกดค้นหา · คลิกสมาชิกเพื่อรับเข้าเล่น"}</div>}
                    {memResults.map((m, i) => (
                      <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", border: "1px solid #ece5d8", borderRadius: 14, background: "#fff" }}>
                        <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#eaf3f6", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={mascotSrc(MASCOTS[i % 3])} alt="" style={{ width: 40 }} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 500, fontSize: 18 }}>{m.nickname || m.name} <span style={{ fontSize: 13, color: m.type === "KID" ? "#2D6CB1" : "#a9791a", marginLeft: 6 }}>{m.type === "KID" ? "เด็ก" : "ผู้ใหญ่"}</span></div>
                          <div style={{ fontSize: 14, color: "#8a7f70" }}>{m.name}{m.phone ? " · " + m.phone : ""}{m.memberCode ? " · " + m.memberCode : ""}{m.lastVisitAt ? " · มาล่าสุด " + new Date(m.lastVisitAt).toLocaleDateString("th-TH") : ""}</div>
                        </div>
                        <div onClick={() => startCheckinForMember(m)} style={{ cursor: "pointer", background: "#F0B323", color: "#fff", fontSize: 14, padding: "9px 16px", borderRadius: 10 }}>รับเข้าเล่น</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ maxWidth: 640 }}>
                  <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 22, marginBottom: 16 }}>ลงทะเบียนสมาชิกใหม่</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 14 }}>
                    <div><div style={{ fontSize: 14, color: "#8a7f70", marginBottom: 7 }}>ชื่อ-นามสกุล *</div><input value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="ชื่อจริง" style={inputStyle} /></div>
                    <div><div style={{ fontSize: 14, color: "#8a7f70", marginBottom: 7 }}>ชื่อเล่น</div><input value={regNick} onChange={(e) => setRegNick(e.target.value)} placeholder="ชื่อเล่น" style={inputStyle} /></div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                    <div><div style={{ fontSize: 14, color: "#8a7f70", marginBottom: 7 }}>เบอร์โทร</div><input value={regPhone} onChange={(e) => setRegPhone(e.target.value)} placeholder="0812345678" inputMode="tel" style={inputStyle} /></div>
                    <div>
                      <div style={{ fontSize: 14, color: "#8a7f70", marginBottom: 7 }}>ประเภท</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <span onClick={() => setRegType("KID")} style={{ flex: 1, textAlign: "center", cursor: "pointer", padding: 13, borderRadius: 12, fontSize: 16, background: regType === "KID" ? "#2D6CB1" : "#fff", color: regType === "KID" ? "#fff" : "#6b6052", border: regType === "KID" ? "1px solid #2D6CB1" : "1px solid #ece5d8" }}>เด็ก</span>
                        <span onClick={() => setRegType("PARENT")} style={{ flex: 1, textAlign: "center", cursor: "pointer", padding: 13, borderRadius: 12, fontSize: 16, background: regType === "PARENT" ? "#2D6CB1" : "#fff", color: regType === "PARENT" ? "#fff" : "#6b6052", border: regType === "PARENT" ? "1px solid #2D6CB1" : "1px solid #ece5d8" }}>ผู้ใหญ่</span>
                      </div>
                    </div>
                  </div>
                  <div onClick={() => setRegConsent(!regConsent)} style={{ cursor: "pointer", background: "#f9f4ea", borderRadius: 14, padding: 18, display: "flex", gap: 11, alignItems: "flex-start", marginBottom: 18 }}>
                    <span style={{ width: 26, height: 26, borderRadius: 7, background: regConsent ? "#1F8A5B" : "#fff", border: regConsent ? "none" : "1.5px solid #d9cdb8", flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {regConsent && <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>}
                    </span>
                    <span style={{ fontSize: 14, color: "#6b6052", lineHeight: 1.5 }}>ยินยอมให้เก็บข้อมูลตาม PDPA (จำเป็น)</span>
                  </div>
                  {regNewCode && (
                    <div style={{ background: "#eaf3eb", color: "#1F8A5B", borderRadius: 12, padding: "14px 18px", fontSize: 16, marginBottom: 16 }}>✓ ลงทะเบียนสำเร็จ · รหัสสมาชิก <strong style={{ fontFamily: FREDOKA }}>{regNewCode}</strong></div>
                  )}
                  <div onClick={submitRegister} style={{ cursor: regBusy ? "default" : "pointer", opacity: regBusy ? 0.6 : 1, background: "#2D6CB1", color: "#fff", borderRadius: 14, padding: 16, textAlign: "center", fontFamily: MITR, fontWeight: 500, fontSize: 19 }}>{regBusy ? "กำลังบันทึก..." : "บันทึกสมาชิก"}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== WRISTBAND (scan / issue) ===== */}
        {s.screen === "wristband" && (
          <div style={{ flex: 1, minHeight: 0, background: "#F7F2EA", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ height: 74, flex: "none", background: "#fff", borderBottom: "1px solid #ece5d8", display: "flex", alignItems: "center", padding: "0 28px", gap: 16 }}>
              <div onClick={() => { setWbLookup(null); setWbCode(""); go("home"); }} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: "#6b6052", fontSize: 16 }}>{backIcon("#6b6052")}หน้าหลัก</div>
              <div style={{ width: 1, height: 28, background: "#ece5d8" }} />
              <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 20 }}>สายรัด · สแกน</div>
            </div>
            <div style={{ flex: 1, padding: "26px 36px", overflow: "auto", maxWidth: 760, margin: "0 auto", width: "100%" }}>
              <div style={{ background: "#fff", borderRadius: 12, display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", marginBottom: 18, border: "1.5px solid #1F8A5B" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1F8A5B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h7v7h-7z" /></svg>
                <input value={wbCode} onChange={(e) => setWbCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") runWbLookup(); }} placeholder="สแกน หรือ พิมพ์รหัสสายรัด (PW-...)" autoFocus style={{ flex: 1, border: "none", outline: "none", color: "#3A3026", fontSize: 17, fontFamily: MITR, background: "transparent", letterSpacing: "0.04em" }} />
                <span onClick={runWbLookup} style={{ cursor: "pointer", background: "#1F8A5B", color: "#fff", fontSize: 14, padding: "9px 18px", borderRadius: 9 }}>{wbBusy ? "..." : "สแกน"}</span>
              </div>

              {wbLookup ? (
                <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: "22px 24px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
                    <div style={{ width: 52, height: 52, borderRadius: "50%", background: "#eaf3f6", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={mascotSrc("skye")} alt="" style={{ width: 42 }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, fontSize: 20 }}>{wbLookup.member?.nickname || wbLookup.member?.name || "—"}</div>
                      <div style={{ fontSize: 14, color: "#8a7f70" }}>{wbLookup.wristband.code} · สถานะ {wbLookup.wristband.status}{wbLookup.session ? " · " + wbLookup.session.packageName : ""}</div>
                    </div>
                  </div>
                  {wbLookup.hint && <div style={{ background: "#f9f4ea", color: "#6b6052", borderRadius: 12, padding: "12px 16px", fontSize: 14, marginBottom: 16 }}>{wbLookup.hint}</div>}
                  {wbLookup.allowedActions.includes("ACTIVATE") && (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 14, color: "#8a7f70", marginBottom: 8 }}>เลือกแพ็กเกจ + รับเงิน</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                        {packages.filter((p) => isRealId(p.id)).map((p) => (
                          <span key={p.id} onClick={() => setWbActPkg(p.id)} style={{ cursor: "pointer", padding: "10px 14px", borderRadius: 10, fontSize: 15, background: wbActPkg === p.id ? "#2D6CB1" : "#fff", color: wbActPkg === p.id ? "#fff" : "#6b6052", border: wbActPkg === p.id ? "1px solid #2D6CB1" : "1px solid #ece5d8" }}>{p.label} ฿{p.price}</span>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>{payButtons(wbActPay, setWbActPay)}</div>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 10 }}>
                    {wbLookup.allowedActions.includes("ACTIVATE") && <div onClick={wbActivate} style={{ cursor: "pointer", flex: 1, background: "#1F8A5B", color: "#fff", borderRadius: 12, padding: 15, textAlign: "center", fontSize: 16, fontFamily: MITR, fontWeight: 500 }}>เปิด gate · เริ่มเล่น</div>}
                    {wbLookup.allowedActions.includes("POS_CHARGE") && <div onClick={wbPosCharge} style={{ cursor: "pointer", flex: 1, background: "#F0B323", color: "#fff", borderRadius: 12, padding: 15, textAlign: "center", fontSize: 16, fontFamily: MITR, fontWeight: 500 }}>ขายขนมให้</div>}
                    {wbLookup.allowedActions.includes("EXIT") && <div onClick={wbExit} style={{ cursor: "pointer", flex: 1, background: "#E74C3C", color: "#fff", borderRadius: 12, padding: 15, textAlign: "center", fontSize: 16, fontFamily: MITR, fontWeight: 500 }}>ออก · คืนสายรัด</div>}
                  </div>
                </div>
              ) : (
                <div style={{ background: "#fff", border: "1px dashed #d9cdb8", borderRadius: 16, padding: "26px 24px" }}>
                  <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 18, marginBottom: 6 }}>ออกสายรัดใหม่</div>
                  <div style={{ fontSize: 14, color: "#8a7f70", marginBottom: 14 }}>ค้นหาสมาชิกในหน้า “สมาชิก” ก่อน แล้วกลับมาออกสายรัดให้รายที่ค้นล่าสุด หรือใส่ memberId</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input value={wbIssueMemberId} onChange={(e) => setWbIssueMemberId(e.target.value)} placeholder={memResults[0] ? `รายล่าสุด: ${memResults[0].name}` : "memberId"} style={{ ...inputStyle, flex: 1 }} />
                    <div onClick={wbIssue} style={{ cursor: "pointer", background: "#1F8A5B", color: "#fff", borderRadius: 12, padding: "14px 22px", fontSize: 16, fontFamily: MITR, fontWeight: 500, whiteSpace: "nowrap" }}>{wbBusy ? "..." : "ออก + พิมพ์"}</div>
                  </div>
                  <div onClick={() => go("members")} style={{ cursor: "pointer", color: "#2D6CB1", fontSize: 14, marginTop: 12 }}>→ ไปค้นหาสมาชิก</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== BOOKINGS ===== */}
        {s.screen === "bookings" && (
          <div style={{ flex: 1, minHeight: 0, background: "#F7F2EA", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ height: 74, flex: "none", background: "#fff", borderBottom: "1px solid #ece5d8", display: "flex", alignItems: "center", padding: "0 28px", gap: 16 }}>
              <div onClick={() => go("home")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: "#6b6052", fontSize: 16 }}>{backIcon("#6b6052")}หน้าหลัก</div>
              <div style={{ width: 1, height: 28, background: "#ece5d8" }} />
              <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 20, flex: 1 }}>จองล่วงหน้า · วันนี้</div>
              <div onClick={() => setBkForm(!bkForm)} style={{ cursor: "pointer", background: "#2D6CB1", color: "#fff", fontSize: 15, padding: "10px 18px", borderRadius: 11 }}>{bkForm ? "ปิดฟอร์ม" : "+ จองใหม่"}</div>
            </div>
            <div style={{ flex: 1, padding: "24px 36px", overflow: "auto", maxWidth: 900, margin: "0 auto", width: "100%" }}>
              {bkForm && (
                <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: "22px 24px", marginBottom: 20 }}>
                  <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 19, marginBottom: 14 }}>จองใหม่ (walk-up / โทรจอง)</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                    <div><div style={{ fontSize: 13, color: "#8a7f70", marginBottom: 6 }}>ชื่อลูกค้า *</div><input value={bkName} onChange={(e) => setBkName(e.target.value)} placeholder="ชื่อ" style={inputStyle} /></div>
                    <div><div style={{ fontSize: 13, color: "#8a7f70", marginBottom: 6 }}>เบอร์โทร</div><input value={bkPhone} onChange={(e) => setBkPhone(e.target.value)} placeholder="0812345678" inputMode="tel" style={inputStyle} /></div>
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 13, color: "#8a7f70", marginBottom: 6 }}>แพ็กเกจ</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {packages.filter((p) => isRealId(p.id)).map((p) => (
                        <span key={p.id} onClick={() => setBkPkg(p.id)} style={{ cursor: "pointer", padding: "10px 14px", borderRadius: 10, fontSize: 15, background: (bkPkg ?? packages.find((x) => isRealId(x.id))?.id) === p.id ? "#2D6CB1" : "#fff", color: (bkPkg ?? packages.find((x) => isRealId(x.id))?.id) === p.id ? "#fff" : "#6b6052", border: "1px solid #ece5d8" }}>{p.label} ฿{p.price}</span>
                      ))}
                      {packages.filter((p) => isRealId(p.id)).length === 0 && <span style={{ fontSize: 14, color: "#a9978a" }}>ยังไม่มีแพ็กเกจจริงในระบบ — เพิ่มที่ตั้งค่า</span>}
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 16 }}>
                    <div><div style={{ fontSize: 13, color: "#8a7f70", marginBottom: 6 }}>วันที่</div><input type="date" value={bkDate} onChange={(e) => setBkDate(e.target.value)} style={inputStyle} /></div>
                    <div><div style={{ fontSize: 13, color: "#8a7f70", marginBottom: 6 }}>เวลา (ชม.)</div><input type="number" min={0} max={23} value={bkHour} onChange={(e) => setBkHour(Number(e.target.value))} style={inputStyle} /></div>
                    <div><div style={{ fontSize: 13, color: "#8a7f70", marginBottom: 6 }}>จำนวนคน</div><input type="number" min={1} max={20} value={bkParty} onChange={(e) => setBkParty(Number(e.target.value))} style={inputStyle} /></div>
                  </div>
                  <div onClick={submitBooking} style={{ cursor: bkBusy ? "default" : "pointer", opacity: bkBusy ? 0.6 : 1, background: "#1F8A5B", color: "#fff", borderRadius: 12, padding: 15, textAlign: "center", fontSize: 17, fontFamily: MITR, fontWeight: 500 }}>{bkBusy ? "กำลังจอง..." : "บันทึกการจอง"}</div>
                </div>
              )}

              {props.branchSlug && (
                <div style={{ background: "#eaf3f6", color: "#2D6CB1", borderRadius: 12, padding: "12px 16px", fontSize: 14, marginBottom: 18 }}>
                  ลิงก์จองสาธารณะ: <strong>/p/playland/{props.branchSlug}/book</strong> — ส่งให้ลูกค้าจองเองได้
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {bookings.length === 0 && <div style={{ textAlign: "center", color: "#bcae9b", fontSize: 15, padding: "40px 0" }}>วันนี้ยังไม่มีการจอง</div>}
                {bookings.map((b) => (
                  <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", border: "1px solid #ece5d8", borderRadius: 14, background: "#fff" }}>
                    <div style={{ textAlign: "center", minWidth: 64 }}>
                      <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 20, color: "#2D6CB1" }}>{b.slotTime}</div>
                      <div style={{ fontSize: 12, color: "#a9978a" }}>{b.partySize} คน</div>
                    </div>
                    <div style={{ width: 1, height: 36, background: "#f2ebdd" }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, fontSize: 17 }}>{b.customerName}</div>
                      <div style={{ fontSize: 13, color: "#8a7f70" }}>{b.customerPhone} · {b.pkgName} · {b.code}</div>
                    </div>
                    <div style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: 17, marginRight: 6 }}>฿{b.amount.toLocaleString()}</div>
                    {bookingChip(b.status)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>

      {/* toast — fixed so it's visible across the full-screen kiosk */}
      {s.toast != null && (
        <div style={{ position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", background: "#1c2740", color: "#fff", padding: "14px 26px", borderRadius: 999, fontSize: 16, boxShadow: "0 8px 28px rgba(0,0,0,.3)", zIndex: 90 }}>{s.toast}</div>
      )}
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

// Payment-method pills (เงินสด / พร้อมเพย์ / บัตร) — used by check-in pay, POS, extend
const PAY_LABELS: Record<PayMethod, string> = { CASH: "เงินสด", PROMPTPAY: "พร้อมเพย์", CARD: "บัตร" };
function payButtons(current: PayMethod, set: (m: PayMethod) => void) {
  return (["CASH", "PROMPTPAY", "CARD"] as PayMethod[]).map((m) => {
    const on = current === m;
    return (
      <span
        key={m}
        onClick={() => set(m)}
        style={{
          flex: 1,
          textAlign: "center",
          cursor: "pointer",
          background: on ? "#2D6CB1" : "#fff",
          color: on ? "#fff" : "#6b6052",
          border: on ? "1px solid #2D6CB1" : "1px solid #ece5d8",
          fontSize: 16,
          padding: 13,
          borderRadius: 12,
          fontWeight: on ? 500 : 400,
        }}
      >
        {PAY_LABELS[m]}
      </span>
    );
  });
}

// Settings link-out tile (honest: links to the real config page, no fake toggles)
function settingsLink(opts: { onClick: () => void; color: string; title: string; sub: string }) {
  return (
    <div onClick={opts.onClick} style={{ cursor: "pointer", background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: "20px 22px", display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ width: 12, height: 44, borderRadius: 6, background: opts.color, flex: "none" }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 19 }}>{opts.title}</div>
        <div style={{ fontSize: 14, color: "#8a7f70" }}>{opts.sub}</div>
      </div>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#bcae9b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M7 7h10v10" /></svg>
    </div>
  );
}

// Booking status chip (รอชำระ / ชำระแล้ว / เข้าแล้ว / ยกเลิก / หมดอายุ)
function bookingChip(status: string) {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    PENDING: { label: "รอชำระ", bg: "#fdf3df", fg: "#a9791a" },
    PAID: { label: "ชำระแล้ว", bg: "#eaf3eb", fg: "#1F8A5B" },
    CHECKED_IN: { label: "เข้าแล้ว", bg: "#eaf3f6", fg: "#2D6CB1" },
    CANCELLED: { label: "ยกเลิก", bg: "#fdeceb", fg: "#E74C3C" },
    EXPIRED: { label: "หมดอายุ", bg: "#f0ece4", fg: "#8a7f70" },
    NO_SHOW: { label: "ไม่มา", bg: "#f0ece4", fg: "#8a7f70" },
  };
  const c = map[status] ?? { label: status, bg: "#f0ece4", fg: "#8a7f70" };
  return <span style={{ background: c.bg, color: c.fg, fontSize: 13, fontWeight: 600, padding: "6px 12px", borderRadius: 999 }}>{c.label}</span>;
}

// Compact home-hub card (colored tile + icon + title/sub) — shares the app aesthetic
function hubCard(opts: { onClick: () => void; bg: string; title: string; sub: React.ReactNode; icon: React.ReactNode }) {
  return (
    <div onClick={opts.onClick} style={{ cursor: "pointer", background: opts.bg, borderRadius: 18, padding: "20px 22px", color: "#fff", display: "flex", flexDirection: "column", gap: 14, minHeight: 120 }}>
      <div style={{ width: 48, height: 48, borderRadius: 13, background: "rgba(255,255,255,.16)", display: "flex", alignItems: "center", justifyContent: "center" }}>{opts.icon}</div>
      <div>
        <div style={{ fontFamily: MITR, fontWeight: 500, fontSize: 20 }}>{opts.title}</div>
        <div style={{ fontSize: 14, opacity: 0.85 }}>{opts.sub}</div>
      </div>
    </div>
  );
}

