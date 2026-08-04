import type { AntigravityCliStepRow } from "../../src/adapters/antigravity-cli.js";

export interface UsageFixture {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  thinkingOutputTokens?: number;
  responseOutputTokens?: number;
  model?: number;
  provider?: number;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

function varint(value: number | bigint): Uint8Array {
  let remaining = BigInt(value);
  const bytes: number[] = [];
  do {
    const next = Number(remaining & 0x7fn);
    remaining >>= 7n;
    bytes.push(next | (remaining > 0n ? 0x80 : 0));
  } while (remaining > 0n);
  return Uint8Array.from(bytes);
}

function fieldKey(number: number, wireType: number): Uint8Array {
  return varint(BigInt((number << 3) | wireType));
}

function varintField(number: number, value: number | bigint): Uint8Array {
  return concat(fieldKey(number, 0), varint(value));
}

function bytesField(number: number, value: Uint8Array): Uint8Array {
  return concat(fieldKey(number, 2), varint(value.byteLength), value);
}

function stringField(number: number, value: string): Uint8Array {
  return bytesField(number, new TextEncoder().encode(value));
}

function timestamp(value: string): Uint8Array {
  const milliseconds = new Date(value).valueOf();
  const seconds = Math.floor(milliseconds / 1_000);
  const nanoseconds = (milliseconds - seconds * 1_000) * 1_000_000;
  return concat(varintField(1, seconds), varintField(2, nanoseconds));
}

function usage(value: UsageFixture): Uint8Array {
  return concat(
    varintField(1, value.model ?? 0),
    varintField(2, value.inputTokens),
    varintField(3, value.outputTokens),
    varintField(4, value.cacheWriteTokens ?? 0),
    varintField(5, value.cacheReadTokens ?? 0),
    varintField(6, value.provider ?? 0),
    varintField(9, value.thinkingOutputTokens ?? 0),
    varintField(10, value.responseOutputTokens ?? 0)
  );
}

function metadata(timestampValue: string | undefined, usages: UsageFixture[]): Uint8Array {
  return concat(
    ...(timestampValue ? [bytesField(1, timestamp(timestampValue))] : []),
    ...usages.map((value) => bytesField(9, usage(value)))
  );
}

function step(
  idx: number,
  stepType: number,
  status: number,
  stepMetadata: Uint8Array,
  payloadField: number,
  payload: Uint8Array
): AntigravityCliStepRow {
  return {
    idx,
    stepType,
    status,
    metadata: stepMetadata,
    stepPayload: concat(
      varintField(1, stepType),
      varintField(4, status),
      bytesField(5, stepMetadata),
      bytesField(payloadField, payload)
    )
  };
}

export function userStep(
  idx: number,
  prompt: string,
  timestampValue: string
): AntigravityCliStepRow {
  const stepMetadata = metadata(timestampValue, []);
  return step(idx, 14, 3, stepMetadata, 19, stringField(2, prompt));
}

export function userStepWithoutTimestamp(
  idx: number,
  prompt: string
): AntigravityCliStepRow {
  const stepMetadata = metadata(undefined, []);
  return step(idx, 14, 3, stepMetadata, 19, stringField(2, prompt));
}

export function completedStep(
  idx: number,
  stepType: number,
  timestampValue?: string
): AntigravityCliStepRow {
  const stepMetadata = metadata(timestampValue, []);
  return step(idx, stepType, 3, stepMetadata, 21, new Uint8Array());
}

export function plannerStep(
  idx: number,
  response: string,
  usageValue: UsageFixture,
  timestampValue?: string
): AntigravityCliStepRow {
  return plannerStepWithUsages(idx, response, [usageValue], timestampValue);
}

export function plannerStepWithUsages(
  idx: number,
  response: string,
  usages: UsageFixture[],
  timestampValue?: string
): AntigravityCliStepRow {
  const stepMetadata = metadata(timestampValue, usages);
  return step(idx, 15, 3, stepMetadata, 20, stringField(8, response));
}

export function plannerStepWithoutUsage(
  idx: number,
  response: string,
  timestampValue?: string
): AntigravityCliStepRow {
  return plannerStepWithUsages(idx, response, [], timestampValue);
}

export function plannerStepWithOriginalResponse(
  idx: number,
  response: string,
  usageValue: UsageFixture
): AntigravityCliStepRow {
  const stepMetadata = metadata(undefined, [usageValue]);
  return step(idx, 15, 3, stepMetadata, 20, stringField(3, response));
}

export function withUnknownField(row: AntigravityCliStepRow): AntigravityCliStepRow {
  return {
    ...row,
    stepPayload: concat(row.stepPayload, varintField(99, 7))
  };
}
