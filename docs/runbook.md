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

Build + push images (once we cut over `build-images.yaml` from `workflow_dispatch` to `push`):
```
gh workflow run build-images
```

Deploy via Helm:
```
aws eks update-kubeconfig --name rag-platform-dev --region us-east-1
helm dependency update charts/umbrella
helm upgrade --install rag-platform charts/umbrella \
  --namespace rag-platform --create-namespace
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

TBD.

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
