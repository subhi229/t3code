import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  buildNextMessagePredictionPrompt,
  buildThreadTitlePrompt,
} from "./textGenerationPrompts.ts";
import { normalizeCliError } from "./textGenerationUtils.ts";

describe("normalizeCliError", () => {
  it("does not expose CLI failure details in the public error message", () => {
    const result = normalizeCliError(
      "codex",
      "generateCommitMessage",
      new Error("request failed with access_token=secret-token"),
      "Failed to generate a commit message",
    );

    expect(result.detail).toBe("Failed to generate a commit message");
    expect(result.message).not.toContain("secret-token");
  });
});

describe("buildThreadTitlePrompt", () => {
  it("names the project to leave out and puts the user's instructions above the limits", () => {
    for (const previousTitle of [undefined, "Hyperdrive Config Crash"]) {
      const { prompt } = buildThreadTitlePrompt({
        message: "hyperdrive init crashes without a config",
        previousTitle,
        projectTitle: "Hyperdrive",
        instructions: "Prefix every title with the team name.",
      });
      expect(prompt).toContain('Never include the project name ("Hyperdrive")');
      expect(prompt).not.toContain("fewer than 40 characters");
      expect(prompt).toContain("Title instructions from the user:\nPrefix every title");
    }
    expect(buildThreadTitlePrompt({ message: "Fix login", instructions: " " }).prompt).toContain(
      "3-8 words, fewer than 40 characters.",
    );
  });
});

describe("buildNextMessagePredictionPrompt", () => {
  it("embeds the conversation context and accepts a null prediction", () => {
    const { prompt, outputSchema } = buildNextMessagePredictionPrompt({
      context: "CTX-MARKER",
      instructions: "",
    });
    const decode = Schema.decodeUnknownSync(outputSchema);

    expect(prompt).toContain("CTX-MARKER");
    expect(decode({ prediction: null })).toEqual({ prediction: null });
    expect(decode({ prediction: "x" })).toEqual({ prediction: "x" });
  });
});

describe("buildNextMessagePredictionPrompt focus", () => {
  it("includes the behavior instructions as the user's focus", () => {
    const { prompt } = buildNextMessagePredictionPrompt({
      context: "CTX",
      instructions: "FOCUS-MARKER",
    });

    expect(prompt).toContain("FOCUS-MARKER");
    expect(prompt).toContain("CTX");
  });

  it("leaves the focus section out when there are no instructions", () => {
    const { prompt } = buildNextMessagePredictionPrompt({ context: "CTX", instructions: "  " });

    expect(prompt).not.toContain("User's focus");
  });
});
