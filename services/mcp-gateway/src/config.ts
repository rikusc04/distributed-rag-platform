// Runtime configuration for the MCP gateway.
// Loaded from env, validated with zod, frozen and passed around read-only.

import { z } from "zod";

const ConfigSchema = z.object({
  awsRegion: z.string().min(1),
  dbHost: z.string().min(1),
  dbPort: z.coerce.number().int().positive().default(5432),
  dbName: z.string().min(1),
  dbUser: z.string().min(1),
  dbPassword: z.string().min(1),
  redisUrl: z.string().url(),
  openaiApiKey: z.string().min(1),
  openaiEmbedModel: z.string().default("text-embedding-3-small"),
  openaiChatModel: z.string().default("gpt-4o-mini"),
  embedDim: z.coerce.number().int().positive().default(1536),
  cacheThreshold: z.coerce.number().min(0).max(1).default(0.95),
  cacheMaxEntries: z.coerce.number().int().positive().default(500),
  cacheTtlSeconds: z.coerce.number().int().positive().default(3600),
  listenPort: z.coerce.number().int().positive().default(8080),
  metricsPort: z.coerce.number().int().positive().default(9090),
  logLevel: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const parsed = ConfigSchema.safeParse({
    awsRegion: process.env.AWS_REGION ?? "us-east-1",
    dbHost: process.env.DB_HOST,
    dbPort: process.env.DB_PORT,
    dbName: process.env.DB_NAME,
    dbUser: process.env.DB_USER,
    dbPassword: process.env.DB_PASSWORD,
    redisUrl: process.env.REDIS_URL,
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiEmbedModel: process.env.OPENAI_EMBED_MODEL,
    openaiChatModel: process.env.OPENAI_CHAT_MODEL,
    embedDim: process.env.EMBED_DIM,
    cacheThreshold: process.env.CACHE_THRESHOLD,
    cacheMaxEntries: process.env.CACHE_MAX_ENTRIES,
    cacheTtlSeconds: process.env.CACHE_TTL_SECONDS,
    listenPort: process.env.LISTEN_PORT,
    metricsPort: process.env.METRICS_PORT,
    logLevel: process.env.LOG_LEVEL,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`invalid config: ${issues}`);
  }
  return Object.freeze(parsed.data);
}
