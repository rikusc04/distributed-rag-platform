# Architecture

## Two halves, one system

**Write side (ingestion):** users upload documents to S3 under a `tenant-<uuid>/` prefix. S3 event notifications drop a message onto the ingest SQS queue directly (no Lambda in between — S3 → SQS is a first-class integration). A fleet of Python workers running on EKS, autoscaled by KEDA on queue depth, long-polls the queue, downloads the doc, extracts text (PDF via `pypdf`, plain text as-is), chunks it into 1000-token windows with 100-token overlap using `tiktoken`, batch-embeds the chunks with OpenAI, and upserts the vectors into pgvector on RDS inside a single transaction that sets `app.current_tenant` so row-level security scopes every write.

**Read side (query):** a TypeScript MCP server exposes tools (`search`, `ask`, `list_sources`) over the standard MCP protocol. Requests are authenticated by API key, tenant-isolated by row-level security on Postgres, rate-limited per tenant, and cached in Redis by query-embedding similarity.

## Data flow

```
        write path                                     read path
        ──────────                                     ─────────
  1. client uploads to S3 under               1. MCP client (Claude Desktop) sends
     tenant-<uuid>/ prefix                       `search(query, k)` tool call
  2. S3 emits ObjectCreated event              2. ALB routes to MCP gateway pod
     directly onto ingest SQS queue            3. gateway authenticates API key,
  3. KEDA sees queue depth, scales                resolves tenant_id
     ingestion workers 0→N                     4. gateway checks Redis semantic
  4. worker long-polls, parses S3                 cache (embed query → cosine
     event, extracts tenant from key             lookup in cache)
  5. worker downloads doc, extracts            5. on cache miss: embed query,
     text (PDF via pypdf, else utf-8)            pgvector `<=>` search top-k
  6. worker chunks (1000-token, 100 overlap)      filtered by tenant_id (RLS)
  7. worker batch-embeds via OpenAI            6. gateway returns chunks + optional
  8. worker upserts document + chunks             LLM-generated answer
     in one tx (SET LOCAL app.current_        7. gateway records cost + tokens
     tenant so RLS scopes writes)                in Postgres for tenant meter
  9. worker deletes SQS msg on success
```

## Multi-tenancy

- Every table has `tenant_id UUID NOT NULL`
- Postgres row-level security policy scopes reads/writes by session variable `app.current_tenant`
- MCP gateway sets `SET LOCAL app.current_tenant = $1` on every DB transaction
- API keys map 1:1 to tenants and are hashed at rest
- Rate limits, cost budgets, and usage meters all keyed by `tenant_id`

## Autoscaling

- **Ingestion workers:** KEDA `ScaledObject` with `aws-sqs-queue` trigger. Target 5 messages per worker. Min 0, max 50. Cooldown 60s.
- **MCP gateway:** HPA on CPU (70%) and custom metric `mcp_active_requests`. Min 2, max 20.

## Observability

- **Metrics (Prometheus):**
  - Ingestion worker (already shipped): `ingest_messages_received_total`, `ingest_documents_ingested_total`, `ingest_documents_failed_total{reason}`, `ingest_chunks_written_total`, `ingest_embed_latency_seconds`, `ingest_document_latency_seconds`
  - MCP gateway (planned): query latency (p50/95/99), cache hit rate, tokens spent, cost per tenant, active-request gauge for HPA
- **Dashboards (Grafana):** one per subsystem — ingestion, query, cluster health
- **Tracing (Tempo via OTel):** end-to-end trace from MCP call → Postgres query → LLM API call
- **Alerts:** budget breach (SNS + Grafana), SQS DLQ non-empty, error rate > 1%

## Deployment

- Terraform provisions all AWS infra (VPC, EKS, RDS, ElastiCache, S3, SQS, ECR, IAM/IRSA)
- Helm umbrella chart deploys the two services + kube-prometheus-stack + Tempo + KEDA + AWS Load Balancer Controller
- GitHub Actions: on push to `main`, build+push images to ECR → `terraform apply` (auto-approve for dev only) → `helm upgrade`

## What's explicitly out of scope (v1)

- Fine-tuning custom embedding models
- BYO-key LLM support beyond OpenAI/Anthropic
- Non-Postgres vector stores
- Web UI (MCP is the interface)
