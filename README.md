# Distributed RAG Platform

A multi-tenant Retrieval-Augmented Generation platform on AWS. Ingest documents at scale via a Kubernetes worker fleet, query them from any MCP-compatible client (Claude Desktop, Cursor, custom CLIs).

## Architecture

```
    Upload PDF/DOCX          AWS (all provisioned via Terraform)
    ─────────────▶  S3 ──▶ Lambda ──▶ SQS ──┐
                                             ▼
                                    ┌──────────────────────────┐
                                    │  EKS Cluster             │
                                    │                          │
                                    │  KEDA autoscales 0→N     │
                                    │  Python ingestion workers│
                                    │  (chunk + embed + upsert)│
                                    │                          │
    Claude / Cursor / CLI           │  TS MCP Gateway          │
    ─────────────▶  ALB ─────────▶  │  ├─ API-key auth         │
                                    │  ├─ rate limiter         │
                                    │  ├─ semantic cache       │
                                    │  └─ tools: search / ask  │
                                    │                          │
                                    │  Redis (ElastiCache)     │
                                    │  Prom + Grafana + Tempo  │
                                    └────────────┬─────────────┘
                                                 │
                                    ┌────────────▼─────────────┐
                                    │ RDS Postgres + pgvector  │
                                    │ (tenant-partitioned, RLS)│
                                    └──────────────────────────┘
```

## Tech Stack

| Layer | Choice |
|---|---|
| IaC | Terraform |
| Cluster | AWS EKS, KEDA + HPA autoscaling |
| Ingestion workers | Python (containerized) |
| MCP gateway | TypeScript / Node (containerized) |
| Vector store | pgvector on RDS PostgreSQL |
| Cache | Redis on ElastiCache (embedding-similarity semantic cache) |
| Ingress | AWS Load Balancer Controller + ALB |
| Observability | kube-prometheus-stack, Grafana, Tempo (OTel tracing) |
| CI/CD | GitHub Actions → ECR → `terraform apply` + `helm upgrade` |

## Repo Layout

```
infra/              # Terraform — VPC, EKS, RDS, ElastiCache, S3, SQS, ECR, IAM
charts/             # Helm charts for the two services + umbrella chart
services/
  ingestion-worker/ # Python: SQS consumer, chunk, embed, upsert to pgvector
  mcp-gateway/      # TypeScript: MCP server exposing search / ask / list_sources
db/migrations/      # SQL migrations (pgvector schema, tenant tables, RLS)
observability/      # Grafana dashboards, Prometheus alerts
.github/workflows/  # CI, image build/push, deploy
docs/               # Architecture, runbook
```

## Capabilities

- **Infrastructure as code:** every AWS resource (VPC, EKS, RDS, ElastiCache, S3, SQS, ECR, IAM) is provisioned by Terraform. Two-step bootstrap; single `terraform apply` brings the environment up.
- **Autoscaled ingestion:** KEDA scales Python workers 0→N based on SQS queue depth. Uploads land in S3 → notification triggers SQS → workers chunk, embed, and upsert to pgvector.
- **Multi-tenant MCP gateway:** TypeScript server exposes `search`, `ask`, `list_sources` over the standard MCP protocol. API-key auth, per-tenant rate limiting, tenant isolation enforced by Postgres row-level security.
- **Semantic caching:** Redis-backed embedding-similarity cache in front of the LLM, cutting cost and latency on repeat queries.
- **Observability:** Prometheus metrics, three Grafana dashboards (ingestion / query / cluster), OpenTelemetry traces to Tempo.
- **CI/CD:** GitHub Actions runs lint + typecheck + tests on every push, builds container images to ECR, and deploys via `terraform apply` + `helm upgrade`.
- **Cost controls:** per-tenant LLM cost meter, SNS budget alerts, ECR lifecycle policy.

## Success Criteria (resume bullets)

- Multi-tenant RAG platform on AWS EKS with KEDA autoscaling 0→N ingestion workers driven by SQS queue depth
- Multi-tenant MCP gateway with p95 query latency and cost-savings numbers from the semantic cache
- End-to-end Terraform IaC (VPC, EKS, RDS, ElastiCache, S3, SQS) with Prometheus + Grafana + Tempo observability and GitHub Actions CI/CD

## Running It Yourself

- **First time?** Start with the detailed walkthrough: [`docs/getting-started.md`](docs/getting-started.md). Assumes zero cloud knowledge.
- **Quick operator commands** (bring up, tear down, deploy, ingest): [`docs/runbook.md`](docs/runbook.md).
- **Architecture deep-dive:** [`docs/architecture.md`](docs/architecture.md).
- **Hit a bug?** Check [`docs/issues.md`](docs/issues.md) — running log of issues we've hit and fixes.
