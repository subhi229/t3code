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
    const { prompt, outputSchema } = buildNextMessagePredictionPrompt({ context: "CTX-MARKER" });
    const decode = Schema.decodeUnknownSync(outputSchema);

    expect(prompt).toContain("CTX-MARKER");
    expect(decode({ prediction: null })).toEqual({ prediction: null });
    expect(decode({ prediction: "x" })).toEqual({ prediction: "x" });
  });
});
