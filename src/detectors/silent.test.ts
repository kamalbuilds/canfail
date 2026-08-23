import { describe, expect, it } from "vitest";
import { detectSilent } from "./silent.js";

const at = (code: string) => detectSilent("/virtual/service.ts", code);

describe("SILENT detector", () => {
  it("flags a health check that returns ok:true from inside a catch", () => {
    const findings = at(`
      export async function healthCheck() {
        try {
          await db.ping();
        } catch {
          return { ok: true, checks: {} };
        }
        return { ok: true, checks: {} };
      }
    `);
    const hit = findings.find((f) => f.subtype === "health-check-swallow");
    expect(hit).toBeDefined();
    expect(hit!.message).toContain("healthCheck");
  });

  it("does not flag a health check that reports the failure", () => {
    const findings = at(`
      export async function healthCheck() {
        try {
          await db.ping();
          return { ok: true };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      }
    `);
    expect(findings).toHaveLength(0);
  });

  it("flags a non-health function returning true from a catch", () => {
    const findings = at(`
      export function saveOrder(order) {
        try {
          return persist(order);
        } catch {
          return true;
        }
      }
    `);
    expect(findings.map((f) => f.subtype)).toContain("success-on-error");
  });

  it("flags an HTTP 200 carrying an empty body", () => {
    const findings = at(`
      export async function getProducts(res) {
        try {
          return res.status(200).json(await load());
        } catch {
          res.status(200).json([]);
          return;
        }
      }
    `);
    const hit = findings.find((f) => f.subtype === "empty-success");
    expect(hit).toBeDefined();
    expect(hit!.message).toContain("indistinguishable");
  });

  it("does not flag an HTTP 200 carrying a real payload", () => {
    const findings = at(`
      export async function getProducts(res) {
        const products = await load();
        res.status(200).json(products);
      }
    `);
    expect(findings.filter((f) => f.subtype === "empty-success")).toHaveLength(0);
  });

  it("flags a catch that discards the error entirely", () => {
    const findings = at(`
      export function sync() {
        try {
          push();
        } catch (err) {
        }
      }
    `);
    expect(findings.map((f) => f.subtype)).toContain("success-on-error");
  });

  it("does not flag a catch that logs and rethrows", () => {
    const findings = at(`
      export function sync() {
        try {
          push();
        } catch (err) {
          console.error(err);
          throw err;
        }
      }
    `);
    expect(findings).toHaveLength(0);
  });
});
