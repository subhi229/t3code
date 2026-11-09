import { assert, describe, it, vi } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
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
  EnvironmentId,
  type OrchestrationV2DelegatedFrom,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2PromptSuggestion,
  type OrchestrationV2RunStatus,
} from "@t3tools/contracts";
import { PROMPT_SUGGESTION_PRESETS } from "@t3tools/shared/promptSuggestionBehaviors";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as CustomPromptSuggestions from "./CustomPromptSuggestionService.ts";
import * as Fiber from "effect/Fiber";

const projectId = ProjectId.make("project:custom-prompt-suggestion");
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
  openSession: () => Effect.die("provider execution is disabled in suggestion tests"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

type Generate = TextGeneration.TextGeneration["Service"]["generateNextMessagePrediction"];
type Published = { readonly threadId: ThreadId; readonly runId: RunId; readonly text: string };

class PublishedSuggestions extends Context.Service<PublishedSuggestions, Queue.Queue<Published>>()(
  "t3/composerPrediction/CustomPromptSuggestionService.test/PublishedSuggestions",
) {}

const enabledSettings = {
  promptSuggestionsEnabled: true,
  promptSuggestionSource: "model" as const,
};

function makeHarness(
  generate: Generate,
  settings: Parameters<typeof ServerSettings.layerTest>[0] = enabledSettings,
) {
  const layerDatabase = SqlitePersistence.layerMemory;
  const layerOrchestrator = ProviderReplayHarness.layerWithRegistry(
    { name: "custom-prompt-suggestion" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  );
  const layerServerSettings = ServerSettings.layerTest(settings);
  const layerThreadManagement = ThreadManagement.layer.pipe(
    Layer.provide(layerOrchestrator),
    Layer.provide(layerServerSettings),
    Layer.provide(CommandReceiptStore.layer.pipe(Layer.provide(layerDatabase))),
  );
  const generateNextMessagePrediction = vi.fn(generate);
  const layerPublished = Layer.effect(PublishedSuggestions, Queue.unbounded<Published>());
  const layerSessions = Layer.effect(
    ProviderSessionManager.ProviderSessionManagerV2,
    Effect.map(
      PublishedSuggestions,
      (published) =>
        ({
          publishPromptSuggestion: (
            threadId: ThreadId,
            suggestion: { runId: RunId; text: string },
          ) => Queue.offer(published, { threadId, ...suggestion }).pipe(Effect.asVoid),
          subscribePromptSuggestion: () =>
            Stream.concat(Stream.succeed<OrchestrationV2PromptSuggestion>(null), Stream.never),
        }) as unknown as ProviderSessionManager.ProviderSessionManagerV2["Service"],
    ),
  ).pipe(Layer.provideMerge(layerPublished));
  const layerSuggestions = CustomPromptSuggestions.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        layerThreadManagement,
        Layer.mock(TextGeneration.TextGeneration)({ generateNextMessagePrediction }),
        layerServerSettings,
        layerSessions,
        NodeServices.layer,
      ),
    ),
  );
  return {
    layer: Layer.mergeAll(
      layerOrchestrator,
      layerThreadManagement,
      layerSuggestions.pipe(Layer.provideMerge(layerSessions)),
      layerServerSettings,
      layerDatabase,
    ),
    generateNextMessagePrediction,
  };
}

/** Subscribes like a client would, so the thread counts as watched. */
function watch(threadId: ThreadId) {
  return Effect.gen(function* () {
    const service = yield* CustomPromptSuggestions.CustomPromptSuggestionService;
    const first = yield* Deferred.make<void>();
    yield* service.subscribe(threadId).pipe(
      Stream.runForEach(() => Deferred.succeed(first, undefined)),
      Effect.forkScoped,
    );
    yield* Deferred.await(first);
  });
}

