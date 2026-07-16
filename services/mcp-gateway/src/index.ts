// MCP gateway entrypoint.
// Exposes tools: search(query, k), ask(question, k), list_sources().

import { Redis } from "ioredis";
import OpenAI from "openai";

import { SemanticCache } from "./cache.js";
import { loadConfig } from "./config.js";
import { makeDb } from "./db.js";
import { Embedder } from "./embedder.js";
import { makeLogger } from "./logger.js";
import { Metrics } from "./metrics.js";
import { startHttpServer, startMetricsServer } from "./server.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const logger = makeLogger(cfg.logLevel);
  const metrics = new Metrics();

  const db = await makeDb(cfg);
  const redis = new Redis(cfg.redisUrl);
  const cache = new SemanticCache(
    redis,
    cfg.cacheThreshold,
    cfg.cacheMaxEntries,
    cfg.cacheTtlSeconds,
  );
  const embedder = new Embedder(cfg.openaiApiKey, cfg.openaiEmbedModel, cfg.embedDim);
  const openai = new OpenAI({ apiKey: cfg.openaiApiKey });

  const deps = { cfg, db, embedder, cache, metrics, openai };

  const metricsServer = startMetricsServer(metrics, logger, cfg.metricsPort);
  const httpServer = await startHttpServer(deps, logger, metrics, cfg.listenPort);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down");
    await httpServer.close();
    await metricsServer.close();
    await redis.quit();
    await db.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
