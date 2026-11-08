import type { PredictionContextInput } from "../../apps/server/src/composerPrediction/predictionContext.ts";

interface NextMessageCase extends PredictionContextInput {
  readonly id: string;
  readonly rubric: string;
}

export const nextMessageEvaluationCases: ReadonlyArray<NextMessageCase> = [
  {
    id: "agent-stated-next-step",
    messages: [
      { role: "user", text: "Add a dark mode toggle to the settings page." },
      {
        role: "assistant",
        text: "Added the toggle and wired it to the theme store. Next I'd add tests for the store's persistence.",
      },
    ],
    todoList: null,
    proposedPlan: null,
    turnItems: [],
    rubric: "Asks the agent to add the persistence tests. Short, in the user's voice.",
  },
  {
    id: "agent-asked-question",
    messages: [
      {
        role: "user",
        text: "I need a tiny local cache for a CLI tool, single user, no server. Set up storage.",
      },
      {
        role: "assistant",
        text: "I can use Postgres or SQLite for this. Which do you prefer?",
      },
    ],
    todoList: null,
    proposedPlan: null,
    turnItems: [],
    rubric: "Answers SQLite (local, single user, no server). Does not ask a question back.",
  },
  {
    id: "work-finished",
    messages: [
      { role: "user", text: "Merge the PR once checks pass." },
      { role: "assistant", text: "Checks passed and the PR is merged. The branch is deleted." },
      { role: "user", text: "Thanks!" },
      { role: "assistant", text: "You're welcome. Nothing else is pending." },
    ],
    todoList: null,
    proposedPlan: null,
    turnItems: [],
    rubric: "Returns null. Nothing is open.",
  },
  {
    id: "drift-trap",
    messages: [
      { role: "user", text: "The login form crashes when the email field is empty. Fix it." },
      {
        role: "assistant",
        text: "Found it: validation reads email.trim() on undefined. I've guarded the read but haven't handled the error message yet. Unrelated, but the signup page could use a redesign someday.",
      },
    ],
    todoList: null,
    proposedPlan: null,
    turnItems: [{ type: "file_change", status: "completed", title: "src/login/validate.ts" }],
    rubric:
      "Continues the bug fix (handle the error message or test the empty email). Ignores the redesign.",
  },
  {
    id: "best-practice-before-commit",
    messages: [
      { role: "user", text: "Refactor the payment retry logic into its own module." },
      {
        role: "assistant",
        text: "Moved the retry logic into payments/retry.ts and updated the three callers.",
      },
    ],
    todoList: null,
    proposedPlan: null,
    turnItems: [
      { type: "file_change", status: "completed", title: "payments/retry.ts" },
      { type: "file_change", status: "completed", title: "payments/charge.ts" },
    ],
    rubric:
      "Asks to run the tests or check the diff before committing. Does not ask to commit blindly.",
  },
  {
    id: "non-english-user",
    messages: [
      { role: "user", text: "أضف زر تسجيل الخروج إلى شريط التنقل." },
      {
        role: "assistant",
        text: "Added a logout button to the navbar. It calls the existing signOut helper. I haven't tested it in the browser yet.",
      },
    ],
    todoList: null,
    proposedPlan: null,
    turnItems: [],
    rubric: "Written in Arabic. Asks to test the button (for example in the browser).",
  },
  {
    id: "open-todo",
    messages: [
      { role: "user", text: "Set up the CI pipeline as we planned." },
      {
        role: "assistant",
        text: "Lint and unit test jobs are in place and green.",
      },
    ],
    todoList: {
      steps: [
        { text: "Add lint job", status: "completed" },
        { text: "Add unit test job", status: "completed" },
        { text: "Add build and deploy preview job", status: "pending" },
        { text: "Require checks on main", status: "pending" },
      ],
    },
    proposedPlan: null,
    turnItems: [],
    rubric: "Proceeds to the build and deploy preview job.",
  },
];
