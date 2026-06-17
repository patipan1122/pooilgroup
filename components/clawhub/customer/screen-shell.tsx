"use client";

// ClawHub customer shell — sits inside <ClawhubProvider> and gates rendering on the LIFF
// boot phase: spinner while LIFF/member loads, calm error if not opened in LINE, else the
// chosen screen. Screen routing is driven by ?screen= (server passes the parsed value +
// any server-resolved data as props).

import { useClawhub } from "./liff-context";
import { CwLoading, CwError } from "./ui";
import { HomeScreen } from "./home-screen";
import { RegisterScreen } from "./register-screen";
import { RefundScreen } from "./refund-screen";
import { PointsScreen } from "./points-screen";
import { RewardsScreen, type RewardCard } from "./rewards-screen";
import { RedeemConfirmScreen } from "./redeem-confirm-screen";
import { HelpScreen } from "./help-screen";

export type Screen =
  | "home"
  | "register"
  | "refund"
  | "points"
  | "rewards"
  | "redeem-confirm"
  | "help";

export type ScreenData = {
  screen: Screen;
  machine: { machineCode: string; branchName: string | null } | null;
  machineCode: string | null;
  rewards: RewardCard[];
  /** The reward to confirm on the redeem-confirm screen (resolved server-side). */
  reward: RewardCard | null;
};

export function ScreenShell(props: ScreenData) {
  const { phase, error } = useClawhub();

  if (phase === "loading") return <CwLoading label="กำลังเข้าสู่ JOLLY PLAY..." />;
  if (phase === "error") return <CwError message={error ?? "เปิดผ่านแอป LINE เท่านั้น"} />;

  switch (props.screen) {
    case "register":
      return <RegisterScreen />;
    case "refund":
      return <RefundScreen machine={props.machine} machineCode={props.machineCode} />;
    case "points":
      return <PointsScreen />;
    case "rewards":
      return <RewardsScreen rewards={props.rewards} />;
    case "redeem-confirm":
      return props.reward ? (
        <RedeemConfirmScreen reward={props.reward} />
      ) : (
        <RewardsScreen rewards={props.rewards} />
      );
    case "help":
      return <HelpScreen />;
    case "home":
    default:
      return <HomeScreen />;
  }
}
