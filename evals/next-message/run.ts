#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeUtil from "node:util";
import * as NodeCrypto from "node:crypto";
import * as NodePlatformCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CodexSettings, ProviderInstanceId } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as CodexTextGeneration from "../../apps/server/src/textGeneration/CodexTextGeneration.ts";
import { formatPredictionContext } from "../../apps/server/src/composerPrediction/predictionContext.ts";
import * as ServerConfig from "../../apps/server/src/config.ts";
import { nextMessageEvaluationCases } from "./cases.ts";

const { values } = NodeUtil.parseArgs({
  options: {
    model: { type: "string" },
    out: { type: "string" },
    baseline: { type: "string" },
    case: { type: "string" },
  },
});
if (!values.model || !values.out)
  throw new Error("Use --model <configured-model> --out <directory>.");
const model = values.model;
const outputDirectory = values.out;
const Results = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ id: Schema.String, prediction: Schema.NullOr(Schema.String) })),
);
const decodeResults = Schema.decodeUnknownEffect(Results);
const decodeSettings = Schema.decodeUnknownEffect(CodexSettings);
const encodeReport = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const cases = nextMessageEvaluationCases.filter(
  (fixture) => values.case === undefined || fixture.id === values.case,
);
if (cases.length === 0) throw new Error(`No case named ${values.case}.`);

await Effect.runPromise(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-next-message-evaluation-" });
    const generation = yield* CodexTextGeneration.makeCodexTextGeneration(
      yield* decodeSettings({}),
    );
    const baseline = values.baseline
      ? yield* fs.readFileString(values.baseline).pipe(Effect.flatMap(decodeResults))
      : [];
    const results = [];
    const review = [];
    const answerKey = [];
    for (const fixture of cases) {
      const [elapsed, generated] = yield* generation
        .generateNextMessagePrediction({
          cwd,
          context: formatPredictionContext(fixture),
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model },
        })
        .pipe(Effect.timed);
      results.push({
        id: fixture.id,
        prediction: generated.prediction,
        latencyMs: Duration.toMillis(elapsed),
      });
      const previous = baseline.find((entry) => entry.id === fixture.id);
      const newFirst = NodeCrypto.randomInt(2) === 0;
      review.push({
        id: fixture.id,
        rubric: fixture.rubric,
        ...(previous
          ? {
              A: newFirst ? generated.prediction : previous.prediction,
              B: newFirst ? previous.prediction : generated.prediction,
              preferred: "",
            }
          : { prediction: generated.prediction, meetsRubric: "" }),
      });
      if (previous) answerKey.push({ id: fixture.id, candidate: newFirst ? "A" : "B" });
    }
    yield* fs.makeDirectory(outputDirectory, { recursive: true });
    for (const [name, report] of [
      ["results", results],
      ["review", review],
      ["answer-key", answerKey],
    ] as const) {
      yield* fs.writeFileString(
        path.join(outputDirectory, `${name}.json`),
        yield* encodeReport(report),
      );
    }
    yield* Effect.log(
      `Wrote ${results.length} cases to ${outputDirectory}. Score review.json before opening answer-key.json.`,
    );
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-next-message-evaluation-state-" }).pipe(
        Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodePlatformCrypto.layer)),
      ),
    ),
    Effect.scoped,
  ),
);
