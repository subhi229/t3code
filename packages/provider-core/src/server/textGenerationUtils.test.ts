import { describe, expect, it } from "vite-plus/test";

import {
  limitSection,
  MAX_NEXT_MESSAGE_PREDICTION_CHARS,
  sanitizeCommitSubject,
  sanitizeNextMessagePrediction,
  sanitizeThreadTitle,
} from "./textGenerationUtils.ts";

describe("limitSection", () => {
  it("cuts a long section without splitting an emoji", () => {
    expect(limitSection(`${"a".repeat(9)}🚀 more`, 10)).toBe(`${"a".repeat(9)}\n\n[truncated]`);
  });
});

describe("sanitizeCommitSubject", () => {
  // regression: #19181 truncation split grapheme clusters at the subject limit
  it.each([
    { name: "an emoji", prefixLength: 71, character: "🚀" },
    { name: "an accented character", prefixLength: 71, character: "e\u0301" },
    { name: "a joined emoji", prefixLength: 65, character: "👨‍👩‍👧‍👦" },
  ])("keeps $name intact at the subject limit", ({ prefixLength, character }) => {
    const prefix = "a".repeat(prefixLength);

    expect(sanitizeCommitSubject(`${prefix}${character} more`)).toBe(prefix);
  });
});

describe("sanitizeThreadTitle", () => {
  it.each([
    { name: "a split surrogate pair", prefixLength: 116, character: "🚀", retained: "" },
    { name: "a complete surrogate pair", prefixLength: 115, character: "🚀", retained: "🚀" },
    { name: "a BMP character", prefixLength: 116, character: "界", retained: "界" },
  ])("truncates without splitting $name", ({ prefixLength, character, retained }) => {
    const prefix = "a".repeat(prefixLength);
    const title = `${prefix}${character} more`;

    expect(sanitizeThreadTitle(title)).toBe(`${prefix}${retained}...`);
  });
});

describe("sanitizeNextMessagePrediction", () => {
  it.each([
    [null, null],
    ["", null],
    ["   ", null],
    ['"Run the tests and show me failures"', "Run the tests and show me failures"],
    ["User: commit this", "commit this"],
    ["Prediction: commit this", "commit this"],
    ["next message: commit this", "commit this"],
    ["line one\nline two", "line one line two"],
    ["`ship it`", "ship it"],
    ["Run the tests in `src/auth.ts`", "Run the tests in `src/auth.ts`"],
    ['Rename the label to "Show predictions"', 'Rename the label to "Show predictions"'],
    ['User: "commit this"', "commit this"],
    ['"yes" for staging, then "no"', '"yes" for staging, then "no"'],
  ])("sanitizeNextMessagePrediction(%j) -> %j", (raw, expected) => {
    expect(sanitizeNextMessagePrediction(raw)).toBe(expected);
  });

  it("caps predictions at a word boundary", () => {
    const out = sanitizeNextMessagePrediction("word ".repeat(100));
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(MAX_NEXT_MESSAGE_PREDICTION_CHARS);
    expect(out!.endsWith("word")).toBe(true);
  });
});
