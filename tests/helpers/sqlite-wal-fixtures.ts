export interface WalFrameFixture {
  pageNumber: number;
  committedPageCount: number;
  page: Uint8Array;
}

const WAL_HEADER_BYTES = 32;
const WAL_FRAME_HEADER_BYTES = 24;
const WAL_MAGIC_LITTLE_CHECKSUM = 0x377f0682;
const WAL_VERSION = 3_007_000;
const WAL_SALT_1 = 0x11223344;
const WAL_SALT_2 = 0x55667788;
const SQLITE_HEADER = new TextEncoder().encode("SQLite format 3\0");

export interface WalFileOptions {
  salt1?: number;
  salt2?: number;
}

function checksum(
  bytes: Uint8Array,
  length: number,
  initialS1 = 0,
  initialS2 = 0
): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let s1 = initialS1;
  let s2 = initialS2;

  for (let offset = 0; offset < length; offset += 8) {
    const word0 = view.getUint32(offset, true);
    const word1 = view.getUint32(offset + 4, true);
    s1 = (s1 + word0 + s2) >>> 0;
    s2 = (s2 + word1 + s1) >>> 0;
  }

  return [s1, s2];
}

export function page(pageNumber: number, fill: number, pageSize = 1_024): Uint8Array {
  const bytes = new Uint8Array(pageSize).fill(fill);
  if (pageNumber === 1) {
    bytes.set(SQLITE_HEADER, 0);
    const encodedPageSize = pageSize === 65_536 ? 1 : pageSize;
    new DataView(bytes.buffer).setUint16(16, encodedPageSize, false);
  }
  return bytes;
}

export function databaseWithPages(pages: Uint8Array[]): Uint8Array {
  const byteLength = pages.reduce((total, value) => total + value.byteLength, 0);
  const database = new Uint8Array(byteLength);
  let offset = 0;
  for (const value of pages) {
    database.set(value, offset);
    offset += value.byteLength;
  }
  return database;
}

export function frame(
  pageNumber: number,
  committedPageCount: number,
  pageBytes: Uint8Array
): WalFrameFixture {
  return { pageNumber, committedPageCount, page: pageBytes };
}

export function walFile(
  frames: WalFrameFixture[],
  pageSize = 1_024,
  options: WalFileOptions = {}
): Uint8Array {
  const frameBytes = WAL_FRAME_HEADER_BYTES + pageSize;
  const wal = new Uint8Array(WAL_HEADER_BYTES + frames.length * frameBytes);
  const view = new DataView(wal.buffer);
  const salt1 = options.salt1 ?? WAL_SALT_1;
  const salt2 = options.salt2 ?? WAL_SALT_2;

  view.setUint32(0, WAL_MAGIC_LITTLE_CHECKSUM, false);
  view.setUint32(4, WAL_VERSION, false);
  view.setUint32(8, pageSize, false);
  view.setUint32(12, 0, false);
  view.setUint32(16, salt1, false);
  view.setUint32(20, salt2, false);

  let [s1, s2] = checksum(wal, 24);
  view.setUint32(24, s1, false);
  view.setUint32(28, s2, false);

  frames.forEach((value, index) => {
    if (value.page.byteLength !== pageSize) {
      throw new Error(`WAL fixture page ${index + 1} has the wrong size`);
    }

    const offset = WAL_HEADER_BYTES + index * frameBytes;
    view.setUint32(offset, value.pageNumber, false);
    view.setUint32(offset + 4, value.committedPageCount, false);
    view.setUint32(offset + 8, salt1, false);
    view.setUint32(offset + 12, salt2, false);
    wal.set(value.page, offset + WAL_FRAME_HEADER_BYTES);

    [s1, s2] = checksum(
      wal.subarray(offset, offset + 8),
      8,
      s1,
      s2
    );
    [s1, s2] = checksum(
      wal.subarray(offset + WAL_FRAME_HEADER_BYTES, offset + frameBytes),
      pageSize,
      s1,
      s2
    );
    view.setUint32(offset + 16, s1, false);
    view.setUint32(offset + 20, s2, false);
  });

  return wal;
}

export function byteFromPage(
  database: Uint8Array,
  pageNumber: number,
  pageSize = 1_024
): number {
  return database[(pageNumber - 1) * pageSize + Math.min(100, pageSize - 1)];
}
