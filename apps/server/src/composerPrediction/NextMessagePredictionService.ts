import type {
  MessageId,
  OrchestrationV2PlanArtifact,
  OrchestrationV2TurnItem,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { latestExecutedRun, runRanAfter } from "@t3tools/shared/orchestrationV2ThreadError";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { formatPredictionContext } from "./predictionContext.ts";

export interface NextMessagePredictionInput {
  readonly threadId: ThreadId;
  readonly assistantMessageId: MessageId;
}

export interface NextMessagePredictionResult {
  readonly prediction: string | null;
}

export class NextMessagePredictionService extends Context.Service<
  NextMessagePredictionService,
  {
    readonly predict: (
      input: NextMessagePredictionInput,
    ) => Effect.Effect<NextMessagePredictionResult>;
  }
>()("t3/composerPrediction/NextMessagePredictionService") {}

class NotLatestReply extends Schema.TaggedError<NotLatestReply>()("NotLatestReply", {}) {}

const KEY_SEPARATOR = "\u0000";
const NO_PREDICTION: NextMessagePredictionResult = { prediction: null };
const RECENT_RUNS = 8;
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

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const fileSystem = yield* FileSystem.FileSystem;
  // One empty directory for the service's lifetime keeps project instructions out of every
  // request without registering a new directory with providers on each prediction.
  const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-prediction-" });

  const generate = Effect.fn("NextMessagePredictionService.generate")(function* (
    input: NextMessagePredictionInput,
  ) {
    const structure = yield* threads.getThreadRecords(input.threadId, ["runs", "plans"]);
    const runs = structure.runs.filter((run) => run.status !== "rolled_back");
    const latestRun = latestExecutedRun(runs);
    // Not ready yet or superseded: report it uncached so a later request can still predict.
    if (latestRun?.status !== "completed") return yield* new NotLatestReply();

    // Held queues can run out of ordinal order, so recency follows when each run ran.
    const executed = runs
      .filter((run) => run.status !== "queued" && run.startedAt !== null)
      .toSorted((left, right) =>
        runRanAfter(left, right) ? 1 : runRanAfter(right, left) ? -1 : 0,
      );
    const ranks = new Map(executed.map((run, index) => [run.id, index]));
    const recentRunIds = executed.slice(-RECENT_RUNS).map((run) => run.id);
    const rankOf = (runId: RunId | null) => (runId === null ? -1 : (ranks.get(runId) ?? -1));
    const messages = (yield* threads.getThreadRecords(input.threadId, ["messages"], {
      messageRoles: ["user", "assistant"],
      messageRunIds: recentRunIds,
    })).messages.toSorted(
      (left, right) =>
        rankOf(left.runId) - rankOf(right.runId) ||
        DateTime.toEpochMillis(left.createdAt) - DateTime.toEpochMillis(right.createdAt) ||
        Number(left.role === "assistant") - Number(right.role === "assistant"),
    );
    const latest = messages.findLast(
      (message) => message.role === "assistant" && message.runId === latestRun.id,
    );
    if (latest === undefined || latest.id !== input.assistantMessageId || latest.streaming) {
      return yield* new NotLatestReply();
    }

    // The newest plan of a kind lives in the latest run that has one; plan ids cannot order
    // replacements within a run, so the run's turn items decide.
    const latestPlan = Effect.fn("NextMessagePredictionService.latestPlan")(function* <
      K extends OrchestrationV2PlanArtifact["kind"],
    >(kind: K) {
      const candidates = structure.plans.filter(
        (plan): plan is Extract<OrchestrationV2PlanArtifact, { kind: K }> =>
          plan.kind === kind && plan.status !== "superseded" && rankOf(plan.runId) >= 0,
      );
      const newestOrdinal = Math.max(-1, ...candidates.map((plan) => rankOf(plan.runId)));
      const inRun = candidates.filter((plan) => rankOf(plan.runId) === newestOrdinal);
      if (inRun.length <= 1) return inRun[0] ?? null;
      const items = (yield* threads.getThreadRecords(input.threadId, ["turnItems"], {
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
    const todoList = todoRank >= planRank ? latestTodoList : null;
    const proposedPlan = planRank >= todoRank ? latestProposedPlan : null;
    const turnItems = (yield* threads.getThreadRecords(input.threadId, ["turnItems"], {
      turnItemRunIds: [latestRun.id],
      turnItemTypes: [...TOOL_TURN_ITEM_TYPES],
    })).turnItems
      .toSorted((left, right) => left.ordinal - right.ordinal)
      .map((item) => ({ type: item.type, status: item.status, title: activityLabel(item) }));

    const context = formatPredictionContext({
      messages,
      todoList,
      proposedPlan: proposedPlan?.markdown ?? null,
      turnItems,
    });
    const settings = resolveProjectSettings(
      yield* serverSettings.getSettings,
      structure.thread.projectId,
    ).settings;
    return yield* textGeneration.generateNextMessagePrediction({
      cwd,
      context,
      modelSelection: settings.textGenerationModelSelection,
    });
  });

  const cache = yield* Cache.makeWith(
    (key: string) => {
      const [threadId, assistantMessageId] = key.split(KEY_SEPARATOR) as [ThreadId, MessageId];
      return generate({ threadId, assistantMessageId });
    },
    {
      capacity: 256,
      // Failures expire at once so the next request retries instead of reusing them.
      timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.hours(6) : Duration.zero),
    },
  );

  const unavailable = (reason: unknown) =>
    Effect.logDebug("next-message prediction unavailable", reason).pipe(Effect.as(NO_PREDICTION));

  const predict: NextMessagePredictionService["Service"]["predict"] = Effect.fn(
    "NextMessagePredictionService.predict",
  )(function* (input) {
    return yield* Cache.get(
      cache,
      `${input.threadId}${KEY_SEPARATOR}${input.assistantMessageId}`,
    ).pipe(
      // Interruption passes through: an abandoned request must not end a shared lookup.
      Effect.catch((error) => unavailable(error)),
      Effect.catchDefect((defect) => unavailable(defect)),
    );
  });

  return NextMessagePredictionService.of({ predict });
});

export const layer = Layer.effect(NextMessagePredictionService, make);
