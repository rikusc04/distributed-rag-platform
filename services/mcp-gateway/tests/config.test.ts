import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const REQUIRED = {
  DB_HOST: "localhost",
  DB_NAME: "rag",
  DB_USER: "app",
  DB_PASSWORD: "secret",
  REDIS_URL: "redis://localhost:6379",
  OPENAI_API_KEY: "sk-test",
};

describe("loadConfig", () => {
  let snapshot: NodeJS.ProcessEnv;

  beforeEach(() => {
    snapshot = { ...process.env };
    for (const key of Object.keys(REQUIRED)) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = snapshot;
  });

  it("populates defaults when only required vars are set", () => {
    Object.assign(process.env, REQUIRED);
    const cfg = loadConfig();
    expect(cfg.dbHost).toBe("localhost");
    expect(cfg.dbPort).toBe(5432);
    expect(cfg.openaiEmbedModel).toBe("text-embedding-3-small");
    expect(cfg.embedDim).toBe(1536);
    expect(cfg.cacheThreshold).toBe(0.95);
  });

  it("throws when required vars are missing", () => {
    expect(() => loadConfig()).toThrow(/invalid config/);
  });

  it("rejects a non-URL redis URL", () => {
    Object.assign(process.env, REQUIRED, { REDIS_URL: "not-a-url" });
    expect(() => loadConfig()).toThrow(/invalid config/);
  });
});
