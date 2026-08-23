/**
 * File snapshot/restore. Requirement 3.5: the working tree must be byte-identical
 * after a probe run, on every path including crash and timeout.
 */
import { readFileSync, writeFileSync } from "node:fs";

export class FileGuard {
  private readonly snapshots = new Map<string, string>();

  /**
   * Optional on-disk journal. In-process state cannot survive SIGKILL, so the
   * journal is what makes a killed run recoverable by the next one.
   */
  constructor(private readonly journal?: { protect(file: string): void; clear(): void }) {}

  snapshot(file: string): string {
    if (!this.snapshots.has(file)) {
      this.snapshots.set(file, readFileSync(file, "utf8"));
    }
    return this.snapshots.get(file)!;
  }

  write(file: string, content: string): void {
    this.snapshot(file);
    this.journal?.protect(file); // must happen before the file changes
    writeFileSync(file, content, "utf8");
  }

  restore(file: string): void {
    const original = this.snapshots.get(file);
    if (original === undefined) return;
    writeFileSync(file, original, "utf8");
  }

  restoreAll(): void {
    for (const file of this.snapshots.keys()) this.restore(file);
  }

  /** True when every guarded file currently matches its snapshot. */
  verifyClean(): boolean {
    for (const [file, original] of this.snapshots) {
      if (readFileSync(file, "utf8") !== original) return false;
    }
    return true;
  }

  /** Drop the journal once the tree is verified clean. */
  releaseJournal(): void {
    this.journal?.clear();
  }
}

/**
 * Install last-resort handlers so an interrupted run does not leave mutated source
 * on disk. Returns a disposer.
 */
export function guardProcess(guard: FileGuard): () => void {
  const handler = () => {
    guard.restoreAll();
    process.exit(130);
  };
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
  const onError = (err: unknown) => {
    guard.restoreAll();
    throw err;
  };
  process.on("uncaughtException", onError);
  return () => {
    process.off("SIGINT", handler);
    process.off("SIGTERM", handler);
    process.off("uncaughtException", onError);
  };
}
