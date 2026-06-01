// PhotoArt · sophisticated empty-state placeholder for rooms without
// uploaded photos yet. Uses gentle gradient per price-tier + outline
// bed/sofa silhouette + room name + small "Mix Hotel" wordmark watermark.
// Looks intentional, not "missing-image".

type Tier = "compact" | "single" | "double" | "large" | "vip" | "default";

function tierFor(price: number, name: string): Tier {
  if (price <= 300) return "compact";
  if (name.includes("VIP") || price >= 550) return "vip";
  if (name.includes("Large") || name.includes("Double") || price >= 450) return "double";
  if (price <= 400) return "single";
  return "default";
}

const PALETTE: Record<Tier, { from: string; to: string; accent: string; icon: "bed" | "bed-double" | "sofa" | "spa" }> = {
  compact:  { from: "#F5E6D8", to: "#E8C9A8", accent: "#9C7A5E", icon: "bed" },
  single:   { from: "#F0E1C8", to: "#D9B687", accent: "#8B6F4A", icon: "bed" },
  double:   { from: "#E4DCD0", to: "#B8A48A", accent: "#6B5942", icon: "bed-double" },
  large:    { from: "#DDD4E8", to: "#B5A4D2", accent: "#5E4B7A", icon: "sofa" },
  vip:      { from: "#D4C5E0", to: "#8B6CB5", accent: "#3F2D5C", icon: "spa" },
  default:  { from: "#E8E0D2", to: "#C9B898", accent: "#6B5942", icon: "bed" },
};

function BedOutline({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 120 80" className="w-24 h-16 sm:w-32 sm:h-20 opacity-90" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 56 L8 70 M112 56 L112 70" />
      <path d="M4 56 L116 56 L116 64 L4 64 Z" fill={color} fillOpacity="0.15" />
      <path d="M16 56 L16 40 L104 40 L104 56" />
      <path d="M28 50 L52 50 M68 50 L92 50" />
      <circle cx="40" cy="46" r="3" />
      <circle cx="80" cy="46" r="3" />
    </svg>
  );
}

function BedDoubleOutline({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 140 80" className="w-28 h-16 sm:w-36 sm:h-20 opacity-90" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 56 L8 70 M132 56 L132 70" />
      <path d="M4 56 L136 56 L136 64 L4 64 Z" fill={color} fillOpacity="0.15" />
      <path d="M16 56 L16 38 L124 38 L124 56" />
      <path d="M70 38 L70 56" />
      <circle cx="40" cy="46" r="3" />
      <circle cx="100" cy="46" r="3" />
    </svg>
  );
}

function SofaOutline({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 130 80" className="w-28 h-16 sm:w-32 sm:h-20 opacity-90" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 50 Q8 38 20 38 L110 38 Q122 38 122 50 L122 62 Q122 68 116 68 L14 68 Q8 68 8 62 Z" />
      <path d="M22 50 L108 50" />
      <path d="M30 50 L30 38 M50 50 L50 38 M80 50 L80 38 M100 50 L80 38" />
      <path d="M8 62 L8 72 M122 62 L122 72" />
    </svg>
  );
}

function SpaOutline({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 120 80" className="w-24 h-16 sm:w-28 sm:h-20 opacity-90" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 50 Q14 60 24 60 L96 60 Q106 60 106 50" />
      <path d="M8 50 L112 50" />
      <path d="M14 50 L14 36 Q14 30 20 30 L100 30 Q106 30 106 36 L106 50" />
      <path d="M20 30 L20 22 L30 22 L30 30" />
      <path d="M44 22 L48 18 M52 24 L56 20 M60 22 L64 18" />
      <path d="M14 60 L10 70 M106 60 L110 70" />
    </svg>
  );
}

export function PhotoArt({ name, price }: { name: string; price: number }) {
  const tier = tierFor(price, name);
  const p = PALETTE[tier];

  const Icon =
    p.icon === "bed-double" ? BedDoubleOutline :
    p.icon === "sofa"       ? SofaOutline :
    p.icon === "spa"        ? SpaOutline :
                              BedOutline;

  return (
    <div
      className="relative w-full h-full overflow-hidden"
      style={{ background: `linear-gradient(155deg, ${p.from} 0%, ${p.to} 100%)` }}
    >
      {/* Subtle grid pattern */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.07]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke={p.accent} strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>

      {/* Top-right corner accent */}
      <div className="absolute top-3 right-3 sm:top-4 sm:right-4">
        <span
          className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-medium px-2 py-0.5 rounded-full backdrop-blur-sm"
          style={{ background: "rgba(255,255,255,0.55)", color: p.accent }}
        >
          ภาพห้องจริง · เร็วๆ นี้
        </span>
      </div>

      {/* Centered art */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-4">
        <Icon color={p.accent} />
        <div className="mt-3 text-center">
          <div
            className="text-base sm:text-lg font-semibold"
            style={{ color: p.accent, fontFamily: "var(--font-sarabun, ui-serif), serif", letterSpacing: "-0.01em" }}
          >
            {name}
          </div>
          <div
            className="mt-1 text-xs sm:text-sm tabular-nums"
            style={{ color: p.accent, opacity: 0.75 }}
          >
            ฿{price.toLocaleString()}/คืน
          </div>
        </div>
      </div>

      {/* Bottom-left "Mix Hotel" watermark */}
      <div
        className="absolute bottom-3 left-3 text-[9px] sm:text-[10px] font-semibold tracking-tight"
        style={{ color: p.accent, opacity: 0.5 }}
      >
        MIX · HOTEL
      </div>
    </div>
  );
}
