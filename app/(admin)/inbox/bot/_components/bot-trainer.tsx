"use client";

// Tab shell for the bot training page. WAI-ARIA tablist (role=tablist/tab/
// tabpanel + roving tabIndex + Arrow/Home/End) per the Pool tab convention.

import { useRef, useState } from "react";
import {
  MessageSquareText,
  BookOpen,
  Settings2,
  HelpCircle,
  Image as ImageIcon,
} from "lucide-react";
import { FaqManager, type Faq } from "./faq-manager";
import { KnowledgeManager, type Knowledge } from "./knowledge-manager";
import { BotSettingsForm, type BotSettings } from "./bot-settings-form";
import { UnansweredQueue, type Unanswered } from "./unanswered-queue";
import { FlowImagesManager, type FlowImages } from "./flow-images-manager";

type TabKey = "faq" | "knowledge" | "settings" | "flowImages" | "unanswered";

const TABS: { key: TabKey; label: string; icon: typeof MessageSquareText }[] = [
  { key: "faq", label: "คลังคำตอบ", icon: MessageSquareText },
  { key: "knowledge", label: "ข้อมูลร้าน", icon: BookOpen },
  { key: "settings", label: "ตั้งค่าบอท", icon: Settings2 },
  { key: "flowImages", label: "รูปประกอบบอท", icon: ImageIcon },
  { key: "unanswered", label: "ตอบไม่ได้", icon: HelpCircle },
];

export function BotTrainer({
  businessTag,
  initialFaqs,
  initialKnowledge,
  initialSettings,
  initialFlowImages,
  initialUnanswered,
}: {
  businessTag: string;
  initialFaqs: Faq[];
  initialKnowledge: Knowledge[];
  initialSettings: BotSettings;
  initialFlowImages: FlowImages;
  initialUnanswered: Unanswered[];
}) {
  const [active, setActive] = useState<TabKey>("faq");
  const [unansweredCount, setUnansweredCount] = useState(initialUnanswered.length);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    else return;
    e.preventDefault();
    setActive(TABS[next].key);
    tabRefs.current[next]?.focus();
  }

  return (
    <div>
      {/* Tablist */}
      <div
        role="tablist"
        aria-label="ฝึกบอท"
        className="flex items-center gap-1 border-b border-zinc-200 mb-5 overflow-x-auto"
      >
        {TABS.map((t, i) => {
          const selected = active === t.key;
          const Icon = t.icon;
          const showBadge = t.key === "unanswered" && unansweredCount > 0;
          return (
            <button
              key={t.key}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              role="tab"
              id={`bot-tab-${t.key}`}
              aria-selected={selected}
              aria-controls={`bot-panel-${t.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(t.key)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`inline-flex items-center gap-1.5 px-4 h-11 text-sm font-bold whitespace-nowrap border-b-2 -mb-px transition-colors ${
                selected
                  ? "border-[var(--color-brand-600)] text-[var(--color-brand-700)]"
                  : "border-transparent text-zinc-500 hover:text-zinc-800"
              }`}
            >
              <Icon className="size-4" />
              {t.label}
              {showBadge && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold tabular-nums">
                  {unansweredCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Panels */}
      <div
        role="tabpanel"
        id="bot-panel-faq"
        aria-labelledby="bot-tab-faq"
        hidden={active !== "faq"}
      >
        {active === "faq" && (
          <FaqManager businessTag={businessTag} initialFaqs={initialFaqs} />
        )}
      </div>
      <div
        role="tabpanel"
        id="bot-panel-knowledge"
        aria-labelledby="bot-tab-knowledge"
        hidden={active !== "knowledge"}
      >
        {active === "knowledge" && (
          <KnowledgeManager businessTag={businessTag} initialKnowledge={initialKnowledge} />
        )}
      </div>
      <div
        role="tabpanel"
        id="bot-panel-settings"
        aria-labelledby="bot-tab-settings"
        hidden={active !== "settings"}
      >
        {active === "settings" && (
          <BotSettingsForm businessTag={businessTag} initialSettings={initialSettings} />
        )}
      </div>
      <div
        role="tabpanel"
        id="bot-panel-flowImages"
        aria-labelledby="bot-tab-flowImages"
        hidden={active !== "flowImages"}
      >
        {active === "flowImages" && (
          <FlowImagesManager
            businessTag={businessTag}
            initialImages={initialFlowImages}
          />
        )}
      </div>
      <div
        role="tabpanel"
        id="bot-panel-unanswered"
        aria-labelledby="bot-tab-unanswered"
        hidden={active !== "unanswered"}
      >
        {active === "unanswered" && (
          <UnansweredQueue
            businessTag={businessTag}
            initialUnanswered={initialUnanswered}
            onCountChange={setUnansweredCount}
          />
        )}
      </div>
    </div>
  );
}
