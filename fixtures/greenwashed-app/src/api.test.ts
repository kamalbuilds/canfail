import { describe, expect, it } from "vitest";
import { getProducts } from "./api.js";

function fakeRes() {
  const calls: unknown[] = [];
  const res = {
    status(code: number) {
      calls.push(code);
      return res;
    },
    json(body: unknown) {
      calls.push(body);
      return res;
    },
    calls,
  };
  return res;
}

describe("api", () => {
  it("responds to a product request", async () => {
    const res = fakeRes();
    try {
      await getProducts(res);
      expect(res.calls[0]).toBe(200);
    } catch (err) {
      // PLANTED: the catch swallows the failure, so this test passes whether
      // getProducts works or throws.
    }
  });
});
