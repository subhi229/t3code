import { TextGenerationError } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const isTextGenerationError = Schema.is(TextGenerationError);
const decodeJsonThreadTitle = Schema.decodeOption(
  Schema.fromJsonString(Schema.Struct({ title: Schema.String })),
);

export function toJsonSchemaObject(schema: Schema.Top): unknown {
  const document = Schema.toJsonSchemaDocument(Schema.toType(schema), {
    onExcessProperty: "error",
  });
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    return { ...document.schema, $defs: document.definitions };
  }
  return document.schema;
}

export function limitSection(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  // Half an emoji serializes to a lone surrogate escape, which provider JSON parsers reject.
  const last = value.charCodeAt(maxChars - 1);
  const truncated = value.slice(0, last >= 0xd800 && last <= 0xdbff ? maxChars - 1 : maxChars);
  return `${truncated}\n\n[truncated]`;
}

export function sanitizeCommitSubject(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const withoutTrailingPeriod = singleLine.replace(/[.]+$/g, "").trim();
  if (withoutTrailingPeriod.length === 0) {
    return "Update project files";
  }

  if (withoutTrailingPeriod.length <= 72) {
    return withoutTrailingPeriod;
  }
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
    withoutTrailingPeriod,
  );
  let subject = "";
  for (const { segment } of segments) {
    if (subject.length + segment.length > 72) break;
    subject += segment;
  }
  return subject.trimEnd() || "Update project files";
}

export function sanitizePrTitle(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  if (singleLine.length > 0) {
    return singleLine;
  }
  return "Update project changes";
}

const MAX_THREAD_TITLE_CHARS = 120;

export function sanitizeThreadTitle(raw: string): string {
  // Unwrap a JSON-formatted title before truncation can cut off the closing brace.
  const decoded = decodeJsonThreadTitle(raw);
  const title = Option.isSome(decoded) ? decoded.value.title : raw;
  const normalized = title
    .trim()
    .split(/\r?\n/g)[0]
    ?.trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .trim()
    .replace(/\s+/g, " ");

  if (!normalized || normalized.trim().length === 0) {
    return "New thread";
  }

  if (normalized.length <= MAX_THREAD_TITLE_CHARS) {
    return normalized;
  }

  let end = MAX_THREAD_TITLE_CHARS - 3;
  const previous = normalized.charCodeAt(end - 1);
  const next = normalized.charCodeAt(end);
  if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
    end -= 1;
  }
  return `${normalized.slice(0, end).trimEnd()}...`;
}

export const MAX_NEXT_MESSAGE_PREDICTION_CHARS = 280;

export function sanitizeNextMessagePrediction(raw: string | null): string | null {
  if (raw === null) return null;
  const stripLabel = (value: string) =>
    value.trim().replace(/^(?:user|prediction|next message)\s*:\s*/i, "");
  const unlabeled = stripLabel(raw.replace(/\s+/g, " "));
  // Only a matching pair wraps the message; a lone closing quote or backtick belongs to the text.
  const wrapped = /^(['"`])((?:(?!\1).)*)\1$/.exec(unlabeled);
  const normalized = (wrapped ? stripLabel(wrapped[2]!) : unlabeled).trim();
  if (normalized.length === 0) return null;
  if (normalized.length <= MAX_NEXT_MESSAGE_PREDICTION_CHARS) return normalized;
  const window = normalized.slice(0, MAX_NEXT_MESSAGE_PREDICTION_CHARS + 1);
  const lastSpace = window.lastIndexOf(" ");
  if (lastSpace > 0) return window.slice(0, lastSpace).trimEnd();
  const last = normalized.charCodeAt(MAX_NEXT_MESSAGE_PREDICTION_CHARS - 1);
  const end =
    last >= 0xd800 && last <= 0xdbff
      ? MAX_NEXT_MESSAGE_PREDICTION_CHARS - 1
      : MAX_NEXT_MESSAGE_PREDICTION_CHARS;
  return normalized.slice(0, end);
}

function cliLabel(cliName: string): string {
  const capitalized = cliName.charAt(0).toUpperCase() + cliName.slice(1);
  return `${capitalized} CLI (\`${cliName}\`)`;
}

export function normalizeCliError(
  cliName: string,
  operation: string,
  error: unknown,
  fallback: string,
): TextGenerationError {
  if (isTextGenerationError(error)) {
    return error;
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      error.message.includes(`Command not found: ${cliName}`) ||
      lower.includes(`spawn ${cliName}`) ||
      lower.includes("enoent")
    ) {
      return new TextGenerationError({
        operation,
        detail: `${cliLabel(cliName)} is required but not available on PATH.`,
        cause: error,
      });
    }
    return new TextGenerationError({
      operation,
      detail: fallback,
      cause: error,
    });
  }

  return new TextGenerationError({
    operation,
    detail: fallback,
    cause: error,
  });
}
