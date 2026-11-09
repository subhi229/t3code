#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeUtil from "node:util";
import * as NodePlatformCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ClaudeSettings, CodexSettings, ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import {
  DEFAULT_PROMPT_SUGGESTION_BEHAVIOR_ID,
  resolvePromptSuggestionBehavior,
} from "@t3tools/shared/promptSuggestionBehaviors";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { CODEX_PROMPT_SUGGESTION_PROMPT } from "../../apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as ClaudeTextGeneration from "../../apps/server/src/textGeneration/ClaudeTextGeneration.ts";
import * as CodexTextGeneration from "../../apps/server/src/textGeneration/CodexTextGeneration.ts";
import { formatPredictionContext } from "../../apps/server/src/composerPrediction/predictionContext.ts";
import * as ServerConfig from "../../apps/server/src/config.ts";
import { nextMessageEvaluationCases } from "./cases.ts";

const { values } = NodeUtil.parseArgs({
  options: {
    provider: { type: "string", default: "codex" },
    model: { type: "string" },
    effort: { type: "string" },
    mode: { type: "string", default: "behavior" },
    out: { type: "string" },
    case: { type: "string" },
  },
});
if (!values.model || !values.out)
  throw new Error(
    "Use --model <model> --out <directory> [--provider codex|claude] [--effort <level>] [--mode behavior|generic].",
  );
if (values.mode !== "behavior" && values.mode !== "generic")
  throw new Error("--mode is behavior or generic.");
if (values.provider !== "codex" && values.provider !== "claude")
  throw new Error("--provider is codex or claude.");
const provider = values.provider;
const mode = values.mode;
const outputDirectory = values.out;
const effortOption = values.effort
  ? [{ id: provider === "codex" ? "reasoningEffort" : "effort", value: values.effort }]
  : undefined;
const modelSelection = createModelSelection(
  ProviderInstanceId.make(provider === "codex" ? "codex" : "claudeAgent"),
  values.model,
  effortOption,
);
const encodeReport = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeCodexSettings = Schema.decodeUnknownEffect(CodexSettings);
const decodeClaudeSettings = Schema.decodeUnknownEffect(ClaudeSettings);
const cases = nextMessageEvaluationCases.filter(
  (fixture) => values.case === undefined || fixture.id === values.case,
);
if (cases.length === 0) throw new Error(`No case named ${values.case}.`);

await Effect.runPromise(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-next-message-evaluation-" });
    const generation =
      provider === "codex"
        ? yield* CodexTextGeneration.makeCodexTextGeneration(yield* decodeCodexSettings({}))
        : yield* ClaudeTextGeneration.makeClaudeTextGeneration(yield* decodeClaudeSettings({}));
    const results = [];
    for (const fixture of cases) {
      const context = formatPredictionContext(fixture);
      const behavior = resolvePromptSuggestionBehavior({
        promptSuggestionBehavior: fixture.behavior ?? DEFAULT_PROMPT_SUGGESTION_BEHAVIOR_ID,
        promptSuggestionCustomBehaviors: [],
      });
      // "generic" stands in for the built-in Codex prompt wording; it is not the cache-sharing sample.
      const [elapsed, prediction] = yield* (
        mode === "generic"
          ? generation
              .generateTranscriptionPostProcessing({
                cwd,
                modelSelection,
                prompt: `${CODEX_PROMPT_SUGGESTION_PROMPT}\n\nConversation:\n${context}\n\nPut the message in "transcription", or an empty string for nothing.`,
              })
              .pipe(Effect.map((result) => result.transcription.trim() || null))
          : generation
              .generateNextMessagePrediction({
                cwd,
                context,
                instructions: behavior.instructions,
                modelSelection,
              })
              .pipe(Effect.map((result) => result.prediction))
      ).pipe(Effect.timed);
      results.push({
        id: fixture.id,
        behavior: mode === "generic" ? "generic" : behavior.id,
        model: values.model,
        effort: values.effort ?? "default",
        prediction,
        latencyMs: Duration.toMillis(elapsed),
        rubric: fixture.rubric,
      });
    }
    yield* fs.makeDirectory(outputDirectory, { recursive: true });
    yield* fs.writeFileString(
      path.join(outputDirectory, "results.json"),
      yield* encodeReport(results),
    );
    yield* Effect.log(`Wrote ${results.length} cases to ${outputDirectory}.`);
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-next-message-evaluation-state-" }).pipe(
        Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodePlatformCrypto.layer)),
      ),
    ),
    Effect.scoped,
  ),
);
