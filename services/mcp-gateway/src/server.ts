// MCP server + Streamable HTTP transport, wrapped in a Node http.Server that
// does Bearer-token auth up front and stamps the resolved tenant_id into an
// AsyncLocalStorage before the SDK invokes the tool callback.

import { AsyncLocalStorage } from "node:async_hooks";
import { IncomingMessage, ServerResponse, createServer } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Logger } from "pino";
import { z } from "zod";

import { AuthError, parseBearer, resolveTenant } from "./auth.js";
import type { Metrics } from "./metrics.js";
import { ToolDeps, ask, listSources, search } from "./tools.js";

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;

interface TenantContext {
  tenantId: string;
}

const tenantStore = new AsyncLocalStorage<TenantContext>();

function requireTenant(): string {
  const ctx = tenantStore.getStore();
  if (!ctx) {
    throw new Error("no tenant in context — auth middleware did not run");
  }
  return ctx.tenantId;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

const healthz: Handler = (_req, res) => sendJson(res, 200, { ok: true });

export interface HttpServer {
  close(): Promise<void>;
}

// Single Node http.Server factory used by both the MCP-facing server (:8080)
// and the Prometheus scrape target (:9090). Routes match on the exact
// request path (query strings stripped); anything unmatched returns 404, and
// any thrown error becomes a 500.
function makeHttpServer(
  logger: Logger,
  label: string,
  port: number,
  routes: Record<string, Handler>,
): HttpServer {
  const server = createServer(async (req, res) => {
    try {
      const path = req.url ? req.url.split("?", 1)[0] : "";
      const handler = routes[path];
      if (handler) {
        await handler(req, res);
        return;
      }
      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      logger.error({ err }, `${label} handler error`);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "internal error" });
      }
    }
  });
  server.listen(port, () => logger.info({ port }, `${label} listening`));
  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function makeMcp(deps: ToolDeps): McpServer {
  const mcp = new McpServer({
    name: "distributed-rag-platform",
    version: "0.1.0",
  });

  mcp.registerTool(
    "search",
    {
      description: "Semantic search over the tenant's ingested documents. Returns top-k chunks by cosine similarity.",
      inputSchema: {
        query: z.string().min(1).describe("Natural-language search query"),
        k: z.number().int().positive().max(20).default(5).describe("Number of chunks to return"),
      },
    },
    async ({ query, k }) => {
      const results = await search(deps, requireTenant(), query, k);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    },
  );

  mcp.registerTool(
    "ask",
    {
      description: "Answer a question using the tenant's documents as grounding context. Returns an answer and citations.",
      inputSchema: {
        question: z.string().min(1).describe("Question to answer"),
        k: z.number().int().positive().max(20).default(5).describe("How many chunks to ground the answer on"),
      },
    },
    async ({ question, k }) => {
      const result = await ask(deps, requireTenant(), question, k);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  mcp.registerTool(
    "list_sources",
    {
      description: "List distinct source documents ingested for this tenant.",
      inputSchema: {},
    },
    async () => {
      const sources = await listSources(deps, requireTenant());
      return {
        content: [{ type: "text", text: JSON.stringify(sources, null, 2) }],
      };
    },
  );

  return mcp;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) {
    return undefined;
  }
  return JSON.parse(raw);
}

export async function startHttpServer(
  deps: ToolDeps,
  logger: Logger,
  metrics: Metrics,
  listenPort: number,
): Promise<HttpServer> {
  const mcp = makeMcp(deps);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcp.connect(transport);

  const mcpHandler: Handler = async (req, res) => {
    let tenantId: string;
    try {
      const rawKey = parseBearer(req.headers.authorization);
      tenantId = await resolveTenant(deps.db.pool, rawKey);
    } catch (err) {
      if (err instanceof AuthError) {
        metrics.authFailures.labels(err.reason).inc();
        sendJson(res, 401, { error: err.message });
        return;
      }
      throw err;
    }

    const body = await readBody(req);
    await tenantStore.run({ tenantId }, () => transport.handleRequest(req, res, body));
  };

  const http = makeHttpServer(logger, "mcp gateway", listenPort, {
    "/healthz": healthz,
    "/mcp": mcpHandler,
  });

  return {
    close: async () => {
      await http.close();
      await transport.close();
      await mcp.close();
    },
  };
}

export function startMetricsServer(metrics: Metrics, logger: Logger, port: number): HttpServer {
  const metricsHandler: Handler = async (_req, res) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", metrics.registry.contentType);
    res.end(await metrics.registry.metrics());
  };

  return makeHttpServer(logger, "metrics server", port, {
    "/healthz": healthz,
    "/metrics": metricsHandler,
  });
}
