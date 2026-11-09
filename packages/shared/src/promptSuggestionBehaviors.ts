import type { ServerSettings } from "@t3tools/contracts";

export interface PromptSuggestionBehavior {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
}

export const DEFAULT_PROMPT_SUGGESTION_BEHAVIOR_ID = "stay-on-track";

export const PROMPT_SUGGESTION_PRESETS: ReadonlyArray<PromptSuggestionBehavior> = [
  {
    id: "stay-on-track",
    name: "Stay on track",
    description: "Keeps you on the goal you set and steers back when the thread drifts.",
    instructions:
      "Keep the user on the goal they set at the start of the thread. If the conversation drifted to side topics, suggest returning to that goal. Never chase side ideas.",
  },
  {
    id: "next-step",
    name: "Show me the next step",
    description: "The single concrete next action, with a few words of why.",
    instructions:
      "The user sometimes loses track of what to do next. Suggest the single concrete next action that continues the work, and add a few words on why it comes next.",
  },
  {
    id: "future-problems",
    name: "Head off future problems",
    description: "Edge cases, error handling and things likely to break later.",
    instructions:
      "Look for what will cause trouble later: unhandled edge cases, missing error handling, fragile assumptions, and shortcuts that become technical debt. Suggest addressing the most important one.",
  },
  {
    id: "verify",
    name: "Verify before moving on",
    description: "Run the tests and check the diff before calling it done or committing.",
    instructions:
      "Before the work is called done or committed, suggest verifying it: run the relevant tests, check the diff, or confirm the behavior actually works.",
  },
  {
    id: "tests-first",
    name: "Tests first",
    description: "Ask for a failing test before the change.",
    instructions:
      "Prefer test-driven steps: before a change is made, suggest writing a failing test that captures it. After a change, suggest the test that proves it.",
  },
  {
    id: "security",
    name: "Security check",
    description: "Inputs, secrets, auth and permissions.",
    instructions:
      "Watch for security risks in the work: untrusted input, injection, secrets in code or logs, authentication and permission checks. Suggest reviewing the most relevant one.",
  },
  {
    id: "understand",
    name: "Help me understand",
    description: "Questions that make the agent explain its choices.",
    instructions:
      "The user wants to learn, not just ship. Suggest a question that makes the agent explain why it chose its approach, what the code does, or what the tradeoffs are.",
  },
  {
    id: "ship-small",
    name: "Ship small",
    description: "The smallest next step, no polish, commit often.",
    instructions:
      "Keep momentum: suggest the smallest next step that moves the work forward. Avoid polishing or refactoring that was not asked for, and suggest committing working increments.",
  },
];

export function resolvePromptSuggestionBehavior(
  settings: Pick<ServerSettings, "promptSuggestionBehavior" | "promptSuggestionCustomBehaviors">,
): PromptSuggestionBehavior {
  const id = settings.promptSuggestionBehavior;
  const preset = PROMPT_SUGGESTION_PRESETS.find((behavior) => behavior.id === id);
  if (preset) return preset;
  const custom = settings.promptSuggestionCustomBehaviors.find((behavior) => behavior.id === id);
  if (custom) return { ...custom, description: "" };
  return PROMPT_SUGGESTION_PRESETS[0]!;
}
