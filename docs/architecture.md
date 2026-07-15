# Architecture

## Two halves, one system

**Write side (ingestion):** users upload documents to S3. An S3 event triggers a Lambda that enqueues an ingestion message in SQS. A fleet of Python workers running on EKS, autoscaled by KEDA on queue depth, pulls messages, downloads the doc, chunks it, embeds each chunk, and upserts vectors into pgvector on RDS.

**Read side (query):** a TypeScript MCP server exposes tools (`search`, `ask`, `list_sources`) over the standard MCP protocol. Requests are authenticated by API key, tenant-isolated by row-level security on Postgres, rate-limited per tenant, and cached in Redis by query-embedding similarity.

## Data flow

```
        write path                                     read path
        ──────────                                     ─────────
  1. client uploads to S3                     1. MCP client (Claude Desktop) sends
     via presigned URL                           `search(query, k)` tool call
  2. S3 emits ObjectCreated event              2. ALB routes to MCP gateway pod
  3. Lambda validates & enqueues SQS msg       3. gateway authenticates API key,
     with {tenant_id, s3_key, mime}               resolves tenant_id
  4. KEDA sees queue depth, scales             4. gateway checks Redis semantic
     ingestion workers 0→N                        cache (embed query → cosine
  5. worker pulls msg, downloads doc              lookup in cache)
  6. worker chunks (1000-token overlap 100)    5. on cache miss: embed query,
  7. worker embeds each chunk                     pgvector `<=>` search top-k
  8. worker upserts (tenant_id, doc_id,           filtered by tenant_id (RLS)
     chunk_idx, embedding, text) into           6. gateway returns chunks + optional
     pgvector                                      LLM-generated answer
  9. worker deletes SQS msg                    7. gateway records cost + tokens
                                                  in Postgres for tenant meter
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

- **Metrics (Prometheus):** ingest rate, embed latency, query latency (p50/95/99), cache hit rate, tokens spent, cost per tenant, worker replica count
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
