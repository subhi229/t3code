import {
  isDelegatedAppThread,
  type OrchestrationV2PlanArtifact,
  type OrchestrationV2PromptSuggestion,
  type OrchestrationV2TurnItem,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import { latestExecutedRun, runRanAfter } from "@t3tools/shared/orchestrationV2ThreadError";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import {
  resolvePromptSuggestionBehavior,
  resolvePromptSuggestionModelSelection,
} from "@t3tools/shared/promptSuggestionBehaviors";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { formatPredictionContext } from "./predictionContext.ts";

export interface PromptSuggestionSpeedSample {
  readonly medianMs: number | null;
  readonly samples: number;
}

export class CustomPromptSuggestionService extends Context.Service<
  CustomPromptSuggestionService,
  {
    /** The thread's suggestion stream; while subscribed, the thread counts as watched. */
    readonly subscribe: (threadId: ThreadId) => Stream.Stream<OrchestrationV2PromptSuggestion>;
    /** Median duration of recent successful generations. */
    readonly speed: Stream.Stream<PromptSuggestionSpeedSample>;
    /** Generates and publishes for a completed run when the thread qualifies. */
    readonly onRunCompleted: (threadId: ThreadId, runId: RunId) => Effect.Effect<void>;
    /** Runs `onRunCompleted` in the background; a newer run replaces an in-flight one. */
    readonly trigger: (threadId: ThreadId, runId: RunId) => Effect.Effect<void>;
    readonly start: Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/composerPrediction/CustomPromptSuggestionService") {}

const RECENT_RUNS = 8;
const SPEED_SAMPLES = 20;
const TOOL_TURN_ITEM_TYPES = [
  "command_execution",
  "file_change",
  "file_search",
  "web_search",
  "dynamic_tool",
  "subagent",
] as const;
const PLAN_TURN_ITEM_TYPES = ["todo_list", "proposed_plan"] as const;

function activityLabel(item: OrchestrationV2TurnItem): string {
  const detail =
    item.type === "file_change"
      ? item.fileName
      : item.type === "command_execution"
        ? item.input.split("\n")[0]
        : item.type === "file_search"
          ? item.pattern
          : item.type === "web_search"
            ? item.patterns?.join(", ")
            : item.type === "dynamic_tool"
              ? item.toolName
              : undefined;
  return item.title ?? detail ?? item.type;
}

function median(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
  const fileSystem = yield* FileSystem.FileSystem;
  // One empty directory for the service's lifetime keeps project instructions out of every
  // request without registering a new directory with providers on each suggestion.
  const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-suggestion-" });
  const watched = yield* Ref.make<ReadonlyMap<ThreadId, number>>(new Map());
  const durations = yield* SubscriptionRef.make<ReadonlyArray<number>>([]);
  const fibers = yield* FiberMap.make<ThreadId>();

  const isWatched = (threadId: ThreadId) =>
    Ref.get(watched).pipe(Effect.map((current) => (current.get(threadId) ?? 0) > 0));
  const changeWatch = (threadId: ThreadId, delta: number) =>
    Ref.update(watched, (current) => {
      const next = new Map(current);
      const count = (next.get(threadId) ?? 0) + delta;
      if (count > 0) next.set(threadId, count);
      else next.delete(threadId);
      return next;
    });

  /** The suggestion text for the run, or null when the run or thread does not qualify. */
  const generate = Effect.fn("CustomPromptSuggestionService.generate")(function* (
    threadId: ThreadId,
    runId: RunId,
  ) {
    const structure = yield* threads.getThreadRecords(threadId, ["runs", "plans"]);
    const settings = resolveProjectSettings(
      yield* serverSettings.getSettings,
      structure.thread.projectId,
    ).settings;
    if (
      !settings.promptSuggestionsEnabled ||
      settings.promptSuggestionSource !== "model" ||
      isDelegatedAppThread(structure.thread)
    ) {
      return null;
    }
    const runs = structure.runs.filter((run) => run.status !== "rolled_back");
    const latestRun = latestExecutedRun(runs);
    if (latestRun?.id !== runId || latestRun.status !== "completed") return null;

    // Held queues can run out of ordinal order, so recency follows when each run ran.
    const executed = runs
      .filter((run) => run.status !== "queued" && run.startedAt !== null)
      .toSorted((left, right) =>
        runRanAfter(left, right) ? 1 : runRanAfter(right, left) ? -1 : 0,
      );
    const ranks = new Map(executed.map((run, index) => [run.id, index]));
    const rankOf = (id: RunId | null) => (id === null ? -1 : (ranks.get(id) ?? -1));
    const messages = (yield* threads.getThreadRecords(threadId, ["messages"], {
      messageRoles: ["user", "assistant"],
      messageRunIds: executed.slice(-RECENT_RUNS).map((run) => run.id),
    })).messages.toSorted(
      (left, right) =>
        rankOf(left.runId) - rankOf(right.runId) ||
        DateTime.toEpochMillis(left.createdAt) - DateTime.toEpochMillis(right.createdAt) ||
        Number(left.role === "assistant") - Number(right.role === "assistant"),
    );
    const userMessage = messages.find((message) => message.id === latestRun.userMessageId);
    // A provider continuation has no person waiting on the composer.
    if (userMessage?.createdBy === "agent" && userMessage.creationSource === "provider") {
      return null;
    }
    const reply = messages.findLast(
      (message) => message.role === "assistant" && message.runId === runId,
    );
    if (reply === undefined || reply.streaming) return null;

    // Plan ids cannot order replacements within a run, so that run's turn items decide.
    const latestPlan = Effect.fn("CustomPromptSuggestionService.latestPlan")(function* <
      K extends OrchestrationV2PlanArtifact["kind"],
    >(kind: K) {
      const candidates = structure.plans.filter(
        (plan): plan is Extract<OrchestrationV2PlanArtifact, { kind: K }> =>
          plan.kind === kind && plan.status !== "superseded" && rankOf(plan.runId) >= 0,
      );
      const newestRank = Math.max(-1, ...candidates.map((plan) => rankOf(plan.runId)));
      const inRun = candidates.filter((plan) => rankOf(plan.runId) === newestRank);
      if (inRun.length <= 1) return inRun[0] ?? null;
      const items = (yield* threads.getThreadRecords(threadId, ["turnItems"], {
        turnItemRunIds: [inRun[0]!.runId!],
        turnItemTypes: [...PLAN_TURN_ITEM_TYPES],
      })).turnItems.toSorted((left, right) => right.ordinal - left.ordinal);
      for (const item of items) {
        if (item.type !== kind || !("planId" in item)) continue;
        const match = inRun.find((plan) => plan.id === item.planId);
        if (match) return match;
      }
      return inRun.at(-1) ?? null;
    });
    const latestTodoList = yield* latestPlan("todo_list");
    const latestProposedPlan = yield* latestPlan("proposed_plan");
    // Only the newer of the two describes the current work; one run may hold both.
    const todoRank = rankOf(latestTodoList?.runId ?? null);
    const planRank = rankOf(latestProposedPlan?.runId ?? null);
    const turnItems = (yield* threads.getThreadRecords(threadId, ["turnItems"], {
      turnItemRunIds: [runId],
      turnItemTypes: [...TOOL_TURN_ITEM_TYPES],
    })).turnItems
      .toSorted((left, right) => left.ordinal - right.ordinal)
      .map((item) => ({ type: item.type, status: item.status, title: activityLabel(item) }));

    const startedAt = yield* Clock.currentTimeMillis;
    const result = yield* textGeneration.generateNextMessagePrediction({
      cwd,
      context: formatPredictionContext({
        messages,
        todoList: todoRank >= planRank ? latestTodoList : null,
        proposedPlan: planRank >= todoRank ? (latestProposedPlan?.markdown ?? null) : null,
        turnItems,
      }),
      instructions: resolvePromptSuggestionBehavior(settings).instructions,
      modelSelection: resolvePromptSuggestionModelSelection(settings),
    });
    if (result.prediction === null) return null;
    const elapsedMs = (yield* Clock.currentTimeMillis) - startedAt;
    yield* SubscriptionRef.update(durations, (current) =>
      [...current, elapsedMs].slice(-SPEED_SAMPLES),
    );
    return result.prediction;
  });

  const onRunCompleted: CustomPromptSuggestionService["Service"]["onRunCompleted"] = Effect.fn(
    "CustomPromptSuggestionService.onRunCompleted",
  )(function* (threadId, runId) {
    if (!(yield* isWatched(threadId))) return;
    const text = yield* generate(threadId, runId).pipe(
      // Interruption passes through: a newer run replaced this one.
      Effect.catch((cause) => unavailable(cause)),
      Effect.catchDefect((cause) => unavailable(cause)),
    );
    if (text !== null) yield* sessions.publishPromptSuggestion(threadId, { runId, text });
  });

  const unavailable = (cause: unknown) =>
    Effect.logDebug("custom prompt suggestion unavailable", { cause }).pipe(Effect.as(null));

  const trigger: CustomPromptSuggestionService["Service"]["trigger"] = (threadId, runId) =>
    FiberMap.run(fibers, threadId, onRunCompleted(threadId, runId)).pipe(Effect.asVoid);

  /** Reopening a thread: generate for its latest completed run unless one is already shown. */
  const ensureLatest = Effect.fn("CustomPromptSuggestionService.ensureLatest")(function* (
    threadId: ThreadId,
  ) {
    const structure = yield* threads.getThreadRecords(threadId, ["runs"]);
    const latestRun = latestExecutedRun(
      structure.runs.filter((run) => run.status !== "rolled_back"),
    );
    if (latestRun?.status !== "completed") return;
    const current = yield* sessions.subscribePromptSuggestion(threadId).pipe(Stream.runHead);
    if (Option.isSome(current) && current.value?.runId === latestRun.id) return;
    yield* FiberMap.run(fibers, threadId, onRunCompleted(threadId, latestRun.id), {
      onlyIfMissing: true,
    });
  });

  const subscribe: CustomPromptSuggestionService["Service"]["subscribe"] = (threadId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        yield* Effect.acquireRelease(changeWatch(threadId, 1), () => changeWatch(threadId, -1));
        yield* ensureLatest(threadId).pipe(
          Effect.catch((cause) => unavailable(cause)),
          Effect.forkScoped,
        );
        return sessions.subscribePromptSuggestion(threadId);
      }),
    );

  const speed = SubscriptionRef.changes(durations).pipe(
    Stream.map((values) => ({ medianMs: median(values), samples: values.length })),
  );

  const start = forkParked(
    Stream.runForEach(threads.streamDomainEvents, (event) =>
      event.type === "run.updated" && event.payload.status === "completed"
        ? trigger(event.threadId, event.payload.id)
        : Effect.void,
    ),
  );

  return CustomPromptSuggestionService.of({ subscribe, speed, onRunCompleted, trigger, start });
});

export const layer = Layer.effect(CustomPromptSuggestionService, make);
