#!/usr/bin/env bash
# Apply every db/migrations/*.sql file, in order, against the RDS Postgres
# instance provisioned by Terraform.
#
# RDS is in the VPC private subnets and not reachable from your laptop.
# We launch a temporary postgres:16-alpine pod inside the EKS cluster
# (which IS in the VPC), copy the SQL files in, and run psql from there.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TF_DIR="$REPO_ROOT/infra/environments/dev"
MIGRATIONS_DIR="$REPO_ROOT/db/migrations"
POD_NAME="psql-migrate-$$"

echo "== Reading terraform outputs =="
DB_ENDPOINT=$(cd "$TF_DIR" && terraform output -raw postgres_endpoint)
DB_HOST="${DB_ENDPOINT%:*}"
DB_PORT="${DB_ENDPOINT##*:}"
DB_NAME=$(cd "$TF_DIR" && terraform output -raw postgres_db_name)
SECRET_ARN=$(cd "$TF_DIR" && terraform output -raw postgres_secret_arn)

echo "== Fetching credentials from Secrets Manager =="
CREDS_JSON=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ARN" --query SecretString --output text)
DB_USER=$(echo "$CREDS_JSON" | jq -r .username)
DB_PASS=$(echo "$CREDS_JSON" | jq -r .password)

echo "== Launching psql pod: $POD_NAME =="
kubectl run "$POD_NAME" \
  --image=postgres:16-alpine \
  --restart=Never \
  --env="PGPASSWORD=$DB_PASS" \
  --command -- sleep 3600 >/dev/null

trap 'kubectl delete pod "$POD_NAME" --wait=false >/dev/null 2>&1 || true' EXIT

kubectl wait --for=condition=Ready "pod/$POD_NAME" --timeout=60s >/dev/null

echo "== Applying migrations =="
for f in $(ls -1 "$MIGRATIONS_DIR"/*.sql | sort); do
  base=$(basename "$f")
  echo "  -> $base"
  kubectl cp "$f" "$POD_NAME:/tmp/$base"
  kubectl exec "$POD_NAME" -- \
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 -f "/tmp/$base"
done

echo "== Verifying schema =="
kubectl exec "$POD_NAME" -- \
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -c "\dx vector" \
  -c "\dt"

echo "== Done =="
