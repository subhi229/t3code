import { DEFAULT_SERVER_SETTINGS, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { createModelSelection } from "./model.ts";
import {
  DEFAULT_PROMPT_SUGGESTION_BEHAVIOR_ID,
  PROMPT_SUGGESTION_PRESETS,
  resolvePromptSuggestionBehavior,
  resolvePromptSuggestionModelSelection,
} from "./promptSuggestionBehaviors.ts";

const custom = { id: "custom-1", name: "Mine", instructions: "Suggest docs updates." };

describe("resolvePromptSuggestionBehavior", () => {
  it("resolves a preset by id", () => {
    expect(
      resolvePromptSuggestionBehavior({
        promptSuggestionBehavior: "security",
        promptSuggestionCustomBehaviors: [],
      }).name,
    ).toBe("Security check");
  });

  it("resolves a custom behavior by id", () => {
    expect(
      resolvePromptSuggestionBehavior({
        promptSuggestionBehavior: "custom-1",
        promptSuggestionCustomBehaviors: [custom],
      }),
    ).toMatchObject({ id: "custom-1", name: "Mine", instructions: "Suggest docs updates." });
  });

  it("falls back to stay-on-track for an unknown id", () => {
    expect(
      resolvePromptSuggestionBehavior({
        promptSuggestionBehavior: "custom-deleted",
        promptSuggestionCustomBehaviors: [custom],
      }).id,
    ).toBe("stay-on-track");
  });

  it("presets have unique ids and the default exists", () => {
    const ids = PROMPT_SUGGESTION_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "stay-on-track",
      "next-step",
      "future-problems",
      "verify",
      "tests-first",
      "security",
      "understand",
      "ship-small",
    ]);
    expect(ids).toContain(DEFAULT_PROMPT_SUGGESTION_BEHAVIOR_ID);
    expect(DEFAULT_SERVER_SETTINGS.promptSuggestionBehavior).toBe(
      DEFAULT_PROMPT_SUGGESTION_BEHAVIOR_ID,
    );
  });
});

describe("resolvePromptSuggestionModelSelection", () => {
  it("model selection follows the text generation model when null", () => {
    expect(
      resolvePromptSuggestionModelSelection({
        ...DEFAULT_SERVER_SETTINGS,
        promptSuggestionModelSelection: null,
      }),
    ).toEqual(DEFAULT_SERVER_SETTINGS.textGenerationModelSelection);
  });

  it("uses its own model selection when set", () => {
    const own = createModelSelection(ProviderInstanceId.make("claudeAgent"), "claude-haiku-5-5");
    expect(
      resolvePromptSuggestionModelSelection({
        ...DEFAULT_SERVER_SETTINGS,
        promptSuggestionModelSelection: own,
      }),
    ).toEqual(own);
  });
});
