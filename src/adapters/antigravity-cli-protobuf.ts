import {
  allBytesValues,
  bytesValue,
  decodeProtobufMessage,
  utf8Value,
  varintValue,
  type ProtobufField
} from "./protobuf-wire.js";
import type { AntigravityCliStepRow } from "./antigravity-cli.js";

const DONE_STATUS = 3;
const USER_INPUT_STEP = 14;
const PLANNER_RESPONSE_STEP = 15;
const VIEW_FILE_STEP = 8;
const LIST_DIRECTORY_STEP = 9;
const STEP_METADATA_FIELD = 5;
const USER_INPUT_PAYLOAD_FIELD = 19;
const PLANNER_RESPONSE_PAYLOAD_FIELD = 20;
const CREATED_AT_FIELD = 1;
const MODEL_USAGE_FIELD = 9;
const GENERATOR_MODEL_FIELD = 11;
const USER_RESPONSE_FIELD = 2;
const PLANNER_RESPONSE_FIELD = 3;
const MODIFIED_RESPONSE_FIELD = 8;
const INTERNAL_PLANNER_MARKER_FIELD = 12;

export interface AntigravityCliUsage {
  modelCode: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  providerCode: number | null;
  thinkingOutputTokens: number;
  responseOutputTokens: number;
}

export interface DecodedAntigravityCliStep {
  idx: number;
  stepType: number;
  status: number;
  completed: boolean;
  timestamp: string | null;
  prompt: string | null;
  response: string | null;
  usages: AntigravityCliUsage[];
  toolEvent: AntigravityCliToolEvent | null;
  model: string | null;
  provider: string | null;
}

export type AntigravityCliToolEvent = "view-file" | "list-directory";

function safeNumber(value: bigint, field: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${field} exceeds JavaScript's safe integer range`);
  }
  return Number(value);
}

function optionalNumber(
  fields: ProtobufField[],
  number: number,
  field: string
): number | null {
  const value = varintValue(fields, number);
  return value == null ? null : safeNumber(value, field);
}

function tokenCount(fields: ProtobufField[], number: number, field: string): number {
  return optionalNumber(fields, number, field) ?? 0;
}

function decodeTimestamp(bytes: Uint8Array): string {
  const fields = decodeProtobufMessage(bytes);
  const seconds = varintValue(fields, 1) ?? 0n;
  const nanoseconds = varintValue(fields, 2) ?? 0n;
  if (nanoseconds > 999_999_999n) {
    throw new Error("Antigravity CLI timestamp nanoseconds are out of range");
  }

  const milliseconds = seconds * 1_000n + nanoseconds / 1_000_000n;
  const numericMilliseconds = safeNumber(milliseconds, "Antigravity CLI timestamp");
  const timestamp = new Date(numericMilliseconds);
  if (Number.isNaN(timestamp.valueOf())) {
    throw new Error("Antigravity CLI timestamp is outside the supported date range");
  }
  return timestamp.toISOString();
}

function decodeUsage(bytes: Uint8Array): AntigravityCliUsage {
  const fields = decodeProtobufMessage(bytes);
  return {
    modelCode: optionalNumber(fields, 1, "Antigravity CLI model code"),
    inputTokens: tokenCount(fields, 2, "Antigravity CLI input tokens"),
    outputTokens: tokenCount(fields, 3, "Antigravity CLI output tokens"),
    cacheWriteTokens: tokenCount(fields, 4, "Antigravity CLI cache-write tokens"),
    cacheReadTokens: tokenCount(fields, 5, "Antigravity CLI cache-read tokens"),
    providerCode: optionalNumber(fields, 6, "Antigravity CLI provider code"),
    thinkingOutputTokens: tokenCount(fields, 9, "Antigravity CLI thinking-output tokens"),
    responseOutputTokens: tokenCount(fields, 10, "Antigravity CLI response-output tokens")
  };
}
function providerName(code: number | null): string | null {
  return code === 24 ? "google" : null;
}

