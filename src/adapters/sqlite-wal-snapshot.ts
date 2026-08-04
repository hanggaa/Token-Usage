import { readFile, stat } from "node:fs/promises";

const WAL_HEADER_BYTES = 32;
const WAL_FRAME_HEADER_BYTES = 24;
const SQLITE_HEADER = new TextEncoder().encode("SQLite format 3\0");
const WAL_MAGIC_LITTLE_CHECKSUM = 0x377f0682;
const WAL_MAGIC_BIG_CHECKSUM = 0x377f0683;
const WAL_VERSION = 3_007_000;
const DEFAULT_ATTEMPTS = 3;

export interface SnapshotIo {
  readFile(path: string): Promise<Uint8Array>;
  stat(path: string): Promise<{ size: number; mtimeMs: number }>;
}

export interface SqliteSnapshotOptions {
  attempts?: number;
  io?: SnapshotIo;
}

interface WalFrame {
  pageNumber: number;
  page: Uint8Array;
}

const defaultIo: SnapshotIo = {
  readFile,
  stat
};

export function applyCommittedWal(
  databaseBytes: Uint8Array,
  walBytes: Uint8Array
): Uint8Array {
  const pageSize = validateDatabase(databaseBytes);
  const { frames, committedFrameIndex, committedPageCount } = validateWal(
    walBytes,
    pageSize
  );

  if (committedFrameIndex < 0) {
    return databaseBytes.slice();
  }

  const snapshotBytes = committedPageCount * pageSize;
  if (!Number.isSafeInteger(snapshotBytes)) {
    throw new Error("Committed SQLite database size is invalid");
  }

  const snapshot = new Uint8Array(snapshotBytes);
  snapshot.set(databaseBytes.subarray(0, snapshotBytes));

  for (let index = 0; index <= committedFrameIndex; index += 1) {
    const frame = frames[index];
    if (frame.pageNumber > committedPageCount) continue;
    snapshot.set(frame.page, (frame.pageNumber - 1) * pageSize);
  }

  return snapshot;
}

export async function readSqliteSnapshot(
  databasePath: string,
  options: SqliteSnapshotOptions = {}
): Promise<Uint8Array> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("SQLite snapshot attempts must be a positive integer");
  }

  const io = options.io ?? defaultIo;
  const walPath = `${databasePath}-wal`;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const before = await io.stat(databasePath);
    const databaseBytes = await io.readFile(databasePath);
    const walBefore = await optionalStat(walPath, io);
    let walBytes: Uint8Array | null = null;
    if (walBefore) {
      try {
        walBytes = await io.readFile(walPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
    }
    const after = await io.stat(databasePath);
    const walAfter = await optionalStat(walPath, io);

    if (
      sameStat(before, after)
      && sameOptionalStat(walBefore, walAfter)
      && databaseBytes.byteLength === before.size
      && (walBytes === null || walBytes.byteLength === walBefore?.size)
    ) {
      return walBytes === null
        ? databaseBytes
        : applyCommittedWal(databaseBytes, walBytes);
    }
  }

  throw new Error(`SQLite source changed during ${attempts} snapshot attempts`);
}

async function optionalStat(
  path: string,
  io: SnapshotIo
): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    return await io.stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function validateDatabase(database: Uint8Array): number {
  if (
    database.byteLength < 100
    || !SQLITE_HEADER.every((value, index) => database[index] === value)
  ) {
    throw new Error("Invalid SQLite database header");
  }

  const encodedPageSize = new DataView(
    database.buffer,
    database.byteOffset,
    database.byteLength
  ).getUint16(16, false);
  const pageSize = encodedPageSize === 1 ? 65_536 : encodedPageSize;
  validatePageSize(pageSize, "SQLite database");

  if (database.byteLength % pageSize !== 0) {
    throw new Error("SQLite database contains a partial page");
  }

  return pageSize;
}

