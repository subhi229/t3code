import type { PromptSuggestionCustomBehavior } from "@t3tools/contracts";
import {
  PROMPT_SUGGESTION_PRESETS,
  resolvePromptSuggestionBehavior,
} from "@t3tools/shared/promptSuggestionBehaviors";

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
): ReadonlyArray<PromptSuggestionBehaviorOption> {
  const selected = resolvePromptSuggestionBehavior({
    promptSuggestionBehavior: selectedId,
    promptSuggestionCustomBehaviors: custom,
  }).id;
  return [
    ...PROMPT_SUGGESTION_PRESETS.map((preset) => ({
      id: preset.id,
      name: preset.name,
      description: preset.description,
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