function createThread(
  name: string,
  extra: { readonly delegatedFrom?: OrchestrationV2DelegatedFrom } = {},
) {
  return Effect.gen(function* () {
    const threads = yield* ThreadManagement.ThreadManagementService;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = ThreadId.make(name);
    // Only server-stamped link work may name a remote parent, so delegated threads skip the client path.
    const dispatch = extra.delegatedFrom === undefined ? threads.dispatch : orchestrator.dispatch;
    yield* dispatch({
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
      ...(extra.delegatedFrom === undefined
        ? {}
        : {
            delegatedFrom: extra.delegatedFrom,
            linkOrigin: { sessionId: "link-session", label: "Linked environment" },
          }),
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
  readonly userCreatedBy?: "user" | "agent";
  readonly userCreationSource?: "web" | "provider";
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
        createdBy: role === "user" ? (input.userCreatedBy ?? "user") : ("user" as const),
        creationSource: role === "user" ? (input.userCreationSource ?? "web") : ("web" as const),
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
const stayOnTrack = PROMPT_SUGGESTION_PRESETS[0]!.instructions;

describe("CustomPromptSuggestionService", () => {
  it.effect("generates and publishes for a completed run on a watched thread", () => {
    const harness = makeHarness(predicted);
    return Effect.gen(function* () {
      const service = yield* CustomPromptSuggestions.CustomPromptSuggestionService;
      const threadId = yield* createThread("thread:watched");
      yield* watch(threadId);
      const runId = RunId.make("run:watched:1");
      yield* recordRun({
        threadId,
        runId,
        ordinal: 1,
        user: "add a toggle",
        assistant: "Done. Next: tests.",
      });

      yield* service.onRunCompleted(threadId, runId);

      assert.deepStrictEqual(yield* Queue.take(yield* PublishedSuggestions), {
        threadId,
        runId,
        text: "Run the tests",
      });
      const call = harness.generateNextMessagePrediction.mock.calls[0]?.[0];
      assert.strictEqual(call?.instructions, stayOnTrack);
      assert.include(call?.context ?? "", "add a toggle");
      assert.notStrictEqual(call?.cwd, workspaceRoot);
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("does not generate for unwatched threads", () => {
    const harness = makeHarness(predicted);
    return Effect.gen(function* () {
      const service = yield* CustomPromptSuggestions.CustomPromptSuggestionService;
      const threadId = yield* createThread("thread:unwatched");
      const runId = RunId.make("run:unwatched:1");
      yield* recordRun({ threadId, runId, ordinal: 1, user: "hi", assistant: "hello" });

      yield* service.onRunCompleted(threadId, runId);

      assert.strictEqual(harness.generateNextMessagePrediction.mock.calls.length, 0);
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect.each([
    { name: "the source is built-in", settings: { promptSuggestionsEnabled: true } },
    {
      name: "the feature is off",
      settings: { promptSuggestionsEnabled: false, promptSuggestionSource: "model" as const },
    },
  ])("does not generate when $name", ({ settings }) => {
    const harness = makeHarness(predicted, settings);
    return Effect.gen(function* () {
      const service = yield* CustomPromptSuggestions.CustomPromptSuggestionService;
      const threadId = yield* createThread("thread:off");
      yield* watch(threadId);
      const runId = RunId.make("run:off:1");
      yield* recordRun({ threadId, runId, ordinal: 1, user: "hi", assistant: "hello" });

      yield* service.onRunCompleted(threadId, runId);

      assert.strictEqual(harness.generateNextMessagePrediction.mock.calls.length, 0);
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("skips provider continuations", () => {
    const harness = makeHarness(predicted);
    return Effect.gen(function* () {
      const service = yield* CustomPromptSuggestions.CustomPromptSuggestionService;
      const threadId = yield* createThread("thread:continuation");
      yield* watch(threadId);
      const runId = RunId.make("run:continuation:1");
      yield* recordRun({
        threadId,
        runId,
        ordinal: 1,
        user: "continue",
        assistant: "continued",
        userCreatedBy: "agent",
        userCreationSource: "provider",
      });

      yield* service.onRunCompleted(threadId, runId);

      assert.strictEqual(harness.generateNextMessagePrediction.mock.calls.length, 0);
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("generates once when a watched thread's latest completed run has no suggestion", () => {
    const harness = makeHarness(predicted);
    return Effect.gen(function* () {
      const threadId = yield* createThread("thread:reopened");
      const runId = RunId.make("run:reopened:1");
      yield* recordRun({ threadId, runId, ordinal: 1, user: "hi", assistant: "hello" });

      yield* watch(threadId);

      assert.deepStrictEqual(yield* Queue.take(yield* PublishedSuggestions), {
        threadId,
        runId,
        text: "Run the tests",
      });
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("a newer run cancels the in-flight generation", () => {
    const interrupted = Ref.makeUnsafe(false);
    const started = Deferred.makeUnsafe<void>();
    const harness = makeHarness((input) =>
      input.context.includes("second request")
        ? Effect.succeed({ prediction: "Second" })
        : Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Ref.set(interrupted, true)),
          ),
    );
    return Effect.gen(function* () {
      const service = yield* CustomPromptSuggestions.CustomPromptSuggestionService;
      const threadId = yield* createThread("thread:cancel");
      yield* watch(threadId);
      const first = RunId.make("run:cancel:1");
      yield* recordRun({
        threadId,
        runId: first,
        ordinal: 1,
        user: "first request",
        assistant: "one",
      });
      yield* service.trigger(threadId, first);
      yield* Deferred.await(started);
      const second = RunId.make("run:cancel:2");
      yield* recordRun({
        threadId,
        runId: second,
        ordinal: 2,
        user: "second request",
        assistant: "two",
      });

      yield* service.trigger(threadId, second);

      assert.deepStrictEqual(yield* Queue.take(yield* PublishedSuggestions), {
        threadId,
        runId: second,
        text: "Second",
      });
      assert.isTrue(yield* Ref.get(interrupted));
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("uses the project's behavior override", () => {
    const harness = makeHarness(predicted, {
      ...enabledSettings,
      projectSettingsOverrides: { [projectId]: { promptSuggestionBehavior: "security" } },
    });
    return Effect.gen(function* () {
      const service = yield* CustomPromptSuggestions.CustomPromptSuggestionService;
      const threadId = yield* createThread("thread:project-behavior");
      yield* watch(threadId);
      const runId = RunId.make("run:project-behavior:1");
      yield* recordRun({ threadId, runId, ordinal: 1, user: "hi", assistant: "hello" });

      yield* service.onRunCompleted(threadId, runId);

      const security = PROMPT_SUGGESTION_PRESETS.find((preset) => preset.id === "security")!;
      assert.strictEqual(
        harness.generateNextMessagePrediction.mock.calls[0]?.[0].instructions,
        security.instructions,
      );
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("failures publish nothing and do not count toward speed", () => {
    const harness = makeHarness(() =>
      Effect.fail(
        new TextGenerationError({ operation: "generateNextMessagePrediction", detail: "down" }),
      ),
    );
    return Effect.gen(function* () {
      const service = yield* CustomPromptSuggestions.CustomPromptSuggestionService;
      const threadId = yield* createThread("thread:failure");
      yield* watch(threadId);
      const runId = RunId.make("run:failure:1");
      yield* recordRun({ threadId, runId, ordinal: 1, user: "hi", assistant: "hello" });

      yield* service.onRunCompleted(threadId, runId);

      assert.strictEqual(yield* Queue.size(yield* PublishedSuggestions), 0);
      assert.deepStrictEqual(Option.getOrThrow(yield* service.speed.pipe(Stream.runHead)), {
        medianMs: null,
        samples: 0,
      });
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("speed counts recent successes", () => {
    const durations = [1_000, 3_000, 2_000];
    let index = 0;
    const harness = makeHarness(() =>
      TestClock.adjust(durations[index++]!).pipe(Effect.as({ prediction: "Next" })),
    );
    return Effect.gen(function* () {
      const service = yield* CustomPromptSuggestions.CustomPromptSuggestionService;
      const threadId = yield* createThread("thread:speed");
      yield* watch(threadId);
      for (const ordinal of [1, 2, 3]) {
        const runId = RunId.make(`run:speed:${ordinal}`);
        yield* recordRun({
          threadId,
          runId,
          ordinal,
          user: `ask ${ordinal}`,
          assistant: `reply ${ordinal}`,
        });
        yield* service.onRunCompleted(threadId, runId);
      }

      // TestClock readings lag inside the fake, so only the count and presence are exact here.
      const speed = Option.getOrThrow(yield* service.speed.pipe(Stream.runHead));
      assert.strictEqual(speed.samples, 3);
      assert.isAbove(speed.medianMs ?? 0, 0);
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("uses the todo list the agent updated last within a run", () => {
    const harness = makeHarness(predicted);
    return Effect.gen(function* () {
      const service = yield* CustomPromptSuggestions.CustomPromptSuggestionService;
      const threadId = yield* createThread("thread:todo-order");
      yield* watch(threadId);
      const runId = RunId.make("run:todo-order:1");
      yield* recordRun({
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

      yield* service.onRunCompleted(threadId, runId);

      const context = harness.generateNextMessagePrediction.mock.calls[0]?.[0].context ?? "";
      assert.include(context, "NEW-STEP");
      assert.notInclude(context, "OLD-STEP");
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("describes tool activity that has no title", () => {
    const harness = makeHarness(predicted);
    return Effect.gen(function* () {
      const service = yield* CustomPromptSuggestions.CustomPromptSuggestionService;
      const threadId = yield* createThread("thread:activity");
      yield* watch(threadId);
      const runId = RunId.make("run:activity:1");
      yield* recordRun({
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

      yield* service.onRunCompleted(threadId, runId);

      const context = harness.generateNextMessagePrediction.mock.calls[0]?.[0].context ?? "";
      assert.include(context, "file_change (completed): src/login.ts");
      assert.include(context, "command_execution (completed): vp test run src/login.test.ts");
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("ignores a queued run that was cancelled before it started", () => {
    const harness = makeHarness(predicted);
    return Effect.gen(function* () {
      const service = yield* CustomPromptSuggestions.CustomPromptSuggestionService;
      const threadId = yield* createThread("thread:cancelled-queue");
      yield* watch(threadId);
      const runId = RunId.make("run:cancelled-queue:1");
      yield* recordRun({ threadId, runId, ordinal: 1, user: "build it", assistant: "Built it." });
      yield* recordRun({
        threadId,
        runId: RunId.make("run:cancelled-queue:2"),
        ordinal: 2,
        user: "queued then cancelled",
        assistant: null,
        status: "cancelled",
        started: false,
      });

      yield* service.onRunCompleted(threadId, runId);

      assert.strictEqual((yield* Queue.take(yield* PublishedSuggestions)).runId, runId);
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("prefers a newer proposed plan over an older todo list", () => {
    const harness = makeHarness(predicted);
    return Effect.gen(function* () {
      const service = yield* CustomPromptSuggestions.CustomPromptSuggestionService;
      const threadId = yield* createThread("thread:plan-recency");
      yield* watch(threadId);
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
      yield* recordRun({
        threadId,
        runId: second,
        ordinal: 2,
        user: "propose a new plan",
        assistant: "Here is the plan.",
        extraEvents: (now) => [
          proposedPlanEvent(threadId, second, "plan:proposed", "NEW-PLAN", now),
        ],
      });

      yield* service.onRunCompleted(threadId, second);

      const context = harness.generateNextMessagePrediction.mock.calls[0]?.[0].context ?? "";
      assert.include(context, "NEW-PLAN");
      assert.notInclude(context, "OLD-STEP");
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("skips delegated threads", () => {
    const harness = makeHarness(predicted);
    return Effect.gen(function* () {
      const service = yield* CustomPromptSuggestions.CustomPromptSuggestionService;
      const threadId = yield* createThread("thread:delegated", {
        delegatedFrom: {
          environmentId: EnvironmentId.make("environment:other"),
          threadId: ThreadId.make("thread:parent"),
          title: "Parent",
        },
      });
      yield* watch(threadId);
      const runId = RunId.make("run:delegated:1");
      yield* recordRun({ threadId, runId, ordinal: 1, user: "do it", assistant: "done" });

      yield* service.onRunCompleted(threadId, runId);

      assert.strictEqual(harness.generateNextMessagePrediction.mock.calls.length, 0);
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("does not regenerate when the same run completes again", () => {
    const harness = makeHarness(() => Effect.succeed({ prediction: null }));
    return Effect.gen(function* () {
      const service = yield* CustomPromptSuggestions.CustomPromptSuggestionService;
      const threadId = yield* createThread("thread:repeat");
      yield* watch(threadId);
      const runId = RunId.make("run:repeat:1");
      yield* recordRun({ threadId, runId, ordinal: 1, user: "hi", assistant: "hello" });

      yield* service.onRunCompleted(threadId, runId);
      yield* service.onRunCompleted(threadId, runId);

      assert.strictEqual(harness.generateNextMessagePrediction.mock.calls.length, 1);
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("does not publish when the source changes during generation", () => {
    const started = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    const harness = makeHarness(() =>
      Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
        Effect.as({ prediction: "Late" }),
      ),
    );
    return Effect.gen(function* () {
      const service = yield* CustomPromptSuggestions.CustomPromptSuggestionService;
      const settings = yield* ServerSettings.ServerSettingsService;
      const threadId = yield* createThread("thread:switched");
      yield* watch(threadId);
      const runId = RunId.make("run:switched:1");
      yield* recordRun({ threadId, runId, ordinal: 1, user: "hi", assistant: "hello" });
      const fiber = yield* service.onRunCompleted(threadId, runId).pipe(Effect.forkScoped);
      yield* Deferred.await(started);

      yield* settings.updateSettings({ promptSuggestionSource: "built-in" });
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(fiber);

      assert.strictEqual(yield* Queue.size(yield* PublishedSuggestions), 0);
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("does not publish for a run that is no longer the latest", () => {
    const started = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    const harness = makeHarness(() =>
      Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
        Effect.as({ prediction: "Stale" }),
      ),
    );
    return Effect.gen(function* () {
      const service = yield* CustomPromptSuggestions.CustomPromptSuggestionService;
      const threadId = yield* createThread("thread:superseded");
      yield* watch(threadId);
      const first = RunId.make("run:superseded:1");
      yield* recordRun({ threadId, runId: first, ordinal: 1, user: "one", assistant: "first" });
      const fiber = yield* service.onRunCompleted(threadId, first).pipe(Effect.forkScoped);
      yield* Deferred.await(started);

      yield* recordRun({
        threadId,
        runId: RunId.make("run:superseded:2"),
        ordinal: 2,
        user: "two",
        assistant: "second",
      });
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(fiber);

      assert.strictEqual(yield* Queue.size(yield* PublishedSuggestions), 0);
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });

  it.effect("successful empty results count toward speed", () => {
    const harness = makeHarness(() => Effect.succeed({ prediction: null }));
    return Effect.gen(function* () {
      const service = yield* CustomPromptSuggestions.CustomPromptSuggestionService;
      const threadId = yield* createThread("thread:empty-speed");
      yield* watch(threadId);
      const runId = RunId.make("run:empty-speed:1");
      yield* recordRun({ threadId, runId, ordinal: 1, user: "thanks", assistant: "done" });

      yield* service.onRunCompleted(threadId, runId);

      assert.strictEqual(Option.getOrThrow(yield* service.speed.pipe(Stream.runHead)).samples, 1);
    }).pipe(Effect.scoped, Effect.provide(harness.layer));
  });
});

describe("median", () => {
  it.each([
    [[], null],
    [[3_000], 3_000],
    [[1_000, 3_000, 2_000], 2_000],
    [[1_000, 2_000, 3_000, 4_000], 2_500],
  ])("median(%j) is %j", (values, expected) => {
    assert.strictEqual(CustomPromptSuggestions.median(values), expected);
  });
});
