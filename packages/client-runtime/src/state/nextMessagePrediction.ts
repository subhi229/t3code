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

/** `prediction` must come from the query for `key`; the atom family keeps threads apart. */
export function selectVisiblePrediction(input: {
  readonly key: PredictionKey | null;
  readonly prediction: string | null | undefined;
  readonly composerEmpty: boolean;
  /** Replies whose prediction the user hid; each stays hidden until a newer reply. */
  readonly dismissed: ReadonlySet<MessageId>;
}): string | null {
  if (
    input.key === null ||
    !input.composerEmpty ||
    input.dismissed.has(input.key.assistantMessageId)
  ) {
    return null;
  }
  return input.prediction ?? null;
}

export function createNextMessagePredictionAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    // A prediction answers one finished reply, so it never goes stale.
    prediction: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:composer:next-message-prediction",
      tag: WS_METHODS.composerPredictNextMessage,
      staleTimeMs: Number.POSITIVE_INFINITY,
      idleTtlMs: 10 * 60_000,
    }),
  };
}
