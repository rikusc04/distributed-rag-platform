// Prometheus metrics for the MCP gateway.
// Scraped on :METRICS_PORT/metrics. Kept small on purpose — these are the
// numbers we care about on the Grafana dashboard and for the resume writeup.

import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export class Metrics {
  readonly registry: Registry;
  readonly queriesTotal: Counter<"tool">;
  readonly queryLatency: Histogram<"tool">;
  readonly cacheHits: Counter<string>;
  readonly cacheMisses: Counter<string>;
  readonly embedLatency: Histogram<string>;
  readonly pgLatency: Histogram<"op">;
  readonly authFailures: Counter<"reason">;

  constructor() {
    this.registry = new Registry();
    collectDefaultMetrics({ register: this.registry });

    this.queriesTotal = new Counter({
      name: "mcp_queries_total",
      help: "Total MCP tool invocations that reached the handler",
      labelNames: ["tool"] as const,
      registers: [this.registry],
    });

    this.queryLatency = new Histogram({
      name: "mcp_query_latency_seconds",
      help: "End-to-end latency of an MCP tool call",
      labelNames: ["tool"] as const,
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    this.cacheHits = new Counter({
      name: "mcp_cache_hits_total",
      help: "Query cache hits (a stored embedding scored above threshold)",
      registers: [this.registry],
    });

    this.cacheMisses = new Counter({
      name: "mcp_cache_misses_total",
      help: "Query cache misses (no stored embedding above threshold)",
      registers: [this.registry],
    });

    this.embedLatency = new Histogram({
      name: "mcp_embed_latency_seconds",
      help: "Wall-clock time for one query embedding call",
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    this.pgLatency = new Histogram({
      name: "mcp_pg_latency_seconds",
      help: "Wall-clock time for a Postgres query",
      labelNames: ["op"] as const,
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
      registers: [this.registry],
    });

    this.authFailures = new Counter({
      name: "mcp_auth_failures_total",
      help: "Requests rejected before reaching the MCP layer",
      labelNames: ["reason"] as const,
      registers: [this.registry],
    });
  }
}
