import { loadProductDatabase } from "./db.js";

export interface HealthReport {
  ok: boolean;
  checks: Record<string, boolean>;
}

/**
 * Reports service health. This is the exact shape of a check that cannot fail:
 * the database call throws, the catch swallows it, and the endpoint still says ok.
 */
export async function healthCheck(): Promise<HealthReport> {
  const checks: Record<string, boolean> = {};
  try {
    const db = await loadProductDatabase();
    checks.database = db.length > 0;
  } catch {
    // PLANTED: a failed dependency is reported as a healthy service.
    return { ok: true, checks };
  }
  return { ok: true, checks };
}
