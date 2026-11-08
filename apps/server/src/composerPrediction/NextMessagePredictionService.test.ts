import { assert, describe, it, vi } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  DEFAULT_SERVER_SETTINGS,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  TextGenerationError,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as NextMessagePrediction from "./NextMessagePredictionService.ts";

const projectId = ProjectId.make("project:next-message-prediction");
const workspaceRoot = "/repo";
const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.1-codex",
} as const;

const adapter = {
  instanceId: modelSelection.instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("provider execution is disabled in prediction tests"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

type Generate = TextGeneration.TextGeneration["Service"]["generateNextMessagePrediction"];

function makeHarness(generate: Generate) {
  const layerDatabase = SqlitePersistence.layerMemory;
  const layerOrchestrator = ProviderReplayHarness.layerWithRegistry(
    { name: "next-message-prediction" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  );
  const layerServerSettings = ServerSettings.layerTest({});
  const layerThreadManagement = ThreadManagement.layer.pipe(
    Layer.provide(layerOrchestrator),
    Layer.provide(layerServerSettings),
    Layer.provide(CommandReceiptStore.layer.pipe(Layer.provide(layerDatabase))),
  );
  const generateNextMessagePrediction = vi.fn(generate);
  const layerPrediction = NextMessagePrediction.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        layerThreadManagement,
        Layer.mock(TextGeneration.TextGeneration)({ generateNextMessagePrediction }),
        layerServerSettings,
        NodeServices.layer,
      ),
    ),
  );
  return {
    layer: Layer.mergeAll(layerOrchestrator, layerThreadManagement, layerPrediction, layerDatabase),
    generateNextMessagePrediction,
  };
}

function createThread(name: string) {
  return Effect.gen(function* () {
    const threads = yield* ThreadManagement.ThreadManagementService;
    const threadId = ThreadId.make(name);
    yield* threads.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`${name}:create`),
      threadId,
      projectId,
      title: "Seed title",
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: workspaceRoot,
      createdBy: "user",
      creationSource: "web",
    });
    return threadId;
  });
}

/** Records a settled run with one exchange, as a provider turn would. */
function recordRun(input: {
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly ordinal: number;
  readonly user: string;
  readonly assistant: string;
  readonly assistantStreaming?: boolean;
}) {
  return Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    const now = yield* DateTime.now;
    const providerThreadId = ProviderThreadId.make(`${input.threadId}:provider`);
    const message = (role: "user" | "assistant", text: string, streaming: boolean) => ({
      id: EventId.make(`${input.runId}:${role}`),
      type: "message.updated" as const,
      threadId: input.threadId,
      runId: input.runId,
      occurredAt: now,
      payload: {
        id: MessageId.make(`${input.runId}:${role}`),
        threadId: input.threadId,
        runId: input.runId,
        nodeId: null,
        role,
        text,
        attachments: [],
        streaming,
        createdBy: "user" as const,
        creationSource: "web" as const,
        createdAt: now,
        updatedAt: now,
      },
    });
    yield* eventSink.write({
      events: [
        {
          id: EventId.make(`${input.runId}:created`),
          type: "run.created",
          threadId: input.threadId,
          runId: input.runId,
          occurredAt: now,
          payload: {
            id: input.runId,
            threadId: input.threadId,
            ordinal: input.ordinal,
            providerInstanceId: modelSelection.instanceId,
            modelSelection,
            providerThreadId,
            userMessageId: MessageId.make(`${input.runId}:user`),
            rootNodeId: null,
            activeAttemptId: null,
            status: "completed",
            requestedAt: now,
            startedAt: now,
            completedAt: now,
            checkpointId: null,
            contextHandoffId: null,
          },
        },
        {
          id: EventId.make(`${input.runId}:provider-thread`),
          type: "provider-thread.updated",
          threadId: input.threadId,
          occurredAt: now,
          payload: {
            id: providerThreadId,
            driver: adapter.driver,
            providerInstanceId: modelSelection.instanceId,
            providerSessionId: null,
            appThreadId: input.threadId,
            ownerNodeId: null,
            nativeThreadRef: { driver: adapter.driver, nativeId: "native", strength: "strong" },
            nativeConversationHeadRef: null,
            status: "idle",
            firstRunOrdinal: 1,
            lastRunOrdinal: input.ordinal,
            handoffIds: [],
            forkedFrom: null,
            createdAt: now,
            updatedAt: now,
          },
        },
        message("user", input.user, false),
        message("assistant", input.assistant, input.assistantStreaming ?? false),
      ],
    });
    return MessageId.make(`${input.runId}:assistant`);
  });
}

