// ClawHub (JOLLY PLAY) customer LIFF entry · /liff/clawhub?screen=…&machine=…&reward=…
//
// Server Component: parses the ?screen= query, resolves the reward catalog + the
// ?machine= snapshot + the ?reward= target server-side (read-only), then hands them to
// the client <ScreenShell> wrapped in .clawhub-scope + <ClawhubProvider> (which boots
// LIFF for the clawhub channel and loads the member). The LIFF id_token never leaves the
// client except on a verified write POST.
//
// Rich menu opens this with ?screen=home|refund|points|rewards|help|register and may pass
// ?machine=<code-or-qrToken>.

import "@/components/clawhub/tokens.css";
import { clawhubOrgId } from "@/lib/clawhub/org";
import { listActiveRewards } from "@/lib/clawhub/rewards";
import { resolveMachine } from "@/lib/clawhub/customer-data";
import { ClawhubProvider } from "@/components/clawhub/customer/liff-context";
import {
  ScreenShell,
  type Screen,
  type ScreenData,
} from "@/components/clawhub/customer/screen-shell";
import type { RewardCard } from "@/components/clawhub/customer/rewards-screen";

export const dynamic = "force-dynamic";

const SCREENS: Screen[] = [
  "home",
  "register",
  "refund",
  "points",
  "rewards",
  "redeem-confirm",
  "help",
];

function one(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.length ? s : null;
}

function asScreen(v: string | null): Screen {
  return v && (SCREENS as string[]).includes(v) ? (v as Screen) : "home";
}

export default async function ClawhubLiffPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const screen = asScreen(one(sp.screen));
  const machineCode = one(sp.machine);
  const rewardId = one(sp.reward);

  const orgId = await clawhubOrgId();

  // Only fetch what the screen actually needs (keep the server payload lean).
  const needRewards = screen === "rewards" || screen === "redeem-confirm";
  const needMachine = screen === "refund" && !!machineCode;

  const [rewardsRaw, machineRaw] = await Promise.all([
    needRewards ? listActiveRewards(orgId) : Promise.resolve([]),
    needMachine && machineCode
      ? resolveMachine(orgId, machineCode)
      : Promise.resolve(null),
  ]);

  const rewards: RewardCard[] = rewardsRaw.map((r) => ({
    id: r.id,
    name: r.name,
    imageUrl: r.imageUrl,
    pointsPrice: r.pointsPrice,
    stock: r.stock,
  }));

  const reward: RewardCard | null =
    screen === "redeem-confirm" && rewardId
      ? rewards.find((r) => r.id === rewardId) ?? null
      : null;

  const data: ScreenData = {
    screen,
    machine: machineRaw
      ? { machineCode: machineRaw.machineCode, branchName: machineRaw.branchName }
      : null,
    machineCode,
    rewards,
    reward,
  };

  return (
    <div className="clawhub-scope min-h-screen" style={{ background: "var(--cw-bg)" }}>
      <ClawhubProvider>
        <ScreenShell {...data} />
      </ClawhubProvider>
    </div>
  );
}
