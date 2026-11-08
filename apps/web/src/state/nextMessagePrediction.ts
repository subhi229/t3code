import { createNextMessagePredictionAtoms } from "@t3tools/client-runtime/state/next-message-prediction";

import { connectionAtomRuntime } from "../connection/runtime";

export const nextMessagePrediction = createNextMessagePredictionAtoms(connectionAtomRuntime);
