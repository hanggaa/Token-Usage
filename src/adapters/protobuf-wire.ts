export type ProtobufWireType = 0 | 1 | 2 | 5;

export interface ProtobufField {
  number: number;
  wireType: ProtobufWireType;
  value: bigint | Uint8Array;
}

const DEFAULT_MAXIMUM_LENGTH = 64 * 1024 * 1024;
const MAXIMUM_FIELD_NUMBER = 536_870_911;

interface VarintResult {
  value: bigint;
  offset: number;
}

function readVarint(bytes: Uint8Array, offset: number): VarintResult {
  let value = 0n;

  for (let index = 0; index < 10; index += 1) {
    if (offset >= bytes.length) {
      throw new Error(`Truncated protobuf varint at byte offset ${offset}`);
    }

    const byte = bytes[offset];
    offset += 1;
    value |= BigInt(byte & 0x7f) << BigInt(index * 7);

    if ((byte & 0x80) === 0) {
      return { value, offset };
    }
  }

  throw new Error(`Protobuf varint exceeds ten bytes at byte offset ${offset - 10}`);
}

function readFixed(bytes: Uint8Array, offset: number, length: number): Uint8Array {
  if (length > bytes.length - offset) {
    throw new Error(`Truncated protobuf field at byte offset ${offset}`);
  }

  return bytes.slice(offset, offset + length);
}

export function decodeProtobufMessage(
  bytes: Uint8Array,
  maximumLength = DEFAULT_MAXIMUM_LENGTH
): ProtobufField[] {
  if (!Number.isSafeInteger(maximumLength) || maximumLength < 0) {
    throw new Error("Protobuf maximum length must be a non-negative safe integer");
  }
  if (bytes.length > maximumLength) {
    throw new Error(`Protobuf message exceeds maximum length of ${maximumLength} bytes`);
  }

  const fields: ProtobufField[] = [];
  let offset = 0;

  while (offset < bytes.length) {
    const fieldOffset = offset;
    const key = readVarint(bytes, offset);
    offset = key.offset;

    const number = key.value >> 3n;
    const wireType = Number(key.value & 0x07n);
    if (number === 0n || number > BigInt(MAXIMUM_FIELD_NUMBER)) {
      throw new Error(`Invalid protobuf field number at byte offset ${fieldOffset}`);
    }

    switch (wireType) {
      case 0: {
        const value = readVarint(bytes, offset);
        fields.push({ number: Number(number), wireType, value: value.value });
        offset = value.offset;
        break;
      }
      case 1:
        fields.push({ number: Number(number), wireType, value: readFixed(bytes, offset, 8) });
        offset += 8;
        break;
      case 2: {
        const length = readVarint(bytes, offset);
        offset = length.offset;
        const remaining = bytes.length - offset;
        if (length.value > BigInt(remaining)) {
          throw new Error(`Truncated protobuf bytes field at byte offset ${offset}`);
        }
        const valueLength = Number(length.value);
        fields.push({ number: Number(number), wireType, value: readFixed(bytes, offset, valueLength) });
        offset += valueLength;
        break;
      }
      case 5:
        fields.push({ number: Number(number), wireType, value: readFixed(bytes, offset, 4) });
        offset += 4;
        break;
      default:
        throw new Error(`Unsupported protobuf wire type ${wireType} at byte offset ${fieldOffset}`);
    }
  }

  return fields;
}

export function varintValue(fields: ProtobufField[], number: number): bigint | null {
  const field = fields.find((item) => item.number === number && item.wireType === 0);
  return typeof field?.value === "bigint" ? field.value : null;
}

export function allBytesValues(fields: ProtobufField[], number: number): Uint8Array[] {
  return fields
    .filter((item) => item.number === number && item.wireType === 2)
    .map((item) => item.value)
    .filter((value): value is Uint8Array => value instanceof Uint8Array);
}

export function bytesValue(fields: ProtobufField[], number: number): Uint8Array | null {
  return allBytesValues(fields, number)[0] ?? null;
}

export function utf8Value(fields: ProtobufField[], number: number): string | null {
  const value = bytesValue(fields, number);
  return value ? new TextDecoder("utf-8", { fatal: true }).decode(value) : null;
}
