import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyCommittedWal,
  readSqliteSnapshot,
  type SnapshotIo
} from "../../src/adapters/sqlite-wal-snapshot.js";
import {
  byteFromPage,
  databaseWithPages,
  frame,
  page,
  walFile
} from "../helpers/sqlite-wal-fixtures.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true
  })));
});

describe("applyCommittedWal", () => {
  it("overlays frames only through the last commit and honors committed database size", () => {
    const base = databaseWithPages([page(1, 0x11), page(2, 0x22)]);
    const wal = walFile([
      frame(2, 0, page(2, 0x33)),
      frame(1, 2, page(1, 0x44)),
      frame(2, 0, page(2, 0x55))
    ]);

    const snapshot = applyCommittedWal(base, wal);

    expect(snapshot).toHaveLength(2 * 1_024);
    expect(byteFromPage(snapshot, 1)).toBe(0x44);
    expect(byteFromPage(snapshot, 2)).toBe(0x33);
  });

  it("uses the database size from the final commit and overlays its preceding frames", () => {
    const base = databaseWithPages([page(1, 0x11), page(2, 0x22)]);
    const wal = walFile([
      frame(3, 3, page(3, 0x33)),
      frame(2, 0, page(2, 0x44)),
      frame(1, 2, page(1, 0x55))
    ]);

    const snapshot = applyCommittedWal(base, wal);

    expect(snapshot).toHaveLength(2 * 1_024);
    expect(byteFromPage(snapshot, 1)).toBe(0x55);
    expect(byteFromPage(snapshot, 2)).toBe(0x44);
  });

  it("leaves the database unchanged when the WAL has no committed frame", () => {
    const base = databaseWithPages([page(1, 0x11)]);
    const wal = walFile([frame(1, 0, page(1, 0x22))]);

    expect(applyCommittedWal(base, wal)).toEqual(base);
  });

  it("rejects a checksum mismatch instead of ignoring the WAL", () => {
    const base = databaseWithPages([page(1, 0x11)]);
    const wal = walFile([frame(1, 1, page(1, 0x22))]);
    wal[wal.length - 1] ^= 0xff;

    expect(() => applyCommittedWal(base, wal)).toThrow(/checksum/i);
  });

  it("honors the big-endian checksum magic", () => {
    const base = databaseWithPages([page(1, 0x11)]);
    const wal = walFile([frame(1, 1, page(1, 0x22))]);
    const view = new DataView(wal.buffer);
    view.setUint32(0, 0x377f0683, false);
    view.setUint32(24, 0x2727021b, false);
    view.setUint32(28, 0x2366555c, false);
    view.setUint32(32 + 16, 0x44aa1b28, false);
    view.setUint32(32 + 20, 0x3753ae71, false);

    expect(byteFromPage(applyCommittedWal(base, wal), 1)).toBe(0x22);
  });

  it("rejects a frame whose salt differs from the WAL header", () => {
    const base = databaseWithPages([page(1, 0x11)]);
    const wal = walFile([frame(1, 1, page(1, 0x22))]);
    new DataView(wal.buffer).setUint32(32 + 8, 0x99aabbcc, false);

    expect(() => applyCommittedWal(base, wal)).toThrow(/salt/i);
  });

  it("rejects a WAL with a torn final frame", () => {
    const base = databaseWithPages([page(1, 0x11)]);
    const complete = walFile([frame(1, 1, page(1, 0x22))]);
    const torn = complete.subarray(0, complete.length - 1);

    expect(() => applyCommittedWal(base, torn)).toThrow(/frame|length|truncated/i);
  });

  it("rejects invalid source and WAL headers", () => {
    const invalidDatabase = databaseWithPages([page(1, 0x11)]);
    invalidDatabase[0] ^= 0xff;
    const base = databaseWithPages([page(1, 0x11)]);
    const invalidWal = walFile([frame(1, 1, page(1, 0x22))]);
    invalidWal[0] = 0;

    expect(() => applyCommittedWal(invalidDatabase, invalidWal)).toThrow(/SQLite.*header/i);
    expect(() => applyCommittedWal(base, invalidWal)).toThrow(/WAL.*magic/i);
  });
});

