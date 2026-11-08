import { MessageId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  nextMessagePredictionKey,
  selectVisiblePrediction,
  type PredictionKey,
} from "./nextMessagePrediction.ts";

const threadId = ThreadId.make("thread-1");
const assistantMessageId = MessageId.make("message-1");
const ready = {
  enabled: true,
  threadId,
  latestRun: { status: "completed" as const, assistantMessageId },
  latestRunSettled: true,
  phase: "ready" as const,
  hasPendingApproval: false,
  hasPendingUserInput: false,
};

describe("nextMessagePredictionKey", () => {
  it("keys a settled, completed reply in an idle thread", () => {
    expect(nextMessagePredictionKey(ready)).toEqual({ threadId, assistantMessageId });
  });

  it.each([
    ["the setting is off", { enabled: false }],
    ["the thread is a draft", { threadId: null }],
    ["there is no run yet", { latestRun: null }],
    ["the run was interrupted", { latestRun: { status: "interrupted", assistantMessageId } }],
    ["the run failed", { latestRun: { status: "failed", assistantMessageId } }],
    ["the run is still going", { latestRun: { status: "running", assistantMessageId } }],
    ["the run has no reply", { latestRun: { status: "completed", assistantMessageId: null } }],
    ["the run has not settled", { latestRunSettled: false }],
    ["the agent is working", { phase: "running" }],
    ["the connection is down", { phase: "disconnected" }],
    ["an approval is pending", { hasPendingApproval: true }],
    ["a question is pending", { hasPendingUserInput: true }],
  ] as const)("returns null when %s", (_, override) => {
    expect(nextMessagePredictionKey({ ...ready, ...override })).toBeNull();
  });
});

describe("selectVisiblePrediction", () => {
  const key: PredictionKey = { threadId, assistantMessageId };
  const visible = {
    key,
    result: { key, prediction: "Run the tests" },
    composerEmpty: true,
    dismissedAssistantMessageId: null,
  };

  it("shows the prediction for the current reply in an empty composer", () => {
    expect(selectVisiblePrediction(visible)).toBe("Run the tests");
  });

  it("shows the prediction when an older reply was dismissed", () => {
    expect(
      selectVisiblePrediction({
        ...visible,
        dismissedAssistantMessageId: MessageId.make("older"),
      }),
    ).toBe("Run the tests");
  });

  it.each([
    ["the composer has text", { composerEmpty: false }],
    ["there is no key", { key: null }],
    ["there is no result yet", { result: null }],
    ["the model found nothing open", { result: { key, prediction: null } }],
    [
      "the result belongs to another thread",
      { result: { key: { ...key, threadId: ThreadId.make("thread-2") }, prediction: "x" } },
    ],
    [
      "a newer reply arrived",
      { result: { key: { ...key, assistantMessageId: MessageId.make("old") }, prediction: "x" } },
    ],
    ["this reply was dismissed", { dismissedAssistantMessageId: assistantMessageId }],
  ] as const)("returns null when %s", (_, override) => {
    expect(selectVisiblePrediction({ ...visible, ...override })).toBeNull();
  });
});
