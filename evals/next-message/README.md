# Next message

Predicts the user's next message for short thread shapes with the server's Codex text generator, the same prompt the composer's predictions use. A good prediction continues what is open, follows the subject's best practices, and stays quiet when nothing is left.

## Run

```sh
cd evals
pnpm next-message --model <codex model> --out runs/next-message
pnpm next-message --model <codex model> --out runs/next-message-new --baseline runs/next-message/results.json
```

- It uses your local Codex login, like the server does.
- `--case <id>` runs one case.
- A run writes `results.json` (predictions and latency) and `review.json` (each prediction with its rubric). With `--baseline`, `review.json` sets old and new predictions as A and B in random order, and `answer-key.json` says which is new. Score `review.json` before you open `answer-key.json`.

## Add a case

Add an entry to `cases.ts` with an `id`, the thread `messages`, an optional `todoList` and `turnItems`, and a `rubric` that says what a good prediction does, or that it should be null.
