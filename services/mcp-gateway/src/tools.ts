// The three MCP tools' business logic, factored out from the transport layer
// so it can be tested independently and reused (Streamable HTTP today, maybe
// stdio for local Claude Desktop later).

import OpenAI from "openai";
import pgvector from "pgvector/utils";

import type { CachedSearchResult, SemanticCache } from "./cache.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { Embedder } from "./embedder.js";
import type { Metrics } from "./metrics.js";

export interface ToolDeps {
  cfg: Config;
  db: Db;
  embedder: Embedder;
  cache: SemanticCache;
  metrics: Metrics;
  openai: OpenAI;
}

export interface SearchResult {
  content: string;
  sourceName: string;
  score: number;
}

export interface AskResult {
  answer: string;
  citations: SearchResult[];
}

export interface Source {
  sourceName: string;
  ingestedAt: string;
}

async function embedAndSearch(
  deps: ToolDeps,
  tenantId: string,
  query: string,
  k: number,
): Promise<SearchResult[]> {
  const embedStart = performance.now();
  const embedding = await deps.embedder.embed(query);
  deps.metrics.embedLatency.observe((performance.now() - embedStart) / 1000);

  const cached = await deps.cache.lookup(tenantId, embedding);
  if (cached !== null) {
    deps.metrics.cacheHits.inc();
    return cached.slice(0, k);
  }
  deps.metrics.cacheMisses.inc();

  const pgStart = performance.now();
  const results = await deps.db.withTenant(tenantId, async (client) => {
    const res = await client.query<{
      content: string;
      source_name: string;
      score: number;
    }>(
      `SELECT c.content,
              d.source_name,
              1 - (c.embedding <=> $1::vector) AS score
         FROM chunks c
         JOIN documents d ON d.id = c.document_id
        ORDER BY c.embedding <=> $1::vector
        LIMIT $2`,
      [pgvector.toSql(embedding), k],
    );
    return res.rows;
  });
  deps.metrics.pgLatency.labels("search").observe((performance.now() - pgStart) / 1000);

  const shaped: SearchResult[] = [];
  for (const row of results) {
    shaped.push({
      content: row.content,
      sourceName: row.source_name,
      score: Number(row.score),
    });
  }

  const cacheable: CachedSearchResult[] = [];
  for (const r of shaped) {
    cacheable.push({ content: r.content, sourceName: r.sourceName, score: r.score });
  }
  await deps.cache.store(tenantId, embedding, cacheable);

  return shaped;
}

export async function search(
  deps: ToolDeps,
  tenantId: string,
  query: string,
  k: number,
): Promise<SearchResult[]> {
  const start = performance.now();
  try {
    return await embedAndSearch(deps, tenantId, query, k);
  } finally {
    deps.metrics.queriesTotal.labels("search").inc();
    deps.metrics.queryLatency.labels("search").observe((performance.now() - start) / 1000);
  }
}

const ASK_SYSTEM_PROMPT = [
  "You answer questions using ONLY the provided context passages.",
  "If the passages don't contain the answer, say so plainly — don't guess.",
  "Cite passages inline as [1], [2], … using the order they appear.",
].join(" ");

function buildContext(chunks: SearchResult[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < chunks.length) {
    parts.push(`[${i + 1}] (${chunks[i].sourceName})\n${chunks[i].content}`);
    i += 1;
  }
  return parts.join("\n\n");
}

export async function ask(
  deps: ToolDeps,
  tenantId: string,
  question: string,
  k: number,
): Promise<AskResult> {
  const start = performance.now();
  try {
    const citations = await embedAndSearch(deps, tenantId, question, k);
    if (citations.length === 0) {
      return {
        answer: "No indexed context matches this question yet.",
        citations: [],
      };
    }

    const completion = await deps.openai.chat.completions.create({
      model: deps.cfg.openaiChatModel,
      messages: [
        { role: "system", content: ASK_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Question: ${question}\n\nContext:\n${buildContext(citations)}`,
        },
      ],
      temperature: 0.2,
    });

    const answer = completion.choices[0]?.message?.content ?? "";
    return { answer, citations };
  } finally {
    deps.metrics.queriesTotal.labels("ask").inc();
    deps.metrics.queryLatency.labels("ask").observe((performance.now() - start) / 1000);
  }
}

export async function listSources(deps: ToolDeps, tenantId: string): Promise<Source[]> {
  const start = performance.now();
  try {
    return await deps.db.withTenant(tenantId, async (client) => {
      const res = await client.query<{ source_name: string; ingested_at: string }>(
        `SELECT source_name,
                MAX(ingested_at) AS ingested_at
           FROM documents
          WHERE status = 'ingested'
          GROUP BY source_name
          ORDER BY ingested_at DESC`,
      );
      const sources: Source[] = [];
      for (const row of res.rows) {
        sources.push({ sourceName: row.source_name, ingestedAt: row.ingested_at });
      }
      return sources;
    });
  } finally {
    deps.metrics.queriesTotal.labels("list_sources").inc();
    deps.metrics.queryLatency.labels("list_sources").observe((performance.now() - start) / 1000);
  }
}
