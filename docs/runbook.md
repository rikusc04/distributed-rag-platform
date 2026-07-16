# Runbook

## First-time setup (one-time)

1. Install tooling:
   ```
   brew install awscli terraform kubernetes-cli helm
   ```
2. Create an IAM user with `AdministratorAccess`, generate access keys, then:
   ```
   aws configure    # region: us-east-1, format: json
   aws sts get-caller-identity   # verify
   ```
3. (Recommended) create a $50/month budget alert:
   ```
   aws budgets create-budget --account-id <ACCOUNT_ID> --budget file://budget.json \
     --notifications-with-subscribers file://notifications.json
   ```
4. Bootstrap the Terraform state backend (one-time):
   ```
   cd infra/bootstrap
   terraform init
   terraform apply
   ```

## Bring the dev stack up

```
cd infra/environments/dev
terraform init      # first time only, or after backend changes
terraform apply
```

Takes ~15–20 min (EKS control plane is the slow part).

Then get kubectl access:
```
aws eks update-kubeconfig --name rag-platform-dev --region us-east-1
kubectl get nodes
```

Apply DB migrations (pgvector + tenant/document/chunk tables):
```
./scripts/apply-migrations.sh
```

Install the Helm baseline (KEDA + kube-prometheus-stack):
```
helm repo add kedacore https://kedacore.github.io/charts
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm install keda kedacore/keda -n keda --create-namespace --wait
helm install monitoring prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace \
  --set grafana.adminPassword=admin \
  --set prometheus.prometheusSpec.retention=7d --wait
```

