import { describe, expect, it } from "vite-plus/test";
import { ScheduledTaskId, ThreadId } from "@t3tools/contracts";

import { formatPredictionContext, type PredictionContextMessage } from "./predictionContext.ts";

const message = (
  role: "user" | "assistant",
  text: string,
  extra: Partial<PredictionContextMessage> = {},
): PredictionContextMessage => ({ role, text, ...extra });

describe("formatPredictionContext", () => {
  it("keeps only the last 8 messages", () => {
    const messages = Array.from({ length: 50 }, (_, index) =>
      message(index % 2 === 0 ? "user" : "assistant", `message-${index}-end`),
    );
    const context = formatPredictionContext({
      messages,
      todoList: null,
      proposedPlan: null,
      turnItems: [],
    });

    expect(context).toContain("message-42-end");
    expect(context).toContain("message-49-end");
    expect(context).not.toContain("message-41-end");
  });

  it("gives the latest assistant reply the most room", () => {
    const older = message("user", `OLDER-HEAD${"o".repeat(5_000)}`);
    const latest = message("assistant", `LATEST-HEAD${"l".repeat(5_000)}`);
    const context = formatPredictionContext({
      messages: [older, latest],
      todoList: null,
      proposedPlan: null,
      turnItems: [],
    });

    expect(context).toContain("LATEST-HEAD");
    expect(context).not.toContain("OLDER-HEAD");
    expect(context.match(/o+/)?.[0].length ?? 0).toBeLessThanOrEqual(1_500);
  });

  it("labels automated user messages", () => {
    const context = formatPredictionContext({
      messages: [
        message("user", "typed by a person"),
        message("user", "sent by a schedule", { scheduledTaskId: ScheduledTaskId.make("task-1") }),
        message("user", "sent by another thread", { senderThreadId: ThreadId.make("thread-2") }),
        message("assistant", "agent reply"),
      ],
      todoList: null,
      proposedPlan: null,
      turnItems: [],
    });

    expect(context).toContain("User:\ntyped by a person");
    expect(context).toContain("User (automated):\nsent by a schedule");
    expect(context).toContain("User (automated):\nsent by another thread");
    expect(context).toContain("Agent:\nagent reply");
  });

  it("lists open and done todo steps", () => {
    const context = formatPredictionContext({
      messages: [message("assistant", "reply")],
      todoList: {
        steps: [
          { text: "done step", status: "completed" },
          { text: "open step", status: "pending" },
        ],
      },
      proposedPlan: null,
      turnItems: [],
    });

    expect(context).toContain("[x] done step");
    expect(context).toContain("[ ] open step");
  });

  it("keeps the open steps of a long todo list", () => {
    const steps = Array.from({ length: 30 }, (_, index) => ({
      text: `step-${index}`,
      status: index < 25 ? ("completed" as const) : ("pending" as const),
    }));
    const context = formatPredictionContext({
      messages: [message("assistant", "reply")],
      todoList: { steps },
      proposedPlan: null,
      turnItems: [],
    });

    expect(context).toContain("[ ] step-25");
    expect(context).toContain("[ ] step-29");
    expect(context).toContain("25 completed steps not shown");
    expect(context).not.toContain("step-0\n");
  });

  it("includes the latest proposed plan", () => {
    const context = formatPredictionContext({
      messages: [message("assistant", "reply")],
      todoList: null,
      proposedPlan: `${"p".repeat(5_000)}PLAN-TAIL`,
      turnItems: [],
    });

    expect(context).toContain("Proposed plan:");
    expect(context).toContain("PLAN-TAIL");
    expect(context.match(/p{100,}/)?.[0].length ?? 0).toBeLessThanOrEqual(2_000);
  });

  it("bounds long activity labels", () => {
    const context = formatPredictionContext({
      messages: [message("assistant", "reply")],
      todoList: null,
      proposedPlan: null,
      turnItems: [{ type: "command_execution", status: "completed", title: "Q".repeat(500) }],
    });

    expect(context.match(/Q+/)?.[0].length ?? 0).toBeLessThanOrEqual(160);
  });

  it("lists the last run's tool activity", () => {
    const turnItems = Array.from({ length: 20 }, (_, index) => ({
      type: "command_execution",
      status: "completed",
      title: `cmd-${index}`,
    }));
    const context = formatPredictionContext({
      messages: [message("assistant", "reply")],
      todoList: null,
      proposedPlan: null,
      turnItems,
    });

    expect(context).toContain("- command_execution (completed): cmd-19");
    expect(context).toContain("- command_execution (completed): cmd-5");
    expect(context).not.toContain("cmd-4\n");
    expect(context).not.toMatch(/cmd-4$/m);
  });

  it("omits empty sections", () => {
    const context = formatPredictionContext({
      messages: [message("assistant", "reply")],
      todoList: null,
      proposedPlan: null,
      turnItems: [],
    });

    expect(context).not.toContain("Todo list");
    expect(context).not.toContain("Agent activity");
  });
});