const predicted: Generate = () => Effect.succeed({ prediction: "Run the tests" });

describe("NextMessagePredictionService", () => {
  it.effect(
    "returns null without calling the model when the id is not the latest finished reply",
    () => {
      const harness = makeHarness(predicted);
      return Effect.gen(function* () {
        const service = yield* NextMessagePrediction.NextMessagePredictionService;
        const threadId = yield* createThread("thread:stale");
        const older = yield* recordRun({
          threadId,
          runId: RunId.make("run:stale:1"),
          ordinal: 1,
          user: "first",
          assistant: "first reply",
        });
        const streaming = yield* recordRun({
          threadId,
          runId: RunId.make("run:stale:2"),
          ordinal: 2,
          user: "second",
          assistant: "partial",
          assistantStreaming: true,
        });

        assert.deepStrictEqual(yield* service.predict({ threadId, assistantMessageId: older }), {
          prediction: null,
        });
        assert.deepStrictEqual(
          yield* service.predict({ threadId, assistantMessageId: streaming }),
          {
            prediction: null,
          },
        );
        assert.strictEqual(harness.generateNextMessagePrediction.mock.calls.length, 0);
      }).pipe(Effect.provide(harness.layer));
    },
  );

  it.effect("returns the model's prediction for the latest reply", () => {
    const harness = makeHarness(predicted);
    return Effect.gen(function* () {
      const service = yield* NextMessagePrediction.NextMessagePredictionService;
      const threadId = yield* createThread("thread:latest");
      const latest = yield* recordRun({
        threadId,
        runId: RunId.make("run:latest:1"),
        ordinal: 1,
        user: "add a settings toggle",
        assistant: "Done. Next I would add tests.",
      });

      const result = yield* service.predict({ threadId, assistantMessageId: latest });

      assert.deepStrictEqual(result, { prediction: "Run the tests" });
      const call = harness.generateNextMessagePrediction.mock.calls[0]?.[0];
      assert.include(call?.context ?? "", "add a settings toggle");
      assert.include(call?.context ?? "", "Next I would add tests.");
      assert.notStrictEqual(call?.cwd, workspaceRoot);
      assert.deepStrictEqual(
        call?.modelSelection,
        DEFAULT_SERVER_SETTINGS.textGenerationModelSelection,
      );
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("caches per assistant message", () => {
    const harness = makeHarness(predicted);
    return Effect.gen(function* () {
      const service = yield* NextMessagePrediction.NextMessagePredictionService;
      const threadId = yield* createThread("thread:cache");
      const latest = yield* recordRun({
        threadId,
        runId: RunId.make("run:cache:1"),
        ordinal: 1,
        user: "hello",
        assistant: "hi",
      });

      yield* service.predict({ threadId, assistantMessageId: latest });
      yield* service.predict({ threadId, assistantMessageId: latest });

      assert.strictEqual(harness.generateNextMessagePrediction.mock.calls.length, 1);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("shares one generation between concurrent calls", () => {
    const harness = makeHarness(predicted);
    return Effect.gen(function* () {
      const service = yield* NextMessagePrediction.NextMessagePredictionService;
      const threadId = yield* createThread("thread:concurrent");
      const latest = yield* recordRun({
        threadId,
        runId: RunId.make("run:concurrent:1"),
        ordinal: 1,
        user: "hello",
        assistant: "hi",
      });
      const input = { threadId, assistantMessageId: latest };

      yield* Effect.all([service.predict(input), service.predict(input)], { concurrency: 2 });

      assert.strictEqual(harness.generateNextMessagePrediction.mock.calls.length, 1);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("does not cache failures", () => {
    let attempts = 0;
    const harness = makeHarness(() => {
      attempts += 1;
      return attempts === 1
        ? Effect.fail(
            new TextGenerationError({ operation: "generateNextMessagePrediction", detail: "down" }),
          )
        : Effect.succeed({ prediction: "Try again" });
    });
    return Effect.gen(function* () {
      const service = yield* NextMessagePrediction.NextMessagePredictionService;
      const threadId = yield* createThread("thread:failure");
      const latest = yield* recordRun({
        threadId,
        runId: RunId.make("run:failure:1"),
        ordinal: 1,
        user: "hello",
        assistant: "hi",
      });
      const input = { threadId, assistantMessageId: latest };

      assert.deepStrictEqual(yield* service.predict(input), { prediction: null });
      assert.deepStrictEqual(yield* service.predict(input), { prediction: "Try again" });
      assert.strictEqual(harness.generateNextMessagePrediction.mock.calls.length, 2);
    }).pipe(Effect.provide(harness.layer));
  });
});