Annotate the KEDA operator SA with its IRSA role so it can call `sqs:GetQueueAttributes`
(without this, the SQS ScaledObject can't read queue depth and the worker never scales):

```
KEDA_ROLE=$(cd infra/environments/dev && terraform output -raw keda_operator_role_arn)
kubectl annotate sa keda-operator -n keda \
  eks.amazonaws.com/role-arn="$KEDA_ROLE" --overwrite
kubectl rollout restart deploy keda-operator -n keda
```

Port-forward Grafana to view dashboards (default admin/admin):
```
kubectl port-forward -n monitoring svc/monitoring-grafana 3000:80
# then open http://localhost:3000
```

## Tear the dev stack down (end of session)

```
cd infra/environments/dev
terraform destroy
```

Takes ~10 min. The bootstrap S3 bucket + state file survive. Any container images pushed to ECR survive.

## Deploy application changes

Build + push images (until we cut `build-images.yaml` back to `on: push`, run it manually):
```
gh workflow run build-images
```

### One-time namespace + secrets setup

Both services read secrets from pre-created Kubernetes Secrets so the Helm chart never touches Secrets Manager itself. Create them once, in the release namespace:

```
kubectl create namespace rag-platform

# 1. OpenAI key (used by both services)
kubectl create secret generic openai-api-key \
  -n rag-platform \
  --from-literal=OPENAI_API_KEY=sk-...

# 2. DB creds for the gateway. Pulled from Secrets Manager (the ingestion
#    worker fetches from SM directly; the gateway reads plain env vars).
cd infra/environments/dev
SECRET_ARN=$(terraform output -raw postgres_secret_arn)
CREDS=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ARN" --query SecretString --output text)
DB_USER=$(echo "$CREDS" | jq -r .username)
DB_PASSWORD=$(echo "$CREDS" | jq -r .password)

kubectl create secret generic rag-platform-db \
  -n rag-platform \
  --from-literal=DB_USER="$DB_USER" \
  --from-literal=DB_PASSWORD="$DB_PASSWORD"
```

### Populate the values file

`charts/umbrella/values.dev.yaml` has `<PLACEHOLDERS>` for every terraform-driven value. Fill them from the tf outputs:

```
cd infra/environments/dev
ACCT=$(aws sts get-caller-identity --query Account --output text)

terraform output -raw ingest_queue_url
terraform output -raw docs_bucket
terraform output -raw postgres_endpoint       # split host:port
terraform output -raw postgres_db_name
terraform output -raw postgres_secret_arn
terraform output -raw redis_endpoint
terraform output -json ecr_repository_urls
terraform output -raw ingestion_worker_role_arn
terraform output -raw mcp_gateway_role_arn
```

### Install the umbrella chart

```
cd charts/umbrella
helm dependency update
helm upgrade --install rag-platform . \
  -n rag-platform \
  -f values.dev.yaml
```

### Verify

```
kubectl get pods -n rag-platform
kubectl get scaledobject,triggerauthentication -n rag-platform
kubectl get svc,ingress,hpa -n rag-platform

# Watch KEDA scale the worker up when a message arrives
kubectl get deploy rag-platform-ingestion-worker -n rag-platform -w
```

## Ingesting a corpus

Object keys must be `tenant-<uuid>/<filename>` — the first path segment is the tenant id, and the worker drops any message whose key doesn't match. Create a tenant row first, then upload:

```
# 1. create a tenant and grab its uuid
kubectl exec -n rag-platform deploy/psql-migrate -- \
  psql -c "INSERT INTO tenants (name) VALUES ('demo') RETURNING id;"
TENANT_ID=<paste the uuid>

# 2. upload a document
aws s3 cp mydoc.pdf s3://rag-platform-dev-docs-<ACCOUNT_ID>/tenant-$TENANT_ID/mydoc.pdf
```

S3 → SQS notification is wired; the ingest queue picks it up, KEDA scales a worker up from 0, the worker chunks + embeds + upserts to pgvector, then deletes the SQS message.

Verify it landed:

```
# chunk count should be non-zero shortly after upload
kubectl exec -n rag-platform deploy/psql-migrate -- \
  psql -c "SELECT count(*) FROM chunks WHERE tenant_id = '$TENANT_ID';"
```

## Running the ingestion worker locally

Useful for debugging without a full `helm upgrade` cycle. Requires the dev stack to be up (so RDS/SQS/S3 exist) and your AWS creds configured.

```
cd services/ingestion-worker
python3.11 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# Populate env from terraform outputs
export AWS_REGION=us-east-1
export INGEST_QUEUE_URL=$(cd ../../infra/environments/dev && terraform output -raw ingest_queue_url)
export DOCS_BUCKET=$(cd ../../infra/environments/dev && terraform output -raw docs_bucket_name)
export DB_HOST=$(cd ../../infra/environments/dev && terraform output -raw postgres_endpoint | cut -d: -f1)
export DB_NAME=$(cd ../../infra/environments/dev && terraform output -raw postgres_db_name)
export DB_SECRET_ARN=$(cd ../../infra/environments/dev && terraform output -raw postgres_secret_arn)
export OPENAI_API_KEY=<your key>

# RDS is VPC-private, so from a laptop you need to port-forward through the EKS pod first
# (see apply-migrations.sh for how it launches a pod inside the VPC)
python -m src.main
```

Metrics land on `http://localhost:9090/metrics`.

## Connecting an MCP client

The gateway speaks MCP over **Streamable HTTP**. Any MCP client that supports HTTP transport can connect; Claude Desktop (with the `mcp-remote` adapter) is the reference client.

Every request must include `Authorization: Bearer <api-key>`. The key's sha256 is looked up in `api_keys`; the row's `tenant_id` scopes every DB read via row-level security.

### Mint an API key for a tenant

```
# 1. Create a tenant if you don't have one
kubectl exec -n rag-platform deploy/psql-migrate -- \
  psql -tAc "INSERT INTO tenants (name) VALUES ('demo') RETURNING id;"
# -> paste the returned uuid as TENANT_ID

# 2. Generate a random API key and store its hash
RAW_KEY=$(openssl rand -hex 24)
KEY_HASH=$(echo -n "$RAW_KEY" | shasum -a 256 | awk '{print $1}')
kubectl exec -n rag-platform deploy/psql-migrate -- \
  psql -c "INSERT INTO api_keys (tenant_id, key_hash, label) VALUES ('$TENANT_ID', '$KEY_HASH', 'demo');"

echo "Your API key (save it now, it won't be shown again): $RAW_KEY"
```

### Call the tools

Quick smoke test from your laptop, once the gateway is exposed (via ALB, or `kubectl port-forward svc/mcp-gateway 8080:8080`):

```
# MCP initialize handshake
curl -sS -X POST http://localhost:8080/mcp \
  -H "Authorization: Bearer $RAW_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'

# Then invoke a tool
curl -sS -X POST http://localhost:8080/mcp \
  -H "Authorization: Bearer $RAW_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search","arguments":{"query":"mitochondria","k":3}}}'
```

### Tools

| Tool | Args | Returns |
|---|---|---|
| `search` | `query: string, k: number ≤ 20 (default 5)` | Top-k chunks by cosine similarity: `[{content, sourceName, score}]` |
| `ask` | `question: string, k: number ≤ 20 (default 5)` | LLM answer grounded in the top-k chunks, plus the citations |
| `list_sources` | (none) | Distinct document sources for the tenant, most recently ingested first |

### Semantic cache

The gateway keeps up to `CACHE_MAX_ENTRIES` (default 500) recent `(query_embedding, results)` pairs per tenant in Redis. On each query the gateway embeds the incoming text, cosine-compares against every cached embedding, and returns the cached result if the best score is above `CACHE_THRESHOLD` (default 0.95). Cache is keyed per tenant, so tenants can never see each other's cache. Cache hits/misses are exposed as `mcp_cache_hits_total` / `mcp_cache_misses_total`.

## Common failures

- **`terraform apply` says "No configuration files"** — you're in the wrong directory. `cd infra/environments/dev`.
- **`apply` timed out on the EKS node group** — usually a subnet capacity issue; check that private subnets have IP space.
- **`kubectl get nodes` returns Unauthorized** — re-run `aws eks update-kubeconfig`.
- **`terraform destroy` refuses on the state bucket** — expected. Bootstrap has `prevent_destroy = true`. Only remove that line if you're wrapping up the whole project.
- **Ingestion worker rejects a message with `s3 key missing tenant- prefix`** — the S3 key doesn't start with `tenant-<uuid>/`. The message is deleted from the queue on purpose (retrying can't help); re-upload with the correct prefix.
- **Worker crashes with `embedding dim mismatch`** — the OpenAI model returned a vector whose length doesn't match `EMBED_DIM`. Either the model changed under you or the env var is wrong (`text-embedding-3-small` = 1536).

## Cost controls

- Nightly teardown of dev (`terraform destroy`) is the primary cost control — brings ~$5/day → $0
- Budget alert at 50%, 90%, and 100% forecast of $50/month sends email to `rs8057@nyu.edu`
- ECR lifecycle policy expires images past the 20 most recent