function modelName(_code: number | null): string | null {
  return null;
}

export function antigravityCliToolEvent(
  stepType: number
): AntigravityCliToolEvent | null {
  if (stepType === VIEW_FILE_STEP) return "view-file";
  if (stepType === LIST_DIRECTORY_STEP) return "list-directory";
  return null;
}

function requiredBytes(
  fields: ProtobufField[],
  number: number,
  field: string
): Uint8Array {
  const value = bytesValue(fields, number);
  if (!value) {
    throw new Error(`Antigravity CLI ${field} is missing`);
  }
  return value;
}

function decodedResponse(payload: Uint8Array): string | null {
  const fields = decodeProtobufMessage(payload);
  const modified = utf8Value(fields, MODIFIED_RESPONSE_FIELD);
  const original = utf8Value(fields, PLANNER_RESPONSE_FIELD);
  if (modified == null && original == null) {
    const isInternalPlannerRecord =
      varintValue(fields, INTERNAL_PLANNER_MARKER_FIELD) != null;
    if (isInternalPlannerRecord) return null;
    throw new Error("Antigravity CLI planner response content is missing");
  }
  return modified?.trim() ? modified : (original ?? "");
}

export function decodeAntigravityCliStep(
  row: AntigravityCliStepRow
): DecodedAntigravityCliStep {
  const stepFields = decodeProtobufMessage(row.stepPayload);
  const encodedStepType = optionalNumber(stepFields, 1, "Antigravity CLI step type");
  const encodedStatus = optionalNumber(stepFields, 4, "Antigravity CLI step status");
  if (encodedStepType == null || encodedStatus == null) {
    throw new Error("Antigravity CLI step type or status is missing");
  }
  if (encodedStepType !== row.stepType || encodedStatus !== row.status) {
    throw new Error("Antigravity CLI step columns do not match the protobuf payload");
  }

  const metadataBytes = requiredBytes(
    stepFields,
    STEP_METADATA_FIELD,
    "step metadata"
  );
  const metadataFields = decodeProtobufMessage(metadataBytes);
  const timestampBytes = bytesValue(metadataFields, CREATED_AT_FIELD);
  const usages = allBytesValues(metadataFields, MODEL_USAGE_FIELD).map(decodeUsage);
  const generatorModelCode = optionalNumber(
    metadataFields,
    GENERATOR_MODEL_FIELD,
    "Antigravity CLI generator-model code"
  );

  let prompt: string | null = null;
  let response: string | null = null;
  if (encodedStepType === USER_INPUT_STEP) {
    const payload = requiredBytes(
      stepFields,
      USER_INPUT_PAYLOAD_FIELD,
      "user-input payload"
    );
    const fields = decodeProtobufMessage(payload);
    prompt = utf8Value(fields, USER_RESPONSE_FIELD);
    if (prompt == null) {
      throw new Error("Antigravity CLI user response is missing");
    }
  } else if (encodedStepType === PLANNER_RESPONSE_STEP) {
    response = decodedResponse(requiredBytes(
      stepFields,
      PLANNER_RESPONSE_PAYLOAD_FIELD,
      "planner-response payload"
    ));
  }

  const usageModelCode = usages.find((usage) => usage.modelCode != null)?.modelCode ?? null;
  const provider = usages
    .map((usage) => providerName(usage.providerCode))
    .find((value): value is string => value != null) ?? null;

  return {
    idx: row.idx,
    stepType: encodedStepType,
    status: encodedStatus,
    completed: encodedStatus === DONE_STATUS,
    timestamp: timestampBytes ? decodeTimestamp(timestampBytes) : null,
    prompt,
    response,
    usages,
    toolEvent: antigravityCliToolEvent(encodedStepType),
    model: modelName(generatorModelCode ?? usageModelCode),
    provider
  };
}
