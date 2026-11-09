# Next message

Compares prompt suggestions: the built-in Codex prompt wording ("generic") against the suggestion behaviors a user can pick with "My model". It also records how long each model and effort level takes, which feeds the speed guidance in Settings.

## Run

```sh
cd evals
pnpm next-message --model gpt-6-luna --effort low --mode generic --out runs/generic-luna
pnpm next-message --model gpt-6-luna --effort low --out runs/behavior-luna
pnpm next-message --provider claude --model claude-haiku-5-5 --out runs/behavior-haiku
```

- It uses your local Codex or Claude login, like the server does.
- `--mode generic` sends the built-in Codex prompt wording through the same text generator. It stands in for the prompt only, not Codex's cache-sharing `thread/sample` request.
- `--case <id>` runs one case.
- A run writes `results.json` with each prediction, its behavior, model, effort, latency and rubric.

## Add a case

Add an entry to `cases.ts` with an `id`, the thread `messages`, optional `todoList`, `proposedPlan` and `turnItems`, an optional `behavior` preset id, and a `rubric` saying what a good suggestion does, or that it should be null.
