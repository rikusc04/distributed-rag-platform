// Redis-backed semantic cache.
//
// Each tenant has a capped list of recent (query_embedding, payload) pairs.
// On lookup we fetch the whole list and pick the best cosine match above
// `threshold`. This is O(N) per lookup but N is small (default 500) and each
// entry is ~10KB, so it fits comfortably in memory and stays well under Redis
// roundtrip budgets.
//
// The class is generic in the payload type so it can back both the chunk
// cache used by `search` and the answer cache used by `ask` — same shape,
// different Redis key namespace. The cosine + top-pick function is a pure
// function of arrays; unit tests cover it without needing a real Redis.

import { Redis } from "ioredis";

// Also used by tools.ts as the shape returned from `search`. Kept here
// because cache.ts is the deeper module and this avoids an import cycle.
export interface SearchResult {
  content: string;
  sourceName: string;
  score: number;
}

// Field is named `results` for backwards compatibility with entries written
// before this class went generic. Conceptually it holds a payload of type T.
interface CacheEntry<T> {
  embedding: number[];
  results: T;
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  let i = 0;
  while (i < a.length) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
    i += 1;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) {
    return 0;
  }
  return dot / denom;
}

export function pickBestMatch<T>(
  queryEmbedding: number[],
  entries: CacheEntry<T>[],
  threshold: number,
): { entry: CacheEntry<T>; score: number } | null {
  let best: { entry: CacheEntry<T>; score: number } | null = null;
  for (const entry of entries) {
    const score = cosine(queryEmbedding, entry.embedding);
    if (score < threshold) {
      continue;
    }
    if (best === null || score > best.score) {
      best = { entry, score };
    }
  }
  return best;
}

export class SemanticCache<T> {
  private readonly redis: Redis;
  private readonly threshold: number;
  private readonly maxEntries: number;
  private readonly ttlSeconds: number;
  private readonly keyPrefix: string;

  constructor(
    redis: Redis,
    threshold: number,
    maxEntries: number,
    ttlSeconds: number,
    keyPrefix = "q-cache",
  ) {
    this.redis = redis;
    this.threshold = threshold;
    this.maxEntries = maxEntries;
    this.ttlSeconds = ttlSeconds;
    this.keyPrefix = keyPrefix;
  }

  private key(tenantId: string): string {
    return `${this.keyPrefix}:${tenantId}`;
  }

  async lookup(tenantId: string, embedding: number[]): Promise<T | null> {
    const raw = await this.redis.lrange(this.key(tenantId), 0, -1);
    const entries: CacheEntry<T>[] = [];
    for (const item of raw) {
      try {
        entries.push(JSON.parse(item) as CacheEntry<T>);
      } catch {
        // Corrupt entry — skip. Old-format entries will get evicted naturally
        // via LTRIM on subsequent writes.
      }
    }
    const best = pickBestMatch(embedding, entries, this.threshold);
    if (best === null) {
      return null;
    }
    return best.entry.results;
  }

  async store(tenantId: string, embedding: number[], payload: T): Promise<void> {
    const entry: CacheEntry<T> = { embedding, results: payload };
    const serialized = JSON.stringify(entry);
    const key = this.key(tenantId);
    // LPUSH new, LTRIM to the cap, refresh the TTL.
    await this.redis
      .multi()
      .lpush(key, serialized)
      .ltrim(key, 0, this.maxEntries - 1)
      .expire(key, this.ttlSeconds)
      .exec();
  }
}
