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

Raw artifacts in this directory:

- `cold-summary.json`, `cold-metrics.txt` — search, cache ON
- `search-cache-off-summary.json`, `search-cache-off-metrics.txt` — search, cache OFF
- `ask-cache-on-summary.json`, `ask-cache-on-metrics.txt` — ask, cache ON

## Results

| Scenario                                | VUs | Iters | p50    | **p95**    | max    | Cache activity              |
|-----------------------------------------|-----|-------|--------|------------|--------|-----------------------------|
| `search`, cache ON, paraphrase workload | 10  | 2,679 | 195 ms | **331 ms** | 2.8 s  | 2646 hits / 34 miss (98.7%) |
| `search`, cache OFF, same workload      | 10  | 2,488 | 203 ms | **344 ms** | 3.6 s  | 0 hits / 0 miss (bypassed)  |
| `ask`, cache ON, warm workload          | 5   | 283   | 957 ms | **1611 ms**| 5.1 s  | 280 hits / 3 miss (98.9%)   |

Percentiles above are k6 client-side (`http_req_duration`). Server-side histograms in `*-metrics.txt` agree within bucket resolution.

## What the numbers mean

**Search p95 ≈ 335 ms; the cache moves it by only ~13 ms.**
Cache ON vs cache OFF: 331 ms vs 344 ms — real but small (about 4%). On `search`, embed (~150–200 ms of network round-trip to OpenAI) always runs. The cache only short-circuits the pg query, which is ~2 ms because HNSW on 200 rows is trivial. The cache offloads the DB, but the end-to-end latency win is bounded by how small the pg step already is.

**Ask p95 ≈ 1.6 s; the cache does not move that either — because of an implementation gap.**
In `services/mcp-gateway/src/tools.ts:135`, the `ask` handler calls `openai.chat.completions.create` on **every** request, regardless of whether retrieval hit the cache. The `SemanticCache` in `cache.ts` only stores the retrieved chunk list, not the final answer. On a cache hit, `ask` still pays the full ~1 s chat completion round-trip. **LLM cost savings from the current cache on `ask`: essentially $0.**

**Cache hit rate is genuinely ~99% on paraphrase workloads.**
The semantic dedup is doing its job — it correctly identifies query variants as the same request. That capacity is real. It just is not wired into the code path that would save LLM cost.

## To turn the ~99% hit rate into real cost savings

Wrap `openai.chat.completions.create` in `tools.ts` in a cache lookup keyed on `(tenant, question embedding)`, cache the full `{answer, citations}` payload, and short-circuit the chat call on hit. Estimated change: ~20 lines. After that, the observed hit rate translates directly into the corresponding fraction of chat completions skipped.
