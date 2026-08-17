// Seed the local pgvector DB with one tenant, one API key, and N chunks
// whose embeddings come from the real OpenAI embedding API. Connects as the
// postgres superuser so RLS (enabled with no policies in 001_init.sql) is
// bypassed for the insert. Prints the raw API key at the end — pass it to k6.

import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import pg from "pg";
import pgvector from "pgvector/pg";
import OpenAI from "openai";

const {
  PGHOST = "localhost",
  PGPORT = "5433",
  PGUSER = "rag",
  PGPASSWORD = "rag",
  PGDATABASE = "rag",
  OPENAI_API_KEY,
  OPENAI_EMBED_MODEL = "text-embedding-3-small",
  SEED_CHUNKS = "200",
} = process.env;

if (!OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is required");
  process.exit(1);
}

const N = parseInt(SEED_CHUNKS, 10);

// A pool of short, thematically varied strings we embed as fake "chunks".
// Some are near-duplicates so semantic search returns non-trivial neighbors.
const TOPICS = [
  "kubernetes autoscaling with keda based on sqs queue depth",
  "pgvector hnsw index tuning for cosine similarity search",
  "row-level security in postgres for multi-tenant applications",
  "redis semantic cache for embedding-based query deduplication",
  "aws eks irsa pod identity for accessing sqs and s3",
  "openai embedding models pricing and dimensionality tradeoffs",
  "terraform module composition for reusable vpc definitions",
  "grafana dashboards for prometheus histogram quantiles",
  "opentelemetry trace context propagation in typescript",
  "mcp streamable http transport session management",
  "chunk splitting strategies for long documents in rag",
  "cost per query for gpt-4o-mini with 5-chunk context",
];

function fillerFor(i) {
  const topic = TOPICS[i % TOPICS.length];
  return `${topic}. document number ${i}, revision ${(i * 31) % 97}.`;
}

async function main() {
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  const client = new pg.Client({
    host: PGHOST,
    port: parseInt(PGPORT, 10),
    user: PGUSER,
    password: PGPASSWORD,
    database: PGDATABASE,
  });
  await client.connect();
  await pgvector.registerTypes(client);

  console.log(`seeding tenant + ${N} chunks (model=${OPENAI_EMBED_MODEL})`);

  const tenantId = randomUUID();
  const rawKey = "sk-bench-" + randomUUID().replace(/-/g, "");
  const keyHash = createHash("sha256").update(rawKey, "utf8").digest("hex");

  await client.query("BEGIN");
  await client.query("INSERT INTO tenants (id, name) VALUES ($1, $2)", [
    tenantId,
    "bench-tenant",
  ]);
  await client.query(
    "INSERT INTO api_keys (tenant_id, key_hash, label) VALUES ($1, $2, $3)",
    [tenantId, keyHash, "bench"],
  );

  const documentId = randomUUID();
  await client.query(
    "INSERT INTO documents (id, tenant_id, s3_key, source_name, mime, status, ingested_at) VALUES ($1, $2, $3, $4, $5, $6, now())",
    [documentId, tenantId, "bench/seed.txt", "seed.txt", "text/plain", "ready"],
  );

  const inputs = Array.from({ length: N }, (_, i) => fillerFor(i));

  // Batch embed: OpenAI allows many inputs per call. Keep batches ≤ 96 to stay
  // well under the token cap for text-embedding-3-small.
  const BATCH = 64;
  const vectors = [];
  for (let start = 0; start < inputs.length; start += BATCH) {
    const batch = inputs.slice(start, start + BATCH);
    const res = await openai.embeddings.create({
      model: OPENAI_EMBED_MODEL,
      input: batch,
    });
    for (const d of res.data) vectors.push(d.embedding);
    process.stdout.write(`  embedded ${vectors.length}/${inputs.length}\n`);
  }

  for (let i = 0; i < inputs.length; i++) {
    await client.query(
      "INSERT INTO chunks (tenant_id, document_id, chunk_idx, content, embedding) VALUES ($1, $2, $3, $4, $5)",
      [tenantId, documentId, i, inputs[i], pgvector.toSql(vectors[i])],
    );
  }

  await client.query("COMMIT");
  await client.end();

  const out = {
    tenant_id: tenantId,
    api_key: rawKey,
    chunks: N,
    embed_model: OPENAI_EMBED_MODEL,
  };
  writeFileSync("bench/seed-output.json", JSON.stringify(out, null, 2) + "\n");
  console.log("\nseed complete. wrote bench/seed-output.json");
  console.log("api_key:", rawKey);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
