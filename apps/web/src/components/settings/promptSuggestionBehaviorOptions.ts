import type { PromptSuggestionCustomBehavior } from "@t3tools/contracts";
import {
  PROMPT_SUGGESTION_PRESETS,
  type PromptSuggestionPresetId,
  resolvePromptSuggestionBehavior,
} from "@t3tools/shared/promptSuggestionBehaviors";
import { msg } from "gt-react";

import { m, type MessageResolver } from "~/i18n/messages";

const PRESET_COPY: Readonly<
  Record<PromptSuggestionPresetId, { readonly name: string; readonly description: string }>
> = {
  "stay-on-track": {
    name: msg("Stay on track"),
    description: msg("Keeps you on the goal you set and steers back when the thread drifts."),
  },
  "next-step": {
    name: msg("Show me the next step"),
    description: msg("The single concrete next action, with a few words of why."),
  },
  "future-problems": {
    name: msg("Head off future problems"),
    description: msg("Edge cases, error handling and things likely to break later."),
  },
  verify: {
    name: msg("Verify before moving on"),
    description: msg("Run the tests and check the diff before calling it done or committing."),
  },
  "tests-first": {
    name: msg("Tests first"),
    description: msg("Ask for a failing test before the change."),
  },
  security: {
    name: msg("Security check"),
    description: msg("Inputs, secrets, auth and permissions."),
  },
  understand: {
    name: msg("Help me understand"),
    description: msg("Questions that make the agent explain its choices."),
  },
  "ship-small": {
    name: msg("Ship small"),
    description: msg("The smallest next step, no polish, commit often."),
  },
};

export interface PromptSuggestionBehaviorOption {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly custom: boolean;
  readonly selected: boolean;
}

export function promptSuggestionBehaviorOptions(
  custom: ReadonlyArray<PromptSuggestionCustomBehavior>,
  selectedId: string,
  resolve: MessageResolver = m,
): ReadonlyArray<PromptSuggestionBehaviorOption> {
  const selected = resolvePromptSuggestionBehavior({
    promptSuggestionBehavior: selectedId,
    promptSuggestionCustomBehaviors: custom,
  }).id;
  return [
    ...PROMPT_SUGGESTION_PRESETS.map((preset) => ({
      id: preset.id,
      name: resolve(PRESET_COPY[preset.id].name),
      description: resolve(PRESET_COPY[preset.id].description),
      custom: false,
      selected: preset.id === selected,
    })),
    ...custom.map((behavior) => ({
      id: behavior.id,
      name: behavior.name,
      description: behavior.instructions,
      custom: true,
      selected: behavior.id === selected,
    })),
  ];
}
