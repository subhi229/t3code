import type { PredictionContextInput } from "../../apps/server/src/composerPrediction/predictionContext.ts";

interface NextMessageCase extends PredictionContextInput {
  readonly id: string;
  /** Preset the case exercises; the default behavior when absent. */
  readonly behavior?: string;
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
  {
    id: "next-step-lost-after-research",
    behavior: "next-step",
    messages: [
      { role: "user", text: "Look into why our builds got slow." },
      {
        role: "assistant",
        text: "The type check now takes 4 minutes because the new generated client is included in every package's tsconfig.",
      },
    ],
    todoList: null,
    proposedPlan: null,
    turnItems: [],
    rubric:
      "One concrete next action (exclude the generated client from the other tsconfigs, or measure after), with a short why.",
  },
  {
    id: "next-step-half-done-migration",
    behavior: "next-step",
    messages: [
      { role: "user", text: "Move the settings page to the new form library." },
      {
        role: "assistant",
        text: "General and Profile tabs are migrated. Billing and Notifications still use the old forms.",
      },
    ],
    todoList: null,
    proposedPlan: null,
    turnItems: [],
    rubric: "Picks the next tab to migrate (Billing or Notifications) and says why briefly.",
  },
  {
    id: "future-problems-upload",
    behavior: "future-problems",
    messages: [
      { role: "user", text: "Add avatar uploads to the profile page." },
      {
        role: "assistant",
        text: "Uploads now save the file to /uploads and store the path on the user.",
      },
    ],
    todoList: null,
    proposedPlan: null,
    turnItems: [],
    rubric:
      "Raises a likely future problem: file size or type limits, replacing old avatars, or storage growth.",
  },
  {
    id: "future-problems-retry",
    behavior: "future-problems",
    messages: [
      { role: "user", text: "Make the webhook sender retry on failure." },
      {
        role: "assistant",
        text: "It now retries forever every second until the request succeeds.",
      },
    ],
    todoList: null,
    proposedPlan: null,
    turnItems: [],
    rubric: "Asks for backoff and a retry limit (or idempotency), not a new feature.",
  },
  {
    id: "security-search-endpoint",
    behavior: "security",
    messages: [
      { role: "user", text: "Add a search endpoint for orders." },
      {
        role: "assistant",
        text: "GET /orders/search builds the SQL from the q parameter and returns matching rows.",
      },
    ],
    todoList: null,
    proposedPlan: null,
    turnItems: [],
    rubric:
      "Flags SQL injection (parameterize) or missing authorization on whose orders are returned.",
  },
  {
    id: "security-api-key",
    behavior: "security",
    messages: [
      { role: "user", text: "Hook up the payments API." },
      {
        role: "assistant",
        text: "Done. I put the API key in config.ts so it works locally and in production.",
      },
    ],
    todoList: null,
    proposedPlan: null,
    turnItems: [],
    rubric: "Asks to move the key out of source into an environment variable or secret store.",
  },
  {
    id: "understand-caching",
    behavior: "understand",
    messages: [
      { role: "user", text: "The dashboard is slow, speed it up." },
      {
        role: "assistant",
        text: "I added a cache with a 5 minute TTL keyed by user and filters. Load time dropped from 3s to 200ms.",
      },
    ],
    todoList: null,
    proposedPlan: null,
    turnItems: [],
    rubric:
      "Asks the agent to explain a choice or tradeoff (why 5 minutes, staleness, invalidation).",
  },
  {
    id: "understand-regex",
    behavior: "understand",
    messages: [
      { role: "user", text: "Validate the phone number field." },
      { role: "assistant", text: "Added /^\\+?[1-9]\\d{1,14}$/ to the form schema." },
    ],
    todoList: null,
    proposedPlan: null,
    turnItems: [],
    rubric: "Asks what the pattern accepts or why it was chosen.",
  },
];