describe("readSqliteSnapshot", () => {
  it("retries one changing read and returns the following stable snapshot", async () => {
    const firstDatabase = databaseWithPages([page(1, 0x11)]);
    const stableDatabase = databaseWithPages([page(1, 0x22)]);
    const io = changingThenStableIo(firstDatabase, stableDatabase);

    const snapshot = await readSqliteSnapshot("/history/state.vscdb", { io });

    expect(byteFromPage(snapshot, 1)).toBe(0x22);
  });

  it("retries when a WAL disappears between its stat and read", async () => {
    const firstDatabase = databaseWithPages([page(1, 0x11)]);
    const stableDatabase = databaseWithPages([page(1, 0x22)]);
    const wal = walFile([frame(1, 1, page(1, 0x33))]);
    let databaseReads = 0;
    let walStats = 0;
    const io: SnapshotIo = {
      async readFile(path) {
        if (path.endsWith("-wal")) {
          const error = new Error("WAL disappeared") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        }
        databaseReads += 1;
        return databaseReads === 1 ? firstDatabase : stableDatabase;
      },
      async stat(path) {
        if (!path.endsWith("-wal")) {
          return { size: stableDatabase.byteLength, mtimeMs: 1 };
        }
        walStats += 1;
        if (walStats === 1) {
          return { size: wal.byteLength, mtimeMs: 1 };
        }
        const error = new Error("WAL missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
    };

    const snapshot = await readSqliteSnapshot("/history/state.vscdb", { io });

    expect(byteFromPage(snapshot, 1)).toBe(0x22);
  });

  it("fails after all three reads change", async () => {
    const database = databaseWithPages([page(1, 0x11)]);
    const io = alwaysChangingIo(database);

    await expect(readSqliteSnapshot("/history/state.vscdb", { io })).rejects.toThrow(
      "SQLite source changed during 3 snapshot attempts"
    );
  });

  it("propagates WAL stat errors other than ENOENT", async () => {
    const database = databaseWithPages([page(1, 0x11)]);
    const io: SnapshotIo = {
      async readFile() {
        return database;
      },
      async stat(path) {
        if (path.endsWith("-wal")) {
          const error = new Error("permission denied") as NodeJS.ErrnoException;
          error.code = "EACCES";
          throw error;
        }
        return { size: database.byteLength, mtimeMs: 1 };
      }
    };

    await expect(readSqliteSnapshot("/history/state.vscdb", { io })).rejects.toMatchObject({
      code: "EACCES"
    });
  });

  it("propagates WAL read errors other than ENOENT", async () => {
    const database = databaseWithPages([page(1, 0x11)]);
    const wal = walFile([frame(1, 1, page(1, 0x22))]);
    const io: SnapshotIo = {
      async readFile(path) {
        if (path.endsWith("-wal")) {
          const error = new Error("permission denied") as NodeJS.ErrnoException;
          error.code = "EACCES";
          throw error;
        }
        return database;
      },
      async stat(path) {
        return path.endsWith("-wal")
          ? { size: wal.byteLength, mtimeMs: 1 }
          : { size: database.byteLength, mtimeMs: 1 };
      }
    };

    await expect(readSqliteSnapshot("/history/state.vscdb", { io })).rejects.toMatchObject({
      code: "EACCES"
    });
  });

  it("reads a real read-only database and WAL without changing either source file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "token-usage-wal-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "state.vscdb");
    const walPath = `${databasePath}-wal`;
    const base = databaseWithPages([page(1, 0x11)]);
    const wal = walFile([frame(1, 1, page(1, 0x22))]);
    await writeFile(databasePath, base);
    await writeFile(walPath, wal);
    await chmod(databasePath, 0o444);
    await chmod(walPath, 0o444);
    const beforeDatabase = await stat(databasePath);
    const beforeWal = await stat(walPath);

    const snapshot = await readSqliteSnapshot(databasePath);

    expect(byteFromPage(snapshot, 1)).toBe(0x22);
    expect(new Uint8Array(await readFile(databasePath))).toEqual(base);
    expect(new Uint8Array(await readFile(walPath))).toEqual(wal);
    await expect(stat(databasePath)).resolves.toMatchObject({
      size: beforeDatabase.size,
      mtimeMs: beforeDatabase.mtimeMs
    });
    await expect(stat(walPath)).resolves.toMatchObject({
      size: beforeWal.size,
      mtimeMs: beforeWal.mtimeMs
    });
  });
});

function changingThenStableIo(
  firstDatabase: Uint8Array,
  stableDatabase: Uint8Array
): SnapshotIo {
  let databaseStatCalls = 0;
  let databaseReadCalls = 0;
  return {
    async readFile(path) {
      if (path.endsWith("-wal")) {
        throw new Error("WAL should not be read when it does not exist");
      }
      databaseReadCalls += 1;
      return databaseReadCalls === 1 ? firstDatabase : stableDatabase;
    },
    async stat(path) {
      if (path.endsWith("-wal")) {
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      databaseStatCalls += 1;
      const mtimeMs = databaseStatCalls === 1 ? 1 : 2;
      return { size: stableDatabase.byteLength, mtimeMs };
    }
  };
}

function alwaysChangingIo(database: Uint8Array): SnapshotIo {
  let databaseStatCalls = 0;
  return {
    async readFile(path) {
      if (path.endsWith("-wal")) {
        throw new Error("WAL should not be read when it does not exist");
      }
      return database;
    },
    async stat(path) {
      if (path.endsWith("-wal")) {
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      databaseStatCalls += 1;
      return { size: database.byteLength, mtimeMs: databaseStatCalls };
    }
  };
}
