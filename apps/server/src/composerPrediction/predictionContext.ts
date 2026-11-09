import type { OrchestrationV2ConversationMessage } from "@t3tools/contracts";

const MAX_MESSAGES = 8;
const MAX_MESSAGE_CHARS = 1_500;
const MAX_LATEST_ASSISTANT_CHARS = 6_000;
const MAX_TODO_STEPS = 20;
const MAX_TURN_ITEMS = 15;
const MAX_TURN_ITEM_LABEL_CHARS = 160;
const MAX_PROPOSED_PLAN_CHARS = 2_000;

export type PredictionContextMessage = Pick<
  OrchestrationV2ConversationMessage,
  "role" | "text" | "scheduledTaskId" | "senderThreadId"
>;

export interface PredictionContextInput {
  readonly messages: ReadonlyArray<PredictionContextMessage>;
  readonly todoList: {
    readonly steps: ReadonlyArray<{
      readonly text: string;
      readonly status: "pending" | "running" | "completed";
    }>;
  } | null;
  readonly proposedPlan: string | null;
  readonly turnItems: ReadonlyArray<{
    readonly type: string;
    readonly status: string;
    readonly title: string;
  }>;
}

// The end of a message carries its conclusion and any question, so long text keeps its tail.
function keepTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `[earlier text truncated]\n${text.slice(-maxChars)}`;
}

function speaker(message: PredictionContextMessage): string {
  if (message.role === "assistant") return "Agent";
  return message.scheduledTaskId !== undefined || message.senderThreadId !== undefined
    ? "User (automated)"
    : "User";
}

export function formatPredictionContext(input: PredictionContextInput): string {
  const recent = input.messages.slice(-MAX_MESSAGES);
  const latestAssistantIndex = recent.findLastIndex((message) => message.role === "assistant");
  const sections = [
    recent
      .map(
        (message, index) =>
          `${speaker(message)}:\n${keepTail(
            message.text.trim(),
            index === latestAssistantIndex ? MAX_LATEST_ASSISTANT_CHARS : MAX_MESSAGE_CHARS,
          )}`,
      )
      .join("\n\n"),
  ];
  const allSteps = input.todoList?.steps ?? [];
  // A long list keeps its open steps: they are what is left to do.
  const steps =
    allSteps.length <= MAX_TODO_STEPS
      ? allSteps
      : allSteps.filter((step) => step.status !== "completed").slice(0, MAX_TODO_STEPS);
  const hiddenCompleted = allSteps.filter(
    (step) => step.status === "completed" && !steps.includes(step),
  ).length;
  if (allSteps.length > 0) {
    sections.push(
      `Todo list:\n${[
        ...(hiddenCompleted > 0 ? [`(${hiddenCompleted} completed steps not shown)`] : []),
        ...steps.map((step) => `${step.status === "completed" ? "[x]" : "[ ]"} ${step.text}`),
      ].join("\n")}`,
    );
  }
  if (input.proposedPlan !== null && input.proposedPlan.trim().length > 0) {
    sections.push(
      `Proposed plan:\n${keepTail(input.proposedPlan.trim(), MAX_PROPOSED_PLAN_CHARS)}`,
    );
  }
  const items = input.turnItems.slice(-MAX_TURN_ITEMS);
  if (items.length > 0) {
    sections.push(
      `Agent activity in its last turn:\n${items
        .map(
          (item) =>
            `- ${item.type} (${item.status}): ${item.title.slice(0, MAX_TURN_ITEM_LABEL_CHARS)}`,
        )
        .join("\n")}`,
    );
  }
  return sections.join("\n\n");
}
