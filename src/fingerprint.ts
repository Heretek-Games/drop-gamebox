import { createHash } from "node:crypto";

export interface GameFingerprint {
  executableHash: string;
  relativeFilePath: string;
  fileSizeBytes: number;
  directoryStructureHash?: string;
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
