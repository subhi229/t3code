import { assert, describe, it, vi } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  DEFAULT_SERVER_SETTINGS,
  EventId,
  MessageId,
  NodeId,
  PlanId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  TextGenerationError,
  ThreadId,
  TurnItemId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2RunStatus,
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
  readonly assistant: string | null;
  readonly assistantStreaming?: boolean;
  readonly status?: OrchestrationV2RunStatus;
  readonly started?: boolean;
  readonly completedMinutesLater?: number;
  readonly extraEvents?: (now: DateTime.Utc) => ReadonlyArray<OrchestrationV2DomainEvent>;
}) {
  return Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    const now = yield* DateTime.now;
    const completedAt = DateTime.add(now, { minutes: input.completedMinutesLater ?? 0 });
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
            status: input.status ?? "completed",
            requestedAt: now,
            startedAt: input.started === false ? null : now,
            completedAt: input.started === false ? null : completedAt,
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
        ...(input.assistant === null
          ? []
          : [message("assistant", input.assistant, input.assistantStreaming ?? false)]),
        ...(input.extraEvents?.(now) ?? []),
      ],
    });
    return MessageId.make(`${input.runId}:assistant`);
  });
}

function turnItem(input: {
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly key: string;
  readonly ordinal: number;
  readonly now: DateTime.Utc;
  readonly fields: object;
}) {
  return {
    id: EventId.make(`${input.runId}:item:${input.key}`),
    type: "turn-item.updated",
    threadId: input.threadId,
    runId: input.runId,
    occurredAt: input.now,
    payload: {
      id: TurnItemId.make(`${input.runId}:item:${input.key}`),
      threadId: input.threadId,
      runId: input.runId,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: input.ordinal,
      status: "completed",
      title: null,
      startedAt: input.now,
      completedAt: input.now,
      updatedAt: input.now,
      ...input.fields,
    },
  } as OrchestrationV2DomainEvent;
}

function proposedPlanEvent(
  threadId: ThreadId,
  runId: RunId,
  id: string,
  markdown: string,
  now: DateTime.Utc,
) {
  return {
    id: EventId.make(`${runId}:plan:${id}`),
    type: "plan.updated",
    threadId,
    runId,
    occurredAt: now,
    payload: {
      id: PlanId.make(id),
      threadId,
      runId,
      nodeId: NodeId.make(`${runId}:node`),
      status: "active",
      kind: "proposed_plan",
      markdown,
    },
  } as OrchestrationV2DomainEvent;
}

