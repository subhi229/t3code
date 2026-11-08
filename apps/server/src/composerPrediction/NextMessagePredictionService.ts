import type { MessageId, RunId, ThreadId } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
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
const TOOL_TURN_ITEM_TYPES = [
  "command_execution",
  "file_change",
  "file_search",
  "web_search",
  "dynamic_tool",
  "subagent",
] as const;

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const fileSystem = yield* FileSystem.FileSystem;

  const generate = Effect.fn("NextMessagePredictionService.generate")(function* (
    input: NextMessagePredictionInput,
  ) {
    const records = yield* threads.getThreadRecords(input.threadId, ["messages", "runs", "plans"], {
      messageRoles: ["user", "assistant"],
    });
    const runs = new Map(
      records.runs.filter((run) => run.status !== "rolled_back").map((run) => [run.id, run]),
    );
    const ordinalOf = (runId: RunId | null) =>
      runId === null ? -1 : (runs.get(runId)?.ordinal ?? -1);
    const messages = records.messages
      .filter((message) => message.runId === null || runs.has(message.runId))
      .toSorted(
        (left, right) =>
          ordinalOf(left.runId) - ordinalOf(right.runId) ||
          DateTime.toEpochMillis(left.createdAt) - DateTime.toEpochMillis(right.createdAt) ||
          Number(left.role === "assistant") - Number(right.role === "assistant"),
      );
    const latestRun = [...runs.values()].reduce<(typeof records.runs)[number] | undefined>(
      (latest, run) => (latest === undefined || run.ordinal > latest.ordinal ? run : latest),
      undefined,
    );
    const latest = messages.findLast(
      (message) => message.role === "assistant" && message.runId === latestRun?.id,
    );
    // Not ready yet or superseded: report it uncached so a later request can still predict.
    if (
      latestRun?.status !== "completed" ||
      latest === undefined ||
      latest.id !== input.assistantMessageId ||
      latest.streaming
    ) {
      return yield* new NotLatestReply();
    }

    let todoList: (typeof records.plans)[number] | undefined;
    let todoOrdinal = -1;
    for (const plan of records.plans) {
      const ordinal = plan.runId === null ? undefined : runs.get(plan.runId)?.ordinal;
      if (
        plan.kind === "todo_list" &&
        plan.status !== "superseded" &&
        ordinal !== undefined &&
        ordinal >= todoOrdinal
      ) {
        todoList = plan;
        todoOrdinal = ordinal;
      }
    }
    const turnItems =
      latest.runId === null
        ? []
        : (yield* threads.getThreadRecords(input.threadId, ["turnItems"], {
            turnItemRunIds: [latest.runId],
            turnItemTypes: [...TOOL_TURN_ITEM_TYPES],
          })).turnItems
            .toSorted((left, right) => left.ordinal - right.ordinal)
            .map((item) => ({
              type: item.type,
              status: item.status,
              title: item.title ?? item.type,
            }));

    const context = formatPredictionContext({
      messages,
      todoList: todoList?.kind === "todo_list" ? todoList : null,
      turnItems,
    });
    const settings = resolveProjectSettings(
      yield* serverSettings.getSettings,
      records.thread.projectId,
    ).settings;
    // An empty directory keeps project instructions and tools out of a plain text request.
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-prediction-" });
        return yield* textGeneration.generateNextMessagePrediction({
          cwd,
          context,
          modelSelection: settings.textGenerationModelSelection,
        });
      }),
    );
  });

  const cache = yield* Cache.make({
    capacity: 256,
    timeToLive: "6 hours",
    lookup: (key: string) => {
      const [threadId, assistantMessageId] = key.split(KEY_SEPARATOR) as [ThreadId, MessageId];
      return generate({ threadId, assistantMessageId });
    },
  });

  const predict: NextMessagePredictionService["Service"]["predict"] = Effect.fn(
    "NextMessagePredictionService.predict",
  )(function* (input) {
    const key = `${input.threadId}${KEY_SEPARATOR}${input.assistantMessageId}`;
    return yield* Cache.get(cache, key).pipe(
      Effect.catchCause((cause) =>
        Cache.invalidate(cache, key).pipe(
          Effect.andThen(Effect.logDebug("next-message prediction unavailable", cause)),
          Effect.as(NO_PREDICTION),
        ),
      ),
    );
  });

  return NextMessagePredictionService.of({ predict });
});

export const layer = Layer.effect(NextMessagePredictionService, make);
