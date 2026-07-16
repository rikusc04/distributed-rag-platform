# Getting Started

Detailed, no-cloud-knowledge-required walkthrough of how to run this project from scratch. If you know some Python and how to use a terminal, you should be able to follow along.

Everything below assumes macOS + zsh. Linux is almost identical. Windows: use WSL2.

---

## What this project actually does

It's a **RAG (Retrieval-Augmented Generation) platform** deployed on AWS. In one sentence: you upload documents, and an AI assistant (Claude, Cursor, etc.) can query them for grounded answers.

Under the hood:

- **Write path (ingestion):** you drop a PDF into an S3 bucket → the system automatically breaks it into chunks, converts each chunk into a vector (embedding), and stores those vectors in a Postgres database
- **Read path (query):** an MCP-compatible client (Claude Desktop, Cursor) connects to our gateway → it converts the user's question into a vector too → looks up the closest chunks in Postgres → returns them (optionally with a generated answer)

The whole thing runs inside a Kubernetes cluster on AWS (EKS). Python workers do ingestion; a TypeScript gateway serves queries.

## Tech stack — what you need to know per role

| Piece | Language / Tool | Do I need to know it? |
|---|---|---|
| Infra provisioning | **Terraform** (HCL) | To modify infra: yes. To just run: no |
| Ingestion worker | **Python 3.11** | To modify it: yes. To run: no |
| MCP gateway | **TypeScript / Node 20** | To modify it: yes. To run: no |
| Database schema | **SQL** (PostgreSQL + pgvector) | Only if adding schema |
| Deployment | **Helm** (Kubernetes package manager) | Only if changing how apps are deployed |
| CI | **GitHub Actions** (YAML) | Only if changing pipelines |

## Prerequisites

You will need:

