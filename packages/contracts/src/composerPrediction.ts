import * as Schema from "effect/Schema";

import { MessageId, ThreadId } from "./baseSchemas.ts";

export const ComposerPredictNextMessageInput = Schema.Struct({
  threadId: ThreadId,
  assistantMessageId: MessageId,
});
export type ComposerPredictNextMessageInput = typeof ComposerPredictNextMessageInput.Type;

export const ComposerPredictNextMessageResult = Schema.Struct({
  prediction: Schema.NullOr(Schema.String),
});
export type ComposerPredictNextMessageResult = typeof ComposerPredictNextMessageResult.Type;
