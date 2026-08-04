import { describe, expect, it } from "vitest";
import {
  allBytesValues,
  bytesValue,
  decodeProtobufMessage,
  utf8Value,
  varintValue
} from "../../src/adapters/protobuf-wire.js";

function varint(value: bigint): Uint8Array {
  const bytes: number[] = [];
  let remaining = value;
  do {
    const next = Number(remaining & 0x7fn);
    remaining >>= 7n;
    bytes.push(next | (remaining > 0n ? 0x80 : 0));
  } while (remaining > 0n);
  return Uint8Array.from(bytes);
}

function field(number: number, wireType: number, value: Uint8Array): Uint8Array {
  return Uint8Array.from([...varint(BigInt((number << 3) | wireType)), ...value]);
}

describe("decodeProtobufMessage", () => {
  it("decodes varint, fixed, bytes, and repeated fields while preserving unknowns", () => {
    const text = new TextEncoder().encode("hello");
    const message = Uint8Array.from([
      ...field(1, 0, varint(150n)),
      ...field(2, 2, Uint8Array.from([...varint(BigInt(text.length)), ...text])),
      ...field(2, 2, Uint8Array.from([...varint(1n), 0x78])),
      ...field(99, 5, Uint8Array.from([1, 2, 3, 4]))
    ]);
    const fields = decodeProtobufMessage(message);

    expect(varintValue(fields, 1)).toBe(150n);
    expect(utf8Value(fields, 2)).toBe("hello");
    expect(allBytesValues(fields, 2)).toHaveLength(2);
    expect(bytesValue(fields, 2)).toEqual(text);
    expect(fields.some((item) => item.number === 99 && item.wireType === 5)).toBe(true);
  });

  it.each([
    Uint8Array.from([0x00]),
    Uint8Array.from([0x0f]),
    Uint8Array.from([0x12, 0x05, 0x61]),
    Uint8Array.from([0x09, 1, 2, 3]),
    Uint8Array.from([0x08, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x00])
  ])("rejects malformed protobuf bytes", (message) => {
    expect(() => decodeProtobufMessage(message)).toThrow();
  });

  it("rejects input that exceeds the configured maximum length", () => {
    expect(() => decodeProtobufMessage(Uint8Array.from([0x08, 0x01]), 1)).toThrow();
  });

  it("decodes a complete fixed64 field", () => {
    const fixed64 = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);

    expect(decodeProtobufMessage(field(7, 1, fixed64))).toEqual([
      { number: 7, wireType: 1, value: fixed64 }
    ]);
  });

  it("rejects a terminating tenth varint byte greater than one", () => {
    const outOfRangeUint64 = Uint8Array.from([
      0x08,
      0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80,
      0x02
    ]);

    expect(() => decodeProtobufMessage(outOfRangeUint64)).toThrow(/varint|uint64/i);
  });

  it("reports the byte offset for unsupported wire types", () => {
    expect(() => decodeProtobufMessage(Uint8Array.from([0x0b]))).toThrow("byte offset 0");
  });
});
