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

```
aws s3 cp mydoc.pdf s3://rag-platform-dev-docs-<ACCOUNT_ID>/tenant-1/
```

S3 → SQS notification is wired; the ingest queue will pick it up and workers will chunk + embed + upsert to pgvector.

## Connecting an MCP client

TBD (Week 2)

## Common failures

- **`terraform apply` says "No configuration files"** — you're in the wrong directory. `cd infra/environments/dev`.
- **`apply` timed out on the EKS node group** — usually a subnet capacity issue; check that private subnets have IP space.
- **`kubectl get nodes` returns Unauthorized** — re-run `aws eks update-kubeconfig`.
- **`terraform destroy` refuses on the state bucket** — expected. Bootstrap has `prevent_destroy = true`. Only remove that line if you're wrapping up the whole project.

## Cost controls

- Nightly teardown of dev (`terraform destroy`) is the primary cost control — brings ~$5/day → $0
- Budget alert at 50%, 90%, and 100% forecast of $50/month sends email to `rs8057@nyu.edu`
- ECR lifecycle policy expires images past the 20 most recent
