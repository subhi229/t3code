import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { buildNextMessagePredictionPrompt } from "./textGenerationPrompts.ts";

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
