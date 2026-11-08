import { WS_METHODS, type MessageId, type ThreadId } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import type { ThreadRunSummary } from "./models.ts";
import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export interface PredictionKey {
  readonly threadId: ThreadId;
  readonly assistantMessageId: MessageId;
}

export function nextMessagePredictionKey(input: {
  readonly enabled: boolean;
  readonly threadId: ThreadId | null;
  readonly latestRun: Pick<ThreadRunSummary, "status" | "assistantMessageId"> | null;
  readonly latestRunSettled: boolean;
  readonly phase: "disconnected" | "connecting" | "ready" | "running";
  readonly hasPendingApproval: boolean;
  readonly hasPendingUserInput: boolean;
}): PredictionKey | null {
  if (
    !input.enabled ||
    input.threadId === null ||
    input.latestRun?.status !== "completed" ||
    input.latestRun.assistantMessageId === null ||
    !input.latestRunSettled ||
    input.phase !== "ready" ||
    input.hasPendingApproval ||
    input.hasPendingUserInput
  ) {
    return null;
  }
  return { threadId: input.threadId, assistantMessageId: input.latestRun.assistantMessageId };
}

export function selectVisiblePrediction(input: {
  readonly key: PredictionKey | null;
  readonly result: { readonly key: PredictionKey; readonly prediction: string | null } | null;
  readonly composerEmpty: boolean;
  readonly dismissedAssistantMessageId: MessageId | null;
}): string | null {
  const { key, result } = input;
  if (
    key === null ||
    result === null ||
    !input.composerEmpty ||
    result.key.threadId !== key.threadId ||
    result.key.assistantMessageId !== key.assistantMessageId ||
    input.dismissedAssistantMessageId === key.assistantMessageId
  ) {
    return null;
  }
  return result.prediction;
}

export function createNextMessagePredictionAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    // A prediction answers one finished reply, so it never needs refreshing.
    prediction: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:composer:next-message-prediction",
      tag: WS_METHODS.composerPredictNextMessage,
      isFinal: () => true,
      idleTtlMs: 10 * 60_000,
    }),
  };
}