1. **An AWS account** — sign up at [aws.amazon.com](https://aws.amazon.com). Requires a credit card. You get some free-tier usage but this project's EKS + RDS + ElastiCache combo **is not free** (~$5/day when running).
2. **A GitHub account** and a repo to push to (this repo lives at `github.com/rikusc04/distributed-rag-platform`)
3. **Homebrew** installed on macOS — see [brew.sh](https://brew.sh) if you don't have it
4. **~$30 of AWS budget** for a 4-week build using nightly teardown (see cost section below)

## Step 1 — Install command-line tools

Everything is done from the terminal.

```bash
brew install awscli terraform kubernetes-cli helm gh
```

Verify each installed:

```bash
aws --version         # aws-cli/2.x
terraform version     # Terraform v1.9+
kubectl version --client
helm version --short
gh --version
```

**What these do:**
- `aws` — talks to AWS from the terminal
- `terraform` — declaratively creates/updates/destroys cloud infra
- `kubectl` — controls Kubernetes clusters
- `helm` — installs pre-packaged Kubernetes apps
- `gh` — GitHub from the terminal (optional but very handy)

## Step 2 — Set up your AWS account

### 2a. Create an IAM user (do NOT use the root account for daily work)

1. Sign in to [console.aws.amazon.com](https://console.aws.amazon.com) as the root user
2. **Turn on MFA on the root user immediately** (top-right menu → Security credentials → Multi-factor authentication)
3. Search "IAM" in the top search bar → open IAM
4. Left sidebar → **Users** → **Create user**
5. Username: anything, e.g. `riku-cli`. Do NOT check "Provide user access to the AWS Management Console" — we only need CLI
6. **Next** → **Attach policies directly** → search for and check **AdministratorAccess** → **Next** → **Create user**

### 2b. Create an access key for the IAM user

1. Click into the user you just created
2. **Security credentials** tab → scroll to **Access keys** → **Create access key**
3. Use case: **Command Line Interface (CLI)** → tick the confirmation → **Next**
4. Description tag: something you'll recognize like `mbp-cli` → **Create access key**
5. On the final screen, you see two values: **Access key ID** (starts with `AKIA…`) and **Secret access key**. **Copy both immediately** into a password manager. The secret is shown **once** — if you close the page without saving it, you have to delete the key and start over.

### 2c. Configure the AWS CLI

Back in the terminal:

```bash
aws configure
```

You'll be prompted for four things:

```
AWS Access Key ID [None]:      <paste your AKIA... value>
AWS Secret Access Key [None]:  <paste your secret>
Default region name [None]:    us-east-1
Default output format [None]:  json
```

Verify:

```bash
aws sts get-caller-identity
```

Should return your account ID and the user ARN. If you get an error here, something in `aws configure` was wrong — re-run it.

### 2d. Create a budget alert (highly recommended)

AWS bills fast if you forget things running. Set a $50/month budget with email alerts:

```bash
# From the repo root:
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

aws budgets create-budget \
  --account-id $ACCOUNT_ID \
  --budget '{
    "BudgetName": "monthly-50-usd",
    "BudgetLimit": {"Amount": "50", "Unit": "USD"},
    "TimeUnit": "MONTHLY",
    "BudgetType": "COST"
  }' \
  --notifications-with-subscribers '[
    {
      "Notification": {"NotificationType": "ACTUAL", "ComparisonOperator": "GREATER_THAN", "Threshold": 50, "ThresholdType": "PERCENTAGE"},
      "Subscribers": [{"SubscriptionType": "EMAIL", "Address": "YOUR_EMAIL@example.com"}]
    },
    {
      "Notification": {"NotificationType": "FORECASTED", "ComparisonOperator": "GREATER_THAN", "Threshold": 100, "ThresholdType": "PERCENTAGE"},
      "Subscribers": [{"SubscriptionType": "EMAIL", "Address": "YOUR_EMAIL@example.com"}]
    }
  ]'
```

Replace `YOUR_EMAIL@example.com` with your real email. You'll get warned before things get out of hand.

## Step 3 — Clone the repo

```bash
git clone https://github.com/rikusc04/distributed-rag-platform.git
cd distributed-rag-platform
```

## Step 4 — Bootstrap the Terraform state backend (one-time only, ever)

Terraform needs somewhere to store its "state" (a record of what it created). We store it in an S3 bucket. Before we can use the S3 backend for the main infra, we have to create that bucket. Chicken and egg — solved by a small bootstrap config:

```bash
cd infra/bootstrap
terraform init
terraform apply
```

Type `yes` when prompted, or run `terraform apply -auto-approve` to skip.

This creates:
- An S3 bucket named `rag-platform-tfstate-<YOUR_ACCOUNT_ID>` (versioned, encrypted, private)
- Uses S3-native locking (no separate DynamoDB table)

Cost: **~$0/month** — a few KB of state files in S3.

You only ever run this once per AWS account. If you're setting up your own account, you'll need to **update the bucket name** in `infra/environments/dev/main.tf` to match your account ID:

```hcl
backend "s3" {
  bucket = "rag-platform-tfstate-YOUR_ACCOUNT_ID"   # <— change this
  ...
}
```

## Step 5 — Bring up the dev stack

Now the fun part:

```bash
cd ../environments/dev
terraform init
terraform apply
```

Review the plan (should say something like "50 to add"), type `yes`. This takes **~15–20 minutes**. The slow part is EKS control plane provisioning.

What gets created:

| Resource | Why |
|---|---|
| VPC + 4 subnets (2 public, 2 private) + NAT + IGW | Network for everything |
| EKS cluster + 2× t3.medium worker nodes | Kubernetes to run the apps |
| RDS PostgreSQL 16 (db.t4g.micro) with pgvector | Vector database |
| ElastiCache Redis (cache.t4g.micro) | Semantic cache for queries |
| S3 bucket + SQS queue + DLQ | Document upload + ingestion queue |
| 2× ECR repos | Container image registry |
| 2× IAM roles (IRSA) | Workload identity for the two services |
| Secrets Manager entries (RDS-managed) | DB master password |

Cost: **~$5/day if left running 24/7** (~$190/month). Tear it down at end of session — see step 8.

## Step 6 — Connect kubectl to the cluster

```bash
aws eks update-kubeconfig --name rag-platform-dev --region us-east-1
kubectl get nodes
```

You should see 2 nodes in `Ready` state. This proves your cluster is up and kubectl is talking to it.

## Step 7 — Deploy the applications

_This section will be filled in once the umbrella Helm chart is populated. Placeholder:_

```bash
# Get ECR URLs so Helm knows where to pull images from
INGESTION_IMAGE=$(terraform output -json | jq -r '.ecr_repository_urls.value["ingestion-worker"]')
GATEWAY_IMAGE=$(terraform output -json | jq -r '.ecr_repository_urls.value["mcp-gateway"]')

# Install Helm baseline (kube-prometheus-stack, KEDA, ALB controller, cert-manager)
# Then deploy the umbrella chart
helm dependency update ../../charts/umbrella
helm upgrade --install rag-platform ../../charts/umbrella \
  --namespace rag-platform --create-namespace \
  --set global.imageRegistry=$ECR_REGISTRY
```

## Step 8 — Tear it down at the end of your session

This is the most important step for cost control.

```bash
cd infra/environments/dev
terraform destroy
```

Type `yes`. Takes ~10 min. This destroys **all the running compute** (EKS, RDS, ElastiCache, NAT) — the cost goes to ~$0.

What SURVIVES:
- The Terraform state bucket (bootstrap) — a few KB of storage
- Your git repo on GitHub
- Any container images in ECR

Tomorrow, `terraform apply` brings everything back in ~15 min.

## Managing cost

- **`terraform destroy` at end of every coding session** — most important habit
- **$50 budget alert** — set up in step 2d
- **Nightly teardown flow** — realistic total cost for a 4-week build: **~$25–40**

The nuclear option if you're panicked about cost:

```bash
# Confirm nothing is running
aws eks list-clusters
aws rds describe-db-instances --query "DBInstances[*].DBInstanceIdentifier"
aws elasticache describe-cache-clusters --query "CacheClusters[*].CacheClusterId"
# All three should be empty after terraform destroy
```

## Fully removing the project from AWS

When you're 100% done and want to remove every trace:

```bash
# 1. Destroy dev environment (if not already)
cd infra/environments/dev && terraform destroy

# 2. Empty the state bucket
aws s3 rm s3://rag-platform-tfstate-$(aws sts get-caller-identity --query Account --output text) --recursive

# 3. Remove prevent_destroy from bootstrap/main.tf, then:
cd ../../bootstrap && terraform apply && terraform destroy

# 4. (Optional) delete the IAM user + access keys from the AWS Console
```

## Common gotchas

See [`docs/issues.md`](issues.md) for a running log of issues we've hit and how we fixed them.
