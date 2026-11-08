import type { OrchestrationV2ConversationMessage } from "@t3tools/contracts";

const MAX_MESSAGES = 8;
const MAX_MESSAGE_CHARS = 1_500;
const MAX_LATEST_ASSISTANT_CHARS = 6_000;
const MAX_TODO_STEPS = 20;
const MAX_TURN_ITEMS = 15;

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
  const steps = input.todoList?.steps.slice(0, MAX_TODO_STEPS) ?? [];
  if (steps.length > 0) {
    sections.push(
      `Todo list:\n${steps
        .map((step) => `${step.status === "completed" ? "[x]" : "[ ]"} ${step.text}`)
        .join("\n")}`,
    );
  }
  const items = input.turnItems.slice(-MAX_TURN_ITEMS);
  if (items.length > 0) {
    sections.push(
      `Agent activity in its last turn:\n${items
        .map((item) => `- ${item.type} (${item.status}): ${item.title}`)
        .join("\n")}`,
    );
  }
  return sections.join("\n\n");
}
