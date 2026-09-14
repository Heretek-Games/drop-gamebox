import { createHash } from "node:crypto";

export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export interface GameFingerprint {
  executableHash: string;
  relativeFilePath: string;
  fileSizeBytes: number;
  directoryStructureHash?: string;
}

export interface DirectoryFileEntry {
  relativePath: string;
  fileHash: string;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function comparePaths(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

export function normalizeSha256Hex(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return SHA256_HEX_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeRelativePath(relativePath: string): string {
  if (typeof relativePath !== "string") {
    throw new TypeError("relativePath must be a string");
  }
  const segments = relativePath
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");
  if (segments.includes("..")) {
    throw new Error("relativePath must not contain '..' segments");
  }
  if (segments.length === 0) {
    throw new Error("relativePath must not be empty");
  }
  return segments.join("/");
}

export function computeDirectoryStructureHash(
  entries: readonly DirectoryFileEntry[],
): string {
  const sorted = entries
    .map((entry) => {
      const fileHash = normalizeSha256Hex(entry.fileHash);
      if (!fileHash) {
        throw new Error(
          `fileHash for '${entry.relativePath}' must be a 64-character hex SHA-256 digest`,
        );
      }
      return {
        path: normalizeRelativePath(entry.relativePath),
        fileHash,
      };
    })
    .sort((a, b) => comparePaths(a.path, b.path));

  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].path === sorted[i - 1].path) {
      throw new Error(`duplicate relativePath: ${sorted[i].path}`);
    }
  }

  let level = sorted.map(({ path, fileHash }) =>
    sha256Hex(`${path}\0${fileHash}`),
  );
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(
        i + 1 < level.length
          ? sha256Hex(`${level[i]}${level[i + 1]}`)
          : level[i],
      );
    }
    level = next;
  }
  return level[0] ?? sha256Hex("");
}

/**
 * Compute SHA-256 fingerprint from buffer.
 */
export function computeBinaryFingerprint(
  buffer: Buffer,
  relativeFilePath: string,
): GameFingerprint {
  const hash = createHash("sha256").update(buffer).digest("hex");
  return {
    executableHash: hash,
    relativeFilePath,
    fileSizeBytes: buffer.length,
  };
}