function todoPlan(threadId: ThreadId, runId: RunId, id: string, text: string, now: DateTime.Utc) {
  return {
    id: EventId.make(`${runId}:plan:${id}`),
    type: "plan.updated",
    threadId,
    runId,
    occurredAt: now,
    payload: {
      id: PlanId.make(id),
      threadId,
      runId,
      nodeId: NodeId.make(`${runId}:node`),
      status: "active",
      kind: "todo_list",
      steps: [{ id: `${id}:step`, text, status: "pending" }],
    },
  } as OrchestrationV2DomainEvent;
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

  it.effect("predicts after a queued run that was cancelled before it started", () => {
    const harness = makeHarness(predicted);
    return Effect.gen(function* () {
      const service = yield* NextMessagePrediction.NextMessagePredictionService;
      const threadId = yield* createThread("thread:cancelled-queue");
      const latest = yield* recordRun({
        threadId,
        runId: RunId.make("run:cancelled-queue:1"),
        ordinal: 1,
        user: "build it",
        assistant: "Built it.",
      });
      yield* recordRun({
        threadId,
        runId: RunId.make("run:cancelled-queue:2"),
        ordinal: 2,
        user: "queued then cancelled",
        assistant: null,
        status: "cancelled",
        started: false,
      });

      const result = yield* service.predict({ threadId, assistantMessageId: latest });

      assert.deepStrictEqual(result, { prediction: "Run the tests" });
      assert.notInclude(
        harness.generateNextMessagePrediction.mock.calls[0]?.[0].context ?? "",
        "queued then cancelled",
      );
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("uses the todo list the agent updated last within a run", () => {
    const harness = makeHarness(predicted);
    return Effect.gen(function* () {
      const service = yield* NextMessagePrediction.NextMessagePredictionService;
      const threadId = yield* createThread("thread:todo-order");
      const runId = RunId.make("run:todo-order:1");
      const latest = yield* recordRun({
        threadId,
        runId,
        ordinal: 1,
        user: "plan the work",
        assistant: "Updated the checklist.",
        extraEvents: (now) => [
          todoPlan(threadId, runId, "plan:b", "OLD-STEP", now),
          todoPlan(threadId, runId, "plan:a", "NEW-STEP", now),
          turnItem({
            threadId,
            runId,
            key: "todo-old",
            ordinal: 1,
            now,
            fields: { type: "todo_list", planId: PlanId.make("plan:b"), steps: [] },
          }),
          turnItem({
            threadId,
            runId,
            key: "todo-new",
            ordinal: 2,
            now,
            fields: { type: "todo_list", planId: PlanId.make("plan:a"), steps: [] },
          }),
        ],
      });

      yield* service.predict({ threadId, assistantMessageId: latest });

      const context = harness.generateNextMessagePrediction.mock.calls[0]?.[0].context ?? "";
      assert.include(context, "NEW-STEP");
      assert.notInclude(context, "OLD-STEP");
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("describes tool activity that has no title", () => {
    const harness = makeHarness(predicted);
    return Effect.gen(function* () {
      const service = yield* NextMessagePrediction.NextMessagePredictionService;
      const threadId = yield* createThread("thread:activity");
      const runId = RunId.make("run:activity:1");
      const latest = yield* recordRun({
        threadId,
        runId,
        ordinal: 1,
        user: "fix the bug",
        assistant: "Fixed it.",
        extraEvents: (now) => [
          turnItem({
            threadId,
            runId,
            key: "edit",
            ordinal: 1,
            now,
            fields: { type: "file_change", fileName: "src/login.ts" },
          }),
          turnItem({
            threadId,
            runId,
            key: "cmd",
            ordinal: 2,
            now,
            fields: { type: "command_execution", input: "vp test run src/login.test.ts\nmore" },
          }),
        ],
      });

      yield* service.predict({ threadId, assistantMessageId: latest });

      const context = harness.generateNextMessagePrediction.mock.calls[0]?.[0].context ?? "";
      assert.include(context, "file_change (completed): src/login.ts");
      assert.include(context, "command_execution (completed): vp test run src/login.test.ts");
      assert.notInclude(context, "more");
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("orders exchanges by when their runs ran", () => {
    const harness = makeHarness(predicted);
    return Effect.gen(function* () {
      const service = yield* NextMessagePrediction.NextMessagePredictionService;
      const threadId = yield* createThread("thread:held-order");
      const latest = yield* recordRun({
        threadId,
        runId: RunId.make("run:held-order:1"),
        ordinal: 1,
        user: "held request",
        assistant: "HELD-REPLY",
        completedMinutesLater: 5,
      });
      yield* recordRun({
        threadId,
        runId: RunId.make("run:held-order:2"),
        ordinal: 2,
        user: "later request",
        assistant: "EARLIER-REPLY",
      });

      yield* service.predict({ threadId, assistantMessageId: latest });

      const context = harness.generateNextMessagePrediction.mock.calls[0]?.[0].context ?? "";
      assert.isAbove(context.indexOf("HELD-REPLY"), context.indexOf("EARLIER-REPLY"));
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("prefers a newer proposed plan over an older todo list", () => {
    const harness = makeHarness(predicted);
    return Effect.gen(function* () {
      const service = yield* NextMessagePrediction.NextMessagePredictionService;
      const threadId = yield* createThread("thread:plan-recency");
      const first = RunId.make("run:plan-recency:1");
      const second = RunId.make("run:plan-recency:2");
      yield* recordRun({
        threadId,
        runId: first,
        ordinal: 1,
        user: "make a checklist",
        assistant: "Checklist ready.",
        extraEvents: (now) => [todoPlan(threadId, first, "plan:todo", "OLD-STEP", now)],
      });
      const latest = yield* recordRun({
        threadId,
        runId: second,
        ordinal: 2,
        user: "propose a new plan",
        assistant: "Here is the plan.",
        extraEvents: (now) => [
          proposedPlanEvent(threadId, second, "plan:proposed", "NEW-PLAN", now),
        ],
      });

      yield* service.predict({ threadId, assistantMessageId: latest });

      const context = harness.generateNextMessagePrediction.mock.calls[0]?.[0].context ?? "";
      assert.include(context, "NEW-PLAN");
      assert.notInclude(context, "OLD-STEP");
    }).pipe(Effect.provide(harness.layer));
  });
});
