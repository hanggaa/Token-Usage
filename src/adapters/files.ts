import { readdir } from "node:fs/promises";
import { join } from "node:path";

export async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return files;
  }

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(root, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await walkFiles(fullPath)));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    })
  );
  return files.toSorted();
}

