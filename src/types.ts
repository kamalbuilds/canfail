/**
 * Data model for canfail.
 * Mirrors .kiro/specs/vacuity-detection/design.md ("Data Model").
 */
import { createHash } from "node:crypto";

export type DetectorKind = "VACUOUS" | "SURVIVED" | "MOCK" | "SILENT";

export type VacuousSubtype =
  | "no-assertion"
  | "tautological"
  | "empty-catch"
  | "skipped"
  | "snapshot-only"
  | "unreachable-assertion";

export type MockSubtype = "identifier" | "hardcoded-sample";

export type SilentSubtype = "success-on-error" | "health-check-swallow" | "empty-success";

export type MutationKind =
  | "comparison-swap"
  | "boolean-flip"
  | "return-sentinel"
  | "conditional-negation";

export interface Location {
  file: string;
  line: number;
  column: number;
}

export interface MutantDescriptor {
  mutation: MutationKind;
  originalText: string;
  mutatedText: string;
  sourceFile: string;
  sourceLine: number;
}

export interface Finding {
  id: string;
  kind: DetectorKind;
  subtype?: VacuousSubtype | MockSubtype | SilentSubtype;
  location: Location;
  message: string;
  chain?: string[];
  mutant?: MutantDescriptor;
  suppressed: boolean;
}

export interface Summary {
  total: number;
  byKind: Record<DetectorKind, number>;
  suppressed: number;
}

export interface CanfailReport {
  version: string;
  timestamp: string;
  summary: Summary;
  findings: Finding[];
}

/** Deterministic id so two runs over unchanged code produce identical reports. */
export function findingId(kind: DetectorKind, file: string, line: number, extra = ""): string {
  return createHash("sha1").update(`${kind}:${file}:${line}:${extra}`).digest("hex").slice(0, 12);
}

export function summarize(findings: Finding[]): Summary {
  const byKind: Record<DetectorKind, number> = { VACUOUS: 0, SURVIVED: 0, MOCK: 0, SILENT: 0 };
  let suppressed = 0;
  for (const f of findings) {
    if (f.suppressed) {
      suppressed += 1;
      continue;
    }
    byKind[f.kind] += 1;
  }
  const total = Object.values(byKind).reduce((a, b) => a + b, 0);
  return { total, byKind, suppressed };
}
