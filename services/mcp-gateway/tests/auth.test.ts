import { describe, expect, it } from "vitest";

import { AuthError, hashApiKey, parseBearer } from "../src/auth.js";

describe("hashApiKey", () => {
  it("is deterministic", () => {
    const a = hashApiKey("sk-abc");
    const b = hashApiKey("sk-abc");
    expect(a).toBe(b);
  });

  it("differs for different inputs", () => {
    expect(hashApiKey("sk-abc")).not.toBe(hashApiKey("sk-abd"));
  });

  it("returns a 64-char hex string", () => {
    expect(hashApiKey("anything")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("parseBearer", () => {
  it("extracts the token from a well-formed header", () => {
    expect(parseBearer("Bearer abc123")).toBe("abc123");
  });

  it("throws on missing header", () => {
    expect(() => parseBearer(undefined)).toThrow(AuthError);
  });

  it("throws on non-Bearer scheme", () => {
    expect(() => parseBearer("Basic abc123")).toThrow(AuthError);
  });

  it("throws on empty token", () => {
    expect(() => parseBearer("Bearer ")).toThrow(AuthError);
  });
});
