/**
 * Crash journal for the mutation probe.
 *
 * Signal handlers cover SIGINT and SIGTERM. They do not cover SIGKILL, a power
 * cut, or a parent process that kills its child on a timeout — and that is not
 * hypothetical: a screen-capture tool SIGKILLed canfail mid-probe while building
 * this repo's README images, and a mutated fixture reached a commit. The
 * in-process FileGuard cannot prevent that, because there is no in-process
 * anything after SIGKILL.
 *
 * So before a file is mutated, its original bytes are copied to a backup and
 * recorded in a journal on disk. Any later run reads the journal first and puts
 * the tree back before doing anything else.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const JOURNAL_FILE = ".canfail-journal.json";

export interface JournalEntry {
  /** Absolute path of the file that was mutated. */
  file: string;
  /** Absolute path of the untouched copy. */
  backup: string;
}

interface JournalDoc {
  pid: number;
  startedAt: string;
  entries: JournalEntry[];
}

export class Journal {
  private readonly path: string;
  private readonly backupDir: string;
  private readonly entries = new Map<string, JournalEntry>();

  constructor(
    private readonly root: string,
    private readonly now: string,
  ) {
    this.path = join(root, JOURNAL_FILE);
    this.backupDir = join(root, ".canfail-backup");
  }

  /** Copy the original bytes aside and record it, before the file is touched. */
  protect(file: string): void {
    if (this.entries.has(file)) return;
    mkdirSync(this.backupDir, { recursive: true });
    const backup = join(this.backupDir, `${this.entries.size}-${file.split("/").pop()}`);
    copyFileSync(file, backup);
    this.entries.set(file, { file, backup });
    this.flush();
  }

  private flush(): void {
    const doc: JournalDoc = {
      pid: process.pid,
      startedAt: this.now,
      entries: [...this.entries.values()],
    };
    writeFileSync(this.path, JSON.stringify(doc, null, 2), "utf8");
  }

  /** Called once the in-process restore has succeeded and the tree is clean. */
  clear(): void {
    this.entries.clear();
    rmSync(this.path, { force: true });
    rmSync(this.backupDir, { recursive: true, force: true });
  }
}

export interface RecoveryResult {
  recovered: string[];
  failed: string[];
}

/**
 * Restore anything a previous run left mutated. Safe to call when no journal
 * exists, which is the normal case.
 */
export function recoverFromJournal(root: string): RecoveryResult {
  const path = join(root, JOURNAL_FILE);
  const result: RecoveryResult = { recovered: [], failed: [] };
  if (!existsSync(path)) return result;

  let doc: JournalDoc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8")) as JournalDoc;
  } catch {
    result.failed.push(path);
    return result;
  }

  for (const entry of doc.entries ?? []) {
    try {
      if (!existsSync(entry.backup)) {
        result.failed.push(entry.file);
        continue;
      }
      const original = readFileSync(entry.backup, "utf8");
      if (!existsSync(entry.file) || readFileSync(entry.file, "utf8") !== original) {
        writeFileSync(entry.file, original, "utf8");
        result.recovered.push(entry.file);
      }
    } catch {
      result.failed.push(entry.file);
    }
  }

  if (result.failed.length === 0) {
    rmSync(path, { force: true });
    rmSync(join(root, ".canfail-backup"), { recursive: true, force: true });
  }
  return result;
}
