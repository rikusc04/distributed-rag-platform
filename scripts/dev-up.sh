#!/usr/bin/env bash
# Bring the local dev stack up: postgres+pgvector, redis, prometheus.
# Applies the pgvector schema so the gateway can start against it.
#
# This is for iterating on gateway / bench code without paying for AWS.
# The AWS-side flow is unchanged — see docs/runbook.md.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "== Starting postgres + redis + prometheus =="
docker compose -f "$REPO_ROOT/docker-compose.yml" up -d postgres redis prometheus

echo "== Waiting for postgres to be healthy =="
until docker exec distributed-rag-platform-postgres-1 pg_isready -U rag -d rag >/dev/null 2>&1; do
  sleep 1
done

echo "== Applying migrations =="
# Skip if the schema is already present so reruns are safe. Migrations use
# CREATE TABLE (no IF NOT EXISTS), so a naive re-apply would fail.
if docker exec distributed-rag-platform-postgres-1 \
     psql -U rag -d rag -tAc "SELECT to_regclass('public.chunks')" 2>/dev/null | grep -q chunks; then
  echo "  schema already present — skipping"
else
  for f in "$REPO_ROOT"/db/migrations/*.sql; do
    echo "  -> $(basename "$f")"
    docker exec -i distributed-rag-platform-postgres-1 psql -U rag -d rag -v ON_ERROR_STOP=1 < "$f" >/dev/null
  done
fi

cat <<EOF

Local stack is up:
  postgres    localhost:5433  (user=rag, password=rag, db=rag)
  redis       localhost:6380
  prometheus  http://localhost:9091

To run the gateway against it:
  cd services/mcp-gateway
  npm ci && npm run build
  DB_HOST=localhost DB_PORT=5433 DB_NAME=rag DB_USER=rag DB_PASSWORD=rag \\
    DB_SSL=false REDIS_URL=redis://localhost:6380 \\
    OPENAI_API_KEY=sk-... node dist/index.js

To seed a tenant + 200 embedded chunks and run the benchmark, see bench/results/findings.md.

Tear down with:
  docker compose -f $REPO_ROOT/docker-compose.yml down
EOF
