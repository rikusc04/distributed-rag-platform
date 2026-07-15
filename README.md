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

## Roadmap

- **Week 1 — Foundation:** Terraform bootstrap (VPC, EKS, RDS, ElastiCache, S3, SQS, ECR, IRSA). Helm baseline (kube-prometheus-stack, Grafana, ALB controller, KEDA). CI builds/pushes images. Ingestion worker MVP: S3 → SQS → chunk → embed → pgvector.
- **Week 2 — MCP Gateway:** TypeScript MCP server (`search`, `ask`, `list_sources`). API-key auth, `tenant_id` propagation, Postgres RLS, per-tenant token-bucket rate limiter. End-to-end demo from Claude Desktop.
- **Week 3 — Autoscaling + Cache + Observability:** KEDA `ScaledObject` on SQS depth, Redis semantic cache, Prometheus metrics, 3 Grafana dashboards, OTel tracing to Tempo.
- **Week 4 — Cost tracking, load test, ship:** Per-tenant LLM cost meter + SNS budget alerts, k6 load test, big real-corpus ingest, README polish, Loom demo.

## Success Criteria (resume bullets)

- Multi-tenant RAG platform on AWS EKS with KEDA autoscaling 0→N ingestion workers driven by SQS queue depth
- Multi-tenant MCP gateway with p95 query latency and cost-savings numbers from the semantic cache
- End-to-end Terraform IaC (VPC, EKS, RDS, ElastiCache, S3, SQS) with Prometheus + Grafana + Tempo observability and GitHub Actions CI/CD

## Running Locally

TBD — see `docs/runbook.md` once Week 1 completes.
