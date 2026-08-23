/**
 * Language detection for `canfail prove`.
 *
 * The UNEARNED invariant — a new test must fail against the base revision — needs
 * only three things: git history, a way to recognise a test file, and a command
 * that exits non-zero when tests fail. None of that is TypeScript-specific, so
 * prove works in any language whose tests live in their own files.
 *
 * The AST detectors (VACUOUS, MOCK, SILENT) and the mutation probe are TypeScript
 * and JavaScript only, and are not covered by this module.
 */
export type Language = "ts" | "js" | "go" | "python" | "rust" | "ruby" | "java" | "unknown";

interface LanguageSpec {
  /** Source file extensions. */
  ext: RegExp;
  /** Files that contain tests. */
  test: RegExp;
  /** Conventional command that runs the suite, for documentation and --help. */
  testCommand: string;
  /**
   * True when this language conventionally puts tests inside the source file it
   * tests. Reverting the source then removes the test too, so the invariant
   * cannot be checked for that file.
   */
  inlineTests?: RegExp;
}

const SPECS: Record<Exclude<Language, "unknown">, LanguageSpec> = {
  ts: {
    ext: /\.(ts|tsx|mts|cts)$/,
    test: /\.(test|spec)\.(ts|tsx|mts|cts)$/,
    testCommand: "npx vitest run",
  },
  js: {
    ext: /\.(js|jsx|mjs|cjs)$/,
    test: /\.(test|spec)\.(js|jsx|mjs|cjs)$/,
    testCommand: "npx vitest run",
  },
  go: {
    ext: /\.go$/,
    test: /_test\.go$/,
    testCommand: "go test ./{dir}",
  },
  python: {
    ext: /\.py$/,
    test: /(^|\/)(test_[^/]+|[^/]+_test)\.py$/,
    testCommand: "python -m pytest {file}",
  },
  rust: {
    ext: /\.rs$/,
    // Only integration tests under tests/ live in their own file. Unit tests in
    // Rust are `#[cfg(test)] mod tests` inside the source file being tested.
    test: /(^|\/)tests\/[^/]+\.rs$/,
    testCommand: "cargo test",
    inlineTests: /\.rs$/,
  },
  ruby: {
    ext: /\.rb$/,
    test: /(^|\/)[^/]+_(spec|test)\.rb$/,
    testCommand: "bundle exec rspec {file}",
  },
  java: {
    ext: /\.java$/,
    test: /(^|\/)[^/]*Test[^/]*\.java$/,
    testCommand: "mvn -q test",
  },
};

export const LANGUAGES = Object.keys(SPECS) as Exclude<Language, "unknown">[];

export function detectLanguage(file: string): Language {
  const path = file.replace(/\\/g, "/");
  for (const lang of LANGUAGES) {
    if (SPECS[lang].ext.test(path)) return lang;
  }
  return "unknown";
}

/** Is this a test file in any supported language? */
export function isTestFileAnyLanguage(file: string): boolean {
  const path = file.replace(/\\/g, "/");
  const lang = detectLanguage(path);
  if (lang === "unknown") return false;
  return SPECS[lang].test.test(path);
}

export function conventionalTestCommand(lang: Language): string | undefined {
  return lang === "unknown" ? undefined : SPECS[lang].testCommand;
}

/**
 * A source file whose tests live inside it cannot be checked: reverting the file
 * to its base revision deletes the very test being evaluated.
 */
export function hasInlineTests(file: string): boolean {
  const lang = detectLanguage(file);
  if (lang === "unknown") return false;
  const spec = SPECS[lang];
  if (!spec.inlineTests) return false;
  // A file that matches the language's separate-test-file pattern is fine.
  if (spec.test.test(file.replace(/\\/g, "/"))) return false;
  return spec.inlineTests.test(file);
}

/**
 * Which changed sources should be reverted for a given test file.
 *
 * TypeScript and JavaScript get import-closure scoping, so unrelated changes stay
 * in place. Every other language reverts the whole changed surface of the same
 * language, which is the stricter reading of the invariant: the test must fail
 * against the base revision of the change as a whole.
 */
export function scopeStrategy(testFile: string): "import-closure" | "same-language" {
  const lang = detectLanguage(testFile);
  return lang === "ts" || lang === "js" ? "import-closure" : "same-language";
}
