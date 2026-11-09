import type { ServerSettings } from "@t3tools/contracts";

export interface PromptSuggestionBehavior {
  readonly id: string;
  readonly instructions: string;
}

export const DEFAULT_PROMPT_SUGGESTION_BEHAVIOR_ID = "stay-on-track";

export const PROMPT_SUGGESTION_PRESETS = [
  {
    id: "stay-on-track",
    instructions:
      "Keep the user on the goal they set at the start of the thread. If the conversation drifted to side topics, suggest returning to that goal. Never chase side ideas.",
  },
  {
    id: "next-step",
    instructions:
      "The user sometimes loses track of what to do next. Suggest the single concrete next action that continues the work, and add a few words on why it comes next.",
  },
  {
    id: "future-problems",
    instructions:
      "Look for what will cause trouble later: unhandled edge cases, missing error handling, fragile assumptions, and shortcuts that become technical debt. Suggest addressing the most important one.",
  },
  {
    id: "verify",
    instructions:
      "Before the work is called done or committed, suggest verifying it: run the relevant tests, check the diff, or confirm the behavior actually works.",
  },
  {
    id: "tests-first",
    instructions:
      "Prefer test-driven steps: before a change is made, suggest writing a failing test that captures it. After a change, suggest the test that proves it.",
  },
  {
    id: "security",
    instructions:
      "Watch for security risks in the work: untrusted input, injection, secrets in code or logs, authentication and permission checks. Suggest reviewing the most relevant one.",
  },
  {
    id: "understand",
    instructions:
      "The user wants to learn, not just ship. Suggest a question that makes the agent explain why it chose its approach, what the code does, or what the tradeoffs are.",
  },
  {
    id: "ship-small",
    instructions:
      "Keep momentum: suggest the smallest next step that moves the work forward. Avoid polishing or refactoring that was not asked for, and suggest committing working increments.",
  },
] as const satisfies ReadonlyArray<PromptSuggestionBehavior>;

export type PromptSuggestionPresetId = (typeof PROMPT_SUGGESTION_PRESETS)[number]["id"];

export function resolvePromptSuggestionBehavior(
  settings: Pick<ServerSettings, "promptSuggestionBehavior" | "promptSuggestionCustomBehaviors">,
): PromptSuggestionBehavior {
  const id = settings.promptSuggestionBehavior;
  const preset = PROMPT_SUGGESTION_PRESETS.find((behavior) => behavior.id === id);
  if (preset) return preset;
  const custom = settings.promptSuggestionCustomBehaviors.find((behavior) => behavior.id === id);
  if (custom) return { id: custom.id, instructions: custom.instructions };
  return PROMPT_SUGGESTION_PRESETS[0];
}
