// k6 script: hits the MCP gateway's `search` tool over Streamable HTTP.
//
// Env vars:
//   API_KEY   — raw API key from bench/seed-output.json
//   PROFILE   — "cold" (unique queries per iter, cache-miss heavy)
//               "warm" (small pool of repeated queries, cache-hit heavy)
//   BASE_URL  — default http://localhost:8080
//   VUS       — virtual users, default 10
//   DURATION  — test duration, default 60s
//
// Emits standard k6 metrics (http_req_duration p95 etc.). The authoritative
// per-tool p95 comes from the gateway's Prometheus histogram — this k6 number
// is a client-side sanity check that includes HTTP + JSON overhead.

import http from "k6/http";
import { check } from "k6";

const API_KEY = __ENV.API_KEY;
if (!API_KEY) throw new Error("API_KEY env var required");
const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const PROFILE = __ENV.PROFILE || "cold";
const TOOL = __ENV.TOOL || "search";

const COLD_TOPICS = [
  "how does keda autoscale workers based on sqs queue depth",
  "pgvector hnsw index build parameters",
  "postgres row-level security policy examples",
  "redis semantic cache eviction strategy",
  "aws eks irsa role trust policy",
  "openai embedding cost per million tokens",
  "terraform module for vpc with private subnets",
  "grafana histogram_quantile query for p95",
  "otel trace context in nodejs http server",
  "mcp streamable http session id generator",
  "sentence-level chunking vs paragraph-level for rag",
  "gpt-4o-mini prompt caching pricing",
  "cosine similarity threshold for cache dedup",
  "hnsw m and ef_construction tuning",
  "postgres set_config app.current_tenant with is_local",
  "aws lambda s3 event to sqs fanout pattern",
  "prometheus scrape config for kubernetes pods",
  "rate limiting with token bucket in node",
  "openai text-embedding-3-small dimensionality",
  "helm umbrella chart dependency management",
];

const WARM_POOL = [
  "kubernetes autoscaling with keda based on sqs queue depth",
  "pgvector hnsw index tuning for cosine similarity search",
  "row-level security in postgres for multi-tenant applications",
];

export const options = {
  vus: parseInt(__ENV.VUS || "10", 10),
  duration: __ENV.DURATION || "60s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
  },
};

function pickQuery() {
  if (PROFILE === "warm") {
    return WARM_POOL[Math.floor(Math.random() * WARM_POOL.length)];
  }
  // cold: unique-ish query per iter (topic + salt) so cache almost always misses
  const t = COLD_TOPICS[Math.floor(Math.random() * COLD_TOPICS.length)];
  const salt = Math.floor(Math.random() * 100000);
  return `${t} — variant ${salt}`;
}

let reqId = 1;

export default function () {
  const q = pickQuery();
  const args = TOOL === "ask" ? { question: q, k: 5 } : { query: q, k: 5 };
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: reqId++,
    method: "tools/call",
    params: {
      name: TOOL,
      arguments: args,
    },
  });

  const res = http.post(`${BASE_URL}/mcp`, body, {
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Authorization": `Bearer ${API_KEY}`,
    },
  });

  check(res, {
    "status is 200": (r) => r.status === 200,
    "no jsonrpc error": (r) => !r.body || !String(r.body).includes('"error"'),
  });
}