function validateWal(
  wal: Uint8Array,
  databasePageSize: number
): {
  frames: WalFrame[];
  committedFrameIndex: number;
  committedPageCount: number;
} {
  if (wal.byteLength < WAL_HEADER_BYTES) {
    throw new Error("Invalid SQLite WAL header length");
  }

  const view = new DataView(wal.buffer, wal.byteOffset, wal.byteLength);
  const magic = view.getUint32(0, false);
  if (magic !== WAL_MAGIC_LITTLE_CHECKSUM && magic !== WAL_MAGIC_BIG_CHECKSUM) {
    throw new Error("Invalid SQLite WAL magic");
  }
  if (view.getUint32(4, false) !== WAL_VERSION) {
    throw new Error("Unsupported SQLite WAL version");
  }

  const pageSize = view.getUint32(8, false);
  validatePageSize(pageSize, "SQLite WAL");
  if (pageSize !== databasePageSize) {
    throw new Error("SQLite WAL page size does not match the database");
  }

  const frameBytes = WAL_FRAME_HEADER_BYTES + pageSize;
  if ((wal.byteLength - WAL_HEADER_BYTES) % frameBytes !== 0) {
    throw new Error("SQLite WAL contains a truncated frame");
  }

  const littleEndianChecksum = magic === WAL_MAGIC_LITTLE_CHECKSUM;
  let [s1, s2] = checksum(wal, 0, 24, littleEndianChecksum, 0, 0);
  if (view.getUint32(24, false) !== s1 || view.getUint32(28, false) !== s2) {
    throw new Error("SQLite WAL header checksum mismatch");
  }

  const salt1 = view.getUint32(16, false);
  const salt2 = view.getUint32(20, false);
  const frames: WalFrame[] = [];
  let committedFrameIndex = -1;
  let committedPageCount = 0;

  for (
    let offset = WAL_HEADER_BYTES;
    offset < wal.byteLength;
    offset += frameBytes
  ) {
    const pageNumber = view.getUint32(offset, false);
    if (pageNumber === 0) {
      throw new Error("SQLite WAL frame has an invalid page number");
    }
    if (
      view.getUint32(offset + 8, false) !== salt1
      || view.getUint32(offset + 12, false) !== salt2
    ) {
      throw new Error("SQLite WAL frame salt mismatch");
    }

    [s1, s2] = checksum(wal, offset, 8, littleEndianChecksum, s1, s2);
    [s1, s2] = checksum(
      wal,
      offset + WAL_FRAME_HEADER_BYTES,
      pageSize,
      littleEndianChecksum,
      s1,
      s2
    );
    if (
      view.getUint32(offset + 16, false) !== s1
      || view.getUint32(offset + 20, false) !== s2
    ) {
      throw new Error("SQLite WAL frame checksum mismatch");
    }

    frames.push({
      pageNumber,
      page: wal.subarray(
        offset + WAL_FRAME_HEADER_BYTES,
        offset + frameBytes
      )
    });
    const databaseSize = view.getUint32(offset + 4, false);
    if (databaseSize !== 0) {
      committedFrameIndex = frames.length - 1;
      committedPageCount = databaseSize;
    }
  }

  return { frames, committedFrameIndex, committedPageCount };
}

function checksum(
  bytes: Uint8Array,
  offset: number,
  length: number,
  littleEndian: boolean,
  initialS1: number,
  initialS2: number
): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let s1 = initialS1;
  let s2 = initialS2;

  for (let cursor = offset; cursor < offset + length; cursor += 8) {
    const word0 = view.getUint32(cursor, littleEndian);
    const word1 = view.getUint32(cursor + 4, littleEndian);
    s1 = (s1 + word0 + s2) >>> 0;
    s2 = (s2 + word1 + s1) >>> 0;
  }

  return [s1, s2];
}

function validatePageSize(pageSize: number, source: string): void {
  if (
    pageSize < 512
    || pageSize > 65_536
    || (pageSize & (pageSize - 1)) !== 0
  ) {
    throw new Error(`${source} has an invalid page size`);
  }
}

function sameStat(
  first: { size: number; mtimeMs: number },
  second: { size: number; mtimeMs: number }
): boolean {
  return first.size === second.size && first.mtimeMs === second.mtimeMs;
}

function sameOptionalStat(
  first: { size: number; mtimeMs: number } | null,
  second: { size: number; mtimeMs: number } | null
): boolean {
  return first === null || second === null
    ? first === second
    : sameStat(first, second);
}
