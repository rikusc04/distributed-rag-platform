# MCP gateway benchmark — findings

Local load test of the MCP gateway's `search` and `ask` tools.

## Setup

- Stack: docker-compose — postgres 16 + pgvector, redis 7, prometheus 2.55
- Gateway: `services/mcp-gateway`, built + run on host (node 20)
- Corpus: 200 chunks seeded via `bench/seed.mjs`, all embedded with `text-embedding-3-small`
- Embed model: `text-embedding-3-small` (1536-dim)
- Chat model (for `ask`): `gpt-4o-mini`
- Load generator: k6 v2.2.0
- Runs from a laptop; OpenAI API calls go over the public internet
- Single tenant; RLS enabled but no policies (owner-bypass in effect)

Raw artifacts in this directory (gitignored — the write-up above is the durable record):

- `cold-summary.json`, `cold-metrics.txt` — search, cache ON
- `search-cache-off-summary.json`, `search-cache-off-metrics.txt` — search, cache OFF
- `ask-cache-off-summary.json`, `ask-cache-off-metrics.txt` — ask, cache OFF baseline
- `ask-cache-on-summary.json`, `ask-cache-on-metrics.txt` — ask, cache ON with answer cache

## Results

| Scenario                                       | VUs | Iters | p50    | **p95**    | max    | Cache activity                     |
|------------------------------------------------|-----|-------|--------|------------|--------|------------------------------------|
| `search`, cache ON, paraphrase workload        | 10  | 2,679 | 195 ms | **331 ms** | 2.8 s  | 2646 chunk-hits / 34 miss (98.7%)  |
| `search`, cache OFF, same workload             | 10  | 2,488 | 203 ms | **344 ms** | 3.6 s  | 0 hits / 0 miss (bypassed)         |
| `ask`, cache OFF, warm workload                | 5   | 334   | 859 ms | **1266 ms**| 2.0 s  | 0 hits / 0 miss (bypassed)         |
| `ask`, cache ON with **answer cache**, warm    | 5   | 1,446 | 186 ms | **285 ms** | 2.1 s  | 1441 answer-hits / 5 miss (99.65%) |

Percentiles above are k6 client-side (`http_req_duration`). Server-side histograms in `*-metrics.txt` agree within bucket resolution.

## What the numbers mean

**Search p95 ≈ 335 ms; the cache moves it by only ~13 ms.**
Cache ON vs cache OFF: 331 ms vs 344 ms — real but small (about 4%). On `search`, embed (~150–200 ms of network round-trip to OpenAI) always runs. The cache only short-circuits the pg query, which is ~2 ms because HNSW on 200 rows is trivial. The cache offloads the DB, but the end-to-end latency win is bounded by how small the pg step already is.

**Ask p95 dropped from 1266 ms → 285 ms once the answer cache was wired in.**
Baseline (`ask` with cache OFF) pays ~150–200 ms embed + ~2 ms pg + ~700–1000 ms chat completion, so p95 sits at ~1.3 s. After adding a second `SemanticCache<AskResult>` under the `q-cache-ans:` Redis namespace and checking it before the chat call, cache-hit `ask` skips both retrieval and the chat completion — only embedding remains — and p95 drops to ~285 ms. That's a **~77% cut in p95** at the same VUs, and throughput went from 5.5 → 24 RPS.

**Cost savings from the answer cache on this workload: ~99.65%.**
1441 of 1446 `ask` calls returned from cache without invoking `gpt-4o-mini`. Only 5 chat completions actually ran (the initial fills for the 3 unique queries in the warm pool). Real workloads will hit rates lower than 99.65% because query diversity is higher, but the mechanism now converts every cache hit into a skipped chat completion — the earlier version converted only skipped pg queries.

**Cache hit rate is genuinely ~99% on paraphrase workloads.**
Same lookup mechanism as before (cosine ≥ 0.95 against per-tenant embeddings). The change was wiring it into the answer path, not making the matching smarter.

## Design notes

- Two Redis keys per tenant: `q-cache:<tenantId>` (chunks) and `q-cache-ans:<tenantId>` (answers). Same class, different constructor `keyPrefix`.
- Answer cache is not invalidated on new-document ingest. TTL (default 1 h) handles eventual freshness, same as the chunk cache. Trade-off documented inline in `tools.ts`.
- `CACHE_ENABLED=false` bypasses both caches so `ask` runs full retrieval + chat every call — used for the baseline row above.
